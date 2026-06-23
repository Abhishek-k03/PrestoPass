"""Payment gateways behind one three-method interface.

Two implementations:

* :class:`MockProvider` -- the default. No network, no keys, no signup, so the
  repo still runs offline and the booking flow stays drivable by Playwright
  (Razorpay's checkout is a cross-origin iframe that a test cannot type into).
  It is a *simulation of a gateway*, not a stub of one: it signs its callbacks
  with the same HMAC construction Razorpay uses, so the verification path is
  genuinely exercised rather than short-circuited.

* :class:`RazorpayProvider` -- real Razorpay **test mode**, which is the only
  major gateway whose test environment offers a working UPI tab (VPA + QR)
  alongside cards. Talks to the REST API directly over ``httpx2.AsyncClient``
  (already a dependency, via Authlib) rather than the official SDK, which is
  synchronous and would block the event loop on every checkout.

Amounts are **paise** end to end. That is both our storage unit and Razorpay's
wire unit, so no conversion happens anywhere in this module.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import uuid
from dataclasses import dataclass
from typing import Protocol

import httpx2

from app.config import settings
from app.errors import ApiError

log = logging.getLogger(__name__)

RAZORPAY_ORDERS_URL = "https://api.razorpay.com/v1/orders"

# Razorpay's own test instruments, surfaced here so the mock sheet and the docs
# can show the same values the real gateway accepts.
TEST_UPI_SUCCESS = "success@razorpay"
TEST_UPI_FAILURE = "failure@razorpay"
TEST_CARD_SUCCESS = "4111111111111111"
TEST_CARD_FAILURE = "4000000000000002"


@dataclass(frozen=True)
class ProviderOrder:
    """What the browser needs to open a checkout."""

    orderId: str
    amount: int  # paise
    currency: str
    keyId: str  # publishable; empty for the mock provider


def _hmac_hex(secret: str, message: bytes) -> str:
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


class PaymentProvider(Protocol):
    name: str

    async def create_order(self, *, amount: int, currency: str, receipt: str) -> ProviderOrder: ...

    def verify_callback(self, *, order_id: str, payment_id: str, signature: str) -> bool: ...

    def verify_webhook(self, *, raw_body: bytes, signature: str) -> bool: ...


class MockProvider:
    """A gateway that always says yes, signed the way a real one would.

    The browser decides the outcome (see ``MockCheckoutSheet``): a declining
    instrument simply never calls verify, exactly as a declined Razorpay payment
    never fires its handler.
    """

    name = "mock"

    def __init__(self, secret: str) -> None:
        # Keyed on JWT_SECRET rather than a payments secret of its own: there is
        # no third party here, and one dev secret is one fewer thing to set.
        self._secret = secret

    async def create_order(self, *, amount: int, currency: str, receipt: str) -> ProviderOrder:
        return ProviderOrder(
            orderId=f"mock_order_{uuid.uuid4().hex[:14]}",
            amount=amount,
            currency=currency,
            keyId="",
        )

    def sign(self, order_id: str, payment_id: str) -> str:
        """Used by the /order response so the browser can produce a valid callback.

        Handing the client its own signature would be a hole in a real gateway;
        here it is the whole point -- there is no third party to produce one, and
        the server still refuses anything it did not sign.
        """
        return _hmac_hex(self._secret, f"{order_id}|{payment_id}".encode())

    def verify_callback(self, *, order_id: str, payment_id: str, signature: str) -> bool:
        return hmac.compare_digest(self.sign(order_id, payment_id), signature)

    def verify_webhook(self, *, raw_body: bytes, signature: str) -> bool:
        return hmac.compare_digest(_hmac_hex(self._secret, raw_body), signature)


class RazorpayProvider:
    name = "razorpay"

    def __init__(self, key_id: str, key_secret: str, webhook_secret: str) -> None:
        self._key_id = key_id
        self._key_secret = key_secret
        self._webhook_secret = webhook_secret

    async def create_order(self, *, amount: int, currency: str, receipt: str) -> ProviderOrder:
        try:
            async with httpx2.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    RAZORPAY_ORDERS_URL,
                    auth=(self._key_id, self._key_secret),
                    json={
                        "amount": amount,  # paise -- Razorpay's unit is ours
                        "currency": currency,
                        "receipt": receipt,
                        # We settle on our own signal, not Razorpay's autocapture,
                        # so the booking and the charge cannot disagree.
                        "payment_capture": 1,
                    },
                )
        except httpx2.HTTPError:
            log.exception("Razorpay order request failed")
            raise ApiError(502, "Could not reach the payment gateway") from None

        if response.status_code >= 400:
            log.error("Razorpay rejected the order: %s %s", response.status_code, response.text)
            raise ApiError(502, "The payment gateway rejected this order")

        body = response.json()
        return ProviderOrder(
            orderId=body["id"],
            amount=body["amount"],
            currency=body["currency"],
            keyId=self._key_id,
        )

    def verify_callback(self, *, order_id: str, payment_id: str, signature: str) -> bool:
        expected = _hmac_hex(self._key_secret, f"{order_id}|{payment_id}".encode())
        return hmac.compare_digest(expected, signature)

    def verify_webhook(self, *, raw_body: bytes, signature: str) -> bool:
        if not self._webhook_secret:
            # Refusing beats accepting: an unconfigured secret must not become an
            # unauthenticated endpoint that can confirm bookings.
            log.error("Webhook received but RAZORPAY_WEBHOOK_SECRET is unset; rejecting")
            return False
        # Hashed over the RAW bytes. Re-serialising the parsed JSON changes the
        # body and every signature then fails.
        return hmac.compare_digest(_hmac_hex(self._webhook_secret, raw_body), signature)


def _build() -> PaymentProvider:
    choice = (settings.PAYMENT_PROVIDER or "mock").strip().lower()

    if choice == "razorpay":
        if not settings.razorpay_enabled:
            # Fail at import/startup, not at the user's checkout. A boot error
            # names the problem; a 500 three clicks into a booking does not.
            raise RuntimeError(
                "PAYMENT_PROVIDER=razorpay requires RAZORPAY_KEY_ID and "
                "RAZORPAY_KEY_SECRET. Get test keys from the Razorpay dashboard "
                "(no KYC needed for test mode), or set PAYMENT_PROVIDER=mock."
            )
        return RazorpayProvider(
            settings.RAZORPAY_KEY_ID,
            settings.RAZORPAY_KEY_SECRET,
            settings.RAZORPAY_WEBHOOK_SECRET,
        )

    if choice != "mock":
        raise RuntimeError(f"Unknown PAYMENT_PROVIDER {choice!r}; expected 'mock' or 'razorpay'")

    return MockProvider(settings.JWT_SECRET)


_provider: PaymentProvider = _build()


def get_provider() -> PaymentProvider:
    return _provider
