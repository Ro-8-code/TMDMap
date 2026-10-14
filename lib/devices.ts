import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Sign-in history, kept on the user's own auth metadata.
 *
 * This deliberately avoids needing a database table: Supabase lets a session
 * write to its own user_metadata, so device history works with nothing more
 * than the auth setup that already exists.
 *
 * The trade is that the user can in principle tamper with their own metadata.
 * For spotting a shared login that's fine — the point is to make sharing
 * visible to whoever runs the account, not to defeat a determined attacker.
 * Moving this server-side is the upgrade when it matters.
 */

export type SignIn = {
  id: string;
  at: string;
  label: string;
  isNew: boolean;
};

const MAX_HISTORY = 20;

/**
 * A rough device identity: enough to tell one person's laptop from another's,
 * not enough to track anyone. Stable across sessions on the same machine,
 * different across machines, and it changes if someone reinstalls — which
 * produces a false "new device" rather than a missed one, the safer way round.
 */
export function deviceFingerprint(): { id: string; label: string } {
  const nav = typeof navigator === "undefined" ? ({} as Navigator) : navigator;
  const scr = typeof screen === "undefined" ? ({ width: 0, height: 0 } as Screen) : screen;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";

  const raw = [
    nav.userAgent ?? "",
    nav.language ?? "",
    `${scr.width}x${scr.height}`,
    tz,
    (nav as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency ?? "",
  ].join("|");

  // djb2 — short, stable, and no crypto dependency for something this small.
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) + hash + raw.charCodeAt(i)) | 0;
  const id = (hash >>> 0).toString(36);

  return { id, label: describe(nav.userAgent ?? "", scr.width, scr.height) };
}

function describe(ua: string, w: number, h: number): string {
  const os = /Windows/.test(ua) ? "Windows"
    : /Macintosh|Mac OS/.test(ua) ? "Mac"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad/.test(ua) ? "iOS"
    : /Linux/.test(ua) ? "Linux"
    : "Unknown";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : /Firefox\//.test(ua) ? "Firefox"
    : "Browser";
  return `${browser} on ${os} · ${w}×${h}`;
}

/**
 * Records this sign-in and reports whether the device has been seen before.
 * Called after a successful login.
 */
export async function recordSignIn(
  supabase: SupabaseClient
): Promise<{ isNew: boolean; history: SignIn[] }> {
  const { id, label } = deviceFingerprint();
  const { data } = await supabase.auth.getUser();
  const meta = (data.user?.user_metadata ?? {}) as { signIns?: SignIn[] };
  const history = Array.isArray(meta.signIns) ? meta.signIns : [];

  const isNew = !history.some((s) => s.id === id);
  const entry: SignIn = { id, label, at: new Date().toISOString(), isNew };
  const next = [entry, ...history].slice(0, MAX_HISTORY);

  await supabase.auth.updateUser({ data: { signIns: next } });
  return { isNew, history: next };
}

export function readHistory(meta: unknown): SignIn[] {
  const m = (meta ?? {}) as { signIns?: SignIn[] };
  return Array.isArray(m.signIns) ? m.signIns : [];
}
