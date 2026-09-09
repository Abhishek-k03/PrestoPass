"use client";

import { useState } from "react";
import Link from "next/link";
import { Ticket } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { API_BASE_URL } from "@/lib/apiUrl";

const FIELD =
  "h-10 w-full rounded-md border border-border bg-field px-3 text-label text-ink-100 placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15";

const Login = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.response?.data?.error || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-9">
        <div className="mb-7 flex items-center gap-2.5">
          <Ticket className="size-[18px] text-primary" />
          <span className="text-[15px] font-semibold tracking-tight text-ivory">
            PrestoPass
          </span>
        </div>

        {/* The serif steps back here — 36px rather than the 40px page title —
            so the form stays the loudest thing on a near-empty screen. */}
        <h1 className="text-[36px] leading-[1.05]">Welcome back</h1>
        <p className="mt-2 text-label text-muted-foreground">
          Log in to book your tickets.
        </p>

        <form onSubmit={handleSubmit} className="mt-7 space-y-4">
          <div>
            <label className="mb-1.5 block text-caption text-ink-300">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={FIELD}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-caption text-ink-300">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD}
            />
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2.5 text-caption text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-md bg-primary text-label font-semibold text-primary-foreground shadow-glow transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Logging in…" : "Log in"}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3.5">
          <span className="h-px flex-1 bg-border" />
          <span className="text-caption text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <button
          type="button"
          onClick={() => {
            window.location.href = `${API_BASE_URL}/api/auth/google`;
          }}
          className="inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-md border border-border text-label text-ink-100 transition hover:border-ink-700 hover:text-ivory"
        >
          Continue with Google
        </button>

        <p className="mt-6 text-center text-caption text-muted-foreground">
          No account?{" "}
          <Link
            href="/register"
            className="font-semibold text-primary hover:underline"
          >
            Register
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
