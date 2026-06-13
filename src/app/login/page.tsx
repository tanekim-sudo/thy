"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [mode, setMode] = useState<"signin" | "signup">(
    params.get("mode") === "signup" ? "signup" : "signin"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!isSupabaseConfigured) {
      setError("Accounts aren't configured yet (missing Supabase env vars).");
      return;
    }

    setBusy(true);
    const supabase = createSupabaseBrowserClient();

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo:
              typeof window !== "undefined"
                ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
                : undefined,
          },
        });
        if (error) throw error;
        // If email confirmation is disabled, a session is returned immediately.
        if (data.session) {
          router.replace(next);
          router.refresh();
        } else {
          setMessage("Check your email to confirm your account, then sign in.");
          setMode("signin");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#0a0a0f] px-6">
      <div className="flex flex-col items-center">
        {/* The orb — the same presence as the field */}
        <span className="orb-pulse mb-10 block h-3 w-3 rounded-full bg-[rgba(160,200,235,0.9)] shadow-[0_0_20px_8px_rgba(120,180,230,0.45)]" />

        <h1 className="mb-1 text-center text-[22px] font-light tracking-wide text-[rgba(210,225,240,0.85)]">
          Create Thyself
        </h1>
        <p className="mb-8 text-center text-[12px] font-light italic tracking-wide text-[rgba(150,180,210,0.4)]">
          {mode === "signin" ? "return to your field" : "begin your field"}
        </p>

        <form onSubmit={handleSubmit} className="flex w-[min(86vw,22rem)] flex-col gap-4">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-0 border-b border-[rgba(150,190,220,0.2)] bg-transparent pb-2 text-center text-[15px] font-light text-[rgba(210,225,240,0.85)] outline-none transition-colors placeholder:text-[rgba(150,180,210,0.3)] focus:border-[rgba(150,190,220,0.5)]"
          />
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border-0 border-b border-[rgba(150,190,220,0.2)] bg-transparent pb-2 text-center text-[15px] font-light text-[rgba(210,225,240,0.85)] outline-none transition-colors placeholder:text-[rgba(150,180,210,0.3)] focus:border-[rgba(150,190,220,0.5)]"
          />

          <button
            type="submit"
            disabled={busy}
            className="mt-4 rounded-full border border-[rgba(150,190,220,0.25)] bg-[rgba(120,180,230,0.06)] px-6 py-2.5 text-[13px] font-light tracking-wide text-[rgba(200,220,240,0.8)] transition-colors hover:bg-[rgba(120,180,230,0.12)] disabled:opacity-40"
          >
            {busy ? "…" : mode === "signin" ? "enter" : "create account"}
          </button>
        </form>

        {error && (
          <p className="mt-5 max-w-[22rem] text-center text-[12px] font-light text-[rgba(230,160,160,0.7)]">
            {error}
          </p>
        )}
        {message && (
          <p className="mt-5 max-w-[22rem] text-center text-[12px] font-light text-[rgba(160,210,180,0.75)]">
            {message}
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setMessage(null);
          }}
          className="mt-8 text-[12px] font-light tracking-wide text-[rgba(150,180,210,0.4)] underline-offset-4 transition-colors hover:text-[rgba(180,205,230,0.65)]"
        >
          {mode === "signin"
            ? "no field yet — create one"
            : "already have a field — sign in"}
        </button>

        <Link
          href="/"
          className="mt-4 text-[11px] font-light italic tracking-wide text-[rgba(150,180,210,0.28)] underline-offset-4 transition-colors hover:text-[rgba(180,205,230,0.5)]"
        >
          keep exploring as a guest
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[#0a0a0f]" />}>
      <LoginForm />
    </Suspense>
  );
}
