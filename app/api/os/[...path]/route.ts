import { NextResponse, type NextRequest } from "next/server";

/**
 * Generic proxy for the OS vector services — tiles, sprites and glyphs all
 * come from api.os.uk and all need the key appended. Routing them through here
 * keeps the key server-side, the same reason the raster tile proxy exists.
 */

// Only the NGD vector endpoints. Without this the route would forward any path
// a caller invented to api.os.uk under our key.
const ALLOWED_PREFIX = "maps/vector/ngd/";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const { path } = await ctx.params;
  const joined = path.join("/");

  if (!joined.startsWith(ALLOWED_PREFIX) || joined.includes("..")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const key = process.env.OS_API_KEY;
  if (!key) return new NextResponse("OS_API_KEY not configured", { status: 404 });

  const url = new URL(`https://api.os.uk/${joined}`);
  // Carry through query params the style asked for, then add the key.
  request.nextUrl.searchParams.forEach((v, k) => {
    if (k !== "key") url.searchParams.set(k, v);
  });
  url.searchParams.set("key", key);

  const upstream = await fetch(url, {
    headers: { Accept: request.headers.get("accept") ?? "*/*" },
    next: { revalidate: 60 * 60 * 24 * 7 },
  });

  if (!upstream.ok) {
    return new NextResponse(null, { status: upstream.status === 404 ? 404 : 502 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
    },
  });
}
