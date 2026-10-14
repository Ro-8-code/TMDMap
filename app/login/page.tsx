"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Brand } from "../brand";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/env";
import { recordSignIn } from "@/lib/devices";

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

    if (!error) {
      // Note the device before anything else, so a sign-in from somewhere new
      // is on record even if the session is revoked moments later.
      const seen = await recordSignIn(supabase).catch(() => null);

      // Alert on a device we haven't seen before. Fire-and-forget: an alert
      // that fails must never stop someone legitimate getting in.
      if (seen?.isNew) {
        void fetch("/api/security/new-device", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: seen.history[0]?.label ?? "",
            deviceId: seen.history[0]?.id ?? "",
          }),
        }).catch(() => {});
      }

      // One login, one person. Signing in revokes every other session on this
      // account, so a shared password logs the previous user out rather than
      // letting two people work from the same seat.
      await supabase.auth.signOut({ scope: "others" }).catch(() => {
        // A failure here shouldn't block a legitimate sign-in; the session
        // this user just created is still valid.
      });
    }

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
        Accounts are issued by the administrator. Contact us if you need access.
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
