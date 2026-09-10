import { NextResponse, type NextRequest } from "next/server";
import { requireUser, withinRateLimit } from "@/lib/apiAuth";

/**
 * Server-side proxy for the OS Maps API.
 *
 * The OS Data Hub key is passed as a query parameter, so calling OS directly
 * from the browser would publish the key in devtools and let anyone burn the
 * account's free allowance. Every tile therefore goes through here: the key
 * stays in the server environment and never reaches the client.
 */

const OS_LAYERS = new Set([
  "Leisure_3857",
  "Outdoor_3857",
  "Road_3857",
  "Light_3857",
]);

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ layer: string; z: string; x: string; y: string }> }
) {
  // Every request here spends OS transactions, so it has to be a signed-in
  // user rather than anyone who knows the URL.
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  if (!withinRateLimit(auth.userId)) {
    return new NextResponse("Too many requests", { status: 429 });
  }

  const { layer, z, x, y } = await ctx.params;

  if (!OS_LAYERS.has(layer)) {
    return new NextResponse("Unknown layer", { status: 400 });
  }

  const zoom = Number(z);
  const col = Number(x);
  const row = Number(y);
  if (
    !Number.isInteger(zoom) || !Number.isInteger(col) || !Number.isInteger(row) ||
    zoom < 0 || zoom > 22 || col < 0 || row < 0
  ) {
    return new NextResponse("Bad tile coordinates", { status: 400 });
  }

  const key = process.env.OS_API_KEY;
  if (!key) {
    // 404 rather than 500: MapLibre treats a missing tile as "nothing to draw"
    // and keeps the rest of the map interactive.
    return new NextResponse("OS_API_KEY not configured", { status: 404 });
  }

  // Only serve tiles to our own pages, so the proxy can't be used as a free
  // public OS tile server by someone who finds the URL.
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (origin) {
    const host = request.headers.get("host");
    try {
      if (host && new URL(origin).host !== host) {
        return new NextResponse("Forbidden", { status: 403 });
      }
    } catch {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  const upstream = `https://api.os.uk/maps/raster/v1/zxy/${layer}/${zoom}/${col}/${row}.png?key=${key}`;

  const res = await fetch(upstream, {
    headers: { Accept: "image/png" },
    // OS tiles are static; let Next and the CDN hold on to them.
    next: { revalidate: 60 * 60 * 24 * 30 },
  });

  if (!res.ok) {
    return new NextResponse(null, { status: res.status === 404 ? 404 : 502 });
  }

  return new NextResponse(res.body, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "image/png",
      "Cache-Control": "public, max-age=86400, s-maxage=2592000, immutable",
    },
  });
}
