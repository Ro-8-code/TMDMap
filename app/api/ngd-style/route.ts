import { NextResponse, type NextRequest } from "next/server";
import { rewriteUrls, toCadLinework, type AnyStyle } from "@/lib/cadStyle";

/**
 * Serves the OS NGD vector style, rewritten for drawing use.
 *
 * OS publish their own stylesheet; we fetch it, point every URL in it back at
 * our proxy so the key never reaches the browser, and optionally strip it back
 * to linework. Deriving from OS's live style rather than hand-writing one means
 * new layers appear on their own when OS extends the schema.
 */

const NGD_BASE = "https://api.os.uk/maps/vector/ngd/ota/v1/collections/ngd-base";

export async function GET(request: NextRequest) {
  const key = process.env.OS_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "OS_API_KEY not configured" }, { status: 404 });
  }

  const styleId = request.nextUrl.searchParams.get("style") ?? "Light";
  const mode = request.nextUrl.searchParams.get("mode") ?? "cad";

  const upstream = await fetch(`${NGD_BASE}/styles/${encodeURIComponent(styleId)}?key=${key}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 60 * 60 * 24 },
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `OS returned ${upstream.status} for style "${styleId}"` },
      { status: upstream.status === 404 ? 404 : 502 }
    );
  }

  const style = (await upstream.json()) as AnyStyle;
  const origin = request.nextUrl.origin;

  const rewritten = rewriteUrls(style, origin);
  const final = mode === "cad" ? toCadLinework(rewritten) : rewritten;

  return NextResponse.json(final, {
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
  });
}
