# One image, three roles. The API and the payment worker are the same codebase
# with the same dependencies -- see docker-entrypoint.sh for the mode switch.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Dependencies first, as their own layer: this is only rebuilt when the lockfile
# changes, so an ordinary code edit reuses the cached install.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY . .
RUN uv sync --frozen --no-dev \
    && chmod +x /app/docker-entrypoint.sh

RUN useradd --create-home --uid 10001 app && chown -R app:app /app
USER app

EXPOSE 5000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
# "all" runs the API and the payment worker side by side in one container, which
# is what a single-instance/free-tier deploy needs. Split them by overriding this
# with "api" and "worker" on two services once you scale out.
CMD ["all"]
