import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/apiAuth";

/**
 * Address / postcode search.
 *
 * Two free sources, merged:
 *  - postcodes.io  — ONS postcode data, exact centroids for full or partial
 *                    UK postcodes. Unbeatable for "search the postcode".
 *  - Nominatim     — OpenStreetMap gazetteer for street names, place names
 *                    and building numbers.
 *
 * Both are proxied here so Nominatim gets a proper identifying User-Agent
 * (its usage policy requires one) and so neither is called from the browser.
 */

export const runtime = "nodejs";

/**
 * Nominatim's usage policy allows at most one request per second and asks for
 * an identifying User-Agent. Both are our responsibility here: if this proxy
 * gets hammered under our User-Agent, OSM blocks us and search stops working
 * for everyone. So results are cached, and calls out to Nominatim are spaced.
 *
 * This state is per-instance, and serverless spreads traffic across instances,
 * so it isn't a hard guarantee — it's a large reduction in outbound calls
 * rather than a strict limiter.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; body: unknown }>();

let nominatimChain: Promise<unknown> = Promise.resolve();
let lastNominatimAt = 0;

/** Queues a call so consecutive Nominatim requests are at least 1s apart. */
function spaced<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimChain.then(async () => {
    const wait = 1000 - (Date.now() - lastNominatimAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatimAt = Date.now();
    return fn();
  });
  // Keep the chain alive even if this link rejects.
  nominatimChain = run.catch(() => undefined);
  return run;
}

type Hit = {
  id: string;
  label: string;
  sub: string;
  lat: number;
  lon: number;
  zoom: number;
  source: "postcode" | "osm";
};

const FULL_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const PARTIAL_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

async function postcodeHits(q: string): Promise<Hit[]> {
  const clean = q.trim();

  try {
    if (FULL_POSTCODE.test(clean)) {
      const r = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`,
        { cache: "no-store" }
      );
      if (!r.ok) return [];
      const { result } = await r.json();
      if (!result) return [];
      return [
        {
          id: `pc:${result.postcode}`,
          label: result.postcode,
          sub: [result.admin_ward, result.admin_district, result.country]
            .filter(Boolean)
            .join(", "),
          lat: result.latitude,
          lon: result.longitude,
          zoom: 17,
          source: "postcode",
        },
      ];
    }

    if (PARTIAL_POSTCODE.test(clean)) {
      const r = await fetch(
        `https://api.postcodes.io/outcodes/${encodeURIComponent(clean)}`,
        { cache: "no-store" }
      );
      if (!r.ok) return [];
      const { result } = await r.json();
      if (!result) return [];
      return [
        {
          id: `oc:${result.outcode}`,
          label: result.outcode,
          sub: [result.admin_district?.[0], result.region].filter(Boolean).join(", "),
          lat: result.latitude,
          lon: result.longitude,
          zoom: 13,
          source: "postcode",
        },
      ];
    }

    // Partial full-postcode typing, e.g. "SW1A 1A" — offer autocompletions.
    if (/^[A-Z]{1,2}\d[A-Z\d]?\s*\d?[A-Z]{0,2}$/i.test(clean) && clean.length >= 3) {
      const r = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}/autocomplete`,
        { cache: "no-store" }
      );
      if (!r.ok) return [];
      const { result } = await r.json();
      if (!Array.isArray(result)) return [];

      const detailed = await fetch("https://api.postcodes.io/postcodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postcodes: result.slice(0, 5) }),
        cache: "no-store",
      });
      if (!detailed.ok) return [];
      const body = await detailed.json();

      return (body.result ?? [])
        .filter((row: any) => row.result)
        .map((row: any): Hit => ({
          id: `pc:${row.result.postcode}`,
          label: row.result.postcode,
          sub: [row.result.admin_ward, row.result.admin_district]
            .filter(Boolean)
            .join(", "),
          lat: row.result.latitude,
          lon: row.result.longitude,
          zoom: 17,
          source: "postcode",
        }));
    }
  } catch {
    // A search source being down shouldn't break the whole search box.
  }

  return [];
}

async function osmHits(q: string): Promise<Hit[]> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("countrycodes", "gb");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "6");

    const r = await spaced(() =>
      fetch(url, {
        headers: {
          "User-Agent": "TMDMap/1.0 (tmdmap.services)",
          "Accept-Language": "en-GB",
        },
        cache: "no-store",
      })
    );
    if (!r.ok) return [];
    const rows = await r.json();
    if (!Array.isArray(rows)) return [];

    return rows.map((row: any): Hit => {
      const parts: string[] = String(row.display_name).split(", ");
      return {
        // Not every Nominatim row carries osm_type/osm_id (postcode centroids
        // in particular), but place_id is always present and unique.
        id: `osm:${row.place_id ?? `${row.lat},${row.lon}`}`,
        label: row.name || parts[0],
        sub: parts.slice(1).join(", "),
        lat: Number(row.lat),
        lon: Number(row.lon),
        // Buildings and addresses deserve a closer view than towns.
        zoom:
          row.addresstype === "building" || row.addresstype === "house"
            ? 18
            : row.addresstype === "road"
              ? 17
              : 14,
        source: "osm",
      };
    });
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  // Same-origin only, so the proxy can't be used as a free geocoder by anyone
  // who finds the URL — it's our OSM reputation on the line.
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

  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.body);
  }

  const [pc, osm] = await Promise.all([postcodeHits(q), osmHits(q)]);

  // Postcode matches first — that's the most common way a site gets identified.
  const seen = new Set<string>();
  const results = [...pc, ...osm].filter((h) => {
    if (seen.has(h.id)) return false;
    seen.add(h.id);
    return Number.isFinite(h.lat) && Number.isFinite(h.lon);
  });

  const body = { results: results.slice(0, 8) };

  // Cheap bounded cache: drop the oldest entry once it's full.
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), body });

  return NextResponse.json(body);
}
