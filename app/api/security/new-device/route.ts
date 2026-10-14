import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/apiAuth";
import { createClient } from "@/lib/supabase/server";
import { sendAlert, mailConfigured } from "@/lib/mail";

/**
 * Raises an alert when an account is used from a device it hasn't been seen
 * on before. Called by the client immediately after sign-in.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;

  let body: { label?: string; deviceId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? "unknown";

  // The IP the request arrived from, as the proxy reports it.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const sent = await sendAlert(`TMDMap: new device signed in — ${email}`, [
    `<strong>A TMDMap account has been used from a device it hasn't been seen on before.</strong>`,
    "",
    `Account: ${email}`,
    `Device: ${body.label ?? "unknown"}`,
    `IP address: ${ip}`,
    `Time: ${new Date().toLocaleString("en-GB", { timeZone: "Europe/London" })}`,
    "",
    `If this wasn't expected, change the password and remove the address from ALLOWED_EMAILS.`,
  ]);

  return NextResponse.json({ alerted: sent, mailConfigured });
}
