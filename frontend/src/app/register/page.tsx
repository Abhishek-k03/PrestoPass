"use client";

import { useState } from "react";
import Link from "next/link";
import { Ticket } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const FIELD =
  "h-10 w-full rounded-md border border-border bg-field px-3 text-label text-ink-100 placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15";

const Register = () => {
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register(name, email, password);
    } catch (err: any) {
      setError(err.response?.data?.error || "Registration failed");
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

        <h1 className="text-[36px] leading-[1.05]">Create account</h1>
        <p className="mt-2 text-label text-muted-foreground">
          Start booking in seconds.
        </p>

        <form onSubmit={handleSubmit} className="mt-7 space-y-4">
          <div>
            <label className="mb-1.5 block text-caption text-ink-300">Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Abhishek Kumar"
              className={FIELD}
            />
          </div>

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
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD}
            />
            <p className="mt-1.5 text-caption text-muted-foreground">
              At least 6 characters.
            </p>
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
            {loading ? "Creating account…" : "Register"}
          </button>
        </form>

        <p className="mt-6 text-center text-caption text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-semibold text-primary hover:underline"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Register;
