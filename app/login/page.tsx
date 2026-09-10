"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { Brand } from "../brand";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/env";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const justVerified = params.get("verified") === "1";
  const denied = params.get("denied") === "1";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // Supabase returns a generic message when the email is unconfirmed.
      setError(
        /confirm/i.test(error.message)
          ? "That email hasn't been verified yet. Check your inbox for the verification link."
          : error.message
      );
      setBusy(false);
      return;
    }

    router.push(params.get("next") || "/map");
    router.refresh();
  }

  return (
    <div className="auth-card">
      <Brand />
      <p className="auth-sub">
        Ordnance Survey mapping for traffic management drawings. Sign in to
        continue.
      </p>

      {!supabaseConfigured && (
        <div className="msg msg-warn">
          Authentication isn&apos;t configured yet. Add your Supabase keys to
          <code> .env.local</code> — see <code>SETUP.md</code>.
        </div>
      )}

      {justVerified && (
        <div className="msg msg-ok">
          Email verified. Sign in below to get started.
        </div>
      )}

      {denied && (
        <div className="msg msg-error">
          That account doesn&apos;t have access to this site. Ask the
          administrator to add your email address.
        </div>
      )}

      {error && <div className="msg msg-error">{error}</div>}

      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.co.uk"
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        <button className="btn" type="submit" disabled={busy || !supabaseConfigured}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="auth-foot">
        No account yet? <Link href="/signup">Create one</Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="auth-wrap">
      <Suspense fallback={<div className="auth-card">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
