import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";

/**
 * Gate for the routes that spend OS transactions.
 *
 * Without this the tile proxy is an open relay: anyone who learns the URL can
 * pull OS premium data on our allowance, which is both a bill and a licence
 * breach. The same-origin check these routes used before was no defence at
 * all — a request with no Origin header skipped it entirely.
 *
 * Verifying with Supabase means a network round trip, which is far too slow to
 * do per map tile, so successful verifications are cached briefly against the
 * access token. A signed-out user's tiles stop within the cache window rather
 * than instantly; that's an acceptable trade for a basemap.
 */

/**
 * Optional allowlist. Supabase's own "disable signup" toggle is the only thing
 * that stops an account being created, but it can't stop one being *used* —
 * and it's a dashboard setting that's easy to leave open by accident. This is
 * the belt to that braces: whoever holds an account, only these addresses get
 * past our own routes. Empty means no restriction, which is right for local
 * development.
 */
const ALLOWED = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function emailAllowed(email: string | undefined | null): boolean {
  if (ALLOWED.length === 0) return true;
  return !!email && ALLOWED.includes(email.toLowerCase());
}

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 2000;
const verified = new Map<string, { at: number; userId: string }>();

function cacheGet(token: string) {
  const hit = verified.get(token);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    verified.delete(token);
    return null;
  }
  return hit.userId;
}

function cacheSet(token: string, userId: string) {
  if (verified.size >= MAX_ENTRIES) {
    const oldest = verified.keys().next().value;
    if (oldest !== undefined) verified.delete(oldest);
  }
  verified.set(token, { at: Date.now(), userId });
}

/**
 * Returns the signed-in user's id, or a 401 response to return as-is.
 * When Supabase isn't configured the app has no auth at all, so this stands
 * down rather than locking a half-configured install out of its own map.
 */
export async function requireUser(
  request: NextRequest
): Promise<{ userId: string } | { error: NextResponse }> {
  if (!supabaseConfigured) return { userId: "unauthenticated-dev" };

  // Supabase splits large session cookies across sb-<ref>-auth-token.0, .1 …
  const token = request.cookies
    .getAll()
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => c.value)
    .join("");

  if (!token) {
    return { error: new NextResponse("Sign in required", { status: 401 }) };
  }

  const cached = cacheGet(token);
  if (cached) return { userId: cached };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: new NextResponse("Sign in required", { status: 401 }) };
  }

  if (!emailAllowed(user.email)) {
    return { error: new NextResponse("Not authorised for this account", { status: 403 }) };
  }

  cacheSet(token, user.id);
  return { userId: user.id };
}

/**
 * Per-user ceiling on OS transactions, so one runaway client — a stuck zoom
 * loop, a script using a real login — can't quietly spend the monthly
 * allowance. Generous enough that ordinary panning never notices.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 600;
const hits = new Map<string, number[]>();

export function withinRateLimit(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(userId, recent);

  if (hits.size > 500) {
    for (const [id, times] of hits) {
      if (times.every((t) => now - t > RATE_WINDOW_MS)) hits.delete(id);
    }
  }
  return recent.length <= RATE_MAX;
}
