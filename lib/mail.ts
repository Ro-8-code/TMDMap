import nodemailer from "nodemailer";

/**
 * Alert email, sent through the Google Workspace mailbox the business already
 * has rather than a third-party sending service.
 *
 * Everything here no-ops when SMTP isn't configured, so the app runs normally
 * on a machine with no credentials and alerts simply don't go out. A failed
 * alert must never break a sign-in.
 */

const HOST = process.env.SMTP_HOST ?? "smtp.gmail.com";
const PORT = Number(process.env.SMTP_PORT ?? 587);
const USER = process.env.SMTP_USER ?? "";
const PASS = process.env.SMTP_PASSWORD ?? "";
const TO = process.env.ALERT_EMAIL ?? USER;

export const mailConfigured = Boolean(USER && PASS);

export async function sendAlert(subject: string, lines: string[]): Promise<boolean> {
  if (!mailConfigured) return false;

  try {
    const transport = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: PORT === 465,
      auth: { user: USER, pass: PASS },
    });

    await transport.sendMail({
      from: `"TMDMap" <${USER}>`,
      to: TO,
      subject,
      text: lines.join("\n"),
      html:
        `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#111">` +
        lines.map((l) => (l ? `<p style="margin:0 0 8px">${escapeHtml(l)}</p>` : "")).join("") +
        `<p style="margin:16px 0 0;font-size:12px;color:#888">Sent automatically by TMDMap.</p></div>`,
    });
    return true;
  } catch {
    // Swallow deliberately — see the note above.
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string
  );
}
