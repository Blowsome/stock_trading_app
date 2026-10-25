"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Logo } from "./Logo";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/auth/${mode}`, { body: form });
      router.replace("/start");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const field = (key: keyof typeof form, label: string, type = "text", autoComplete?: string) => (
    <label className="block">
      <span className="mb-1.5 block text-sm text-muted">{label}</span>
      <input
        type={type}
        required
        autoComplete={autoComplete}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full rounded-md border border-line bg-surface px-3 py-2.5 outline-none focus:border-up"
      />
    </label>
  );

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Logo className="mb-10 text-xl" />
        <h1 className="mb-2 text-3xl font-semibold">{signup ? "Create your account" : "Log in"}</h1>
        <p className="mb-8 text-muted">
          {signup ? "Start with $1,000,000 in virtual cash. Real prices, no real money." : "Welcome back."}
        </p>
        <form onSubmit={submit} className="space-y-4">
          {signup && field("name", "Name", "text", "name")}
          {field("email", "Email", "email", "email")}
          {field("password", "Password", "password", signup ? "new-password" : "current-password")}
          {error && <p className="text-sm text-down">{error}</p>}
          <button
            disabled={busy}
            className="w-full rounded-full bg-up py-3 font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
          >
            {busy ? "Please wait…" : signup ? "Sign up" : "Log in"}
          </button>
        </form>
        <p className="mt-6 text-sm text-muted">
          {signup ? "Already have an account? " : "New here? "}
          <Link href={signup ? "/login" : "/signup"} className="text-up hover:underline">
            {signup ? "Log in" : "Create an account"}
          </Link>
        </p>
      </div>
    </div>
  );
}
