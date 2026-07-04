"use client";

import { useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

const SigningIn = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <p className="text-label text-muted-foreground">Signing you in…</p>
  </div>
);

function CallbackContent() {
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const token = params.get("token");
    const user = params.get("user");

    if (token && user) {
      localStorage.setItem("token", token);
      localStorage.setItem(
        "user",
        JSON.stringify(JSON.parse(decodeURIComponent(user)))
      );

      router.push("/events");
    }
  }, [params, router]);

  return <SigningIn />;
}

export default function Callback() {
  return (
    <Suspense fallback={<SigningIn />}>
      <CallbackContent />
    </Suspense>
  );
}
