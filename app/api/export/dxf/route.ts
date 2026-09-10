import { NextResponse, type NextRequest } from "next/server";
import { requireUser, withinRateLimit } from "@/lib/apiAuth";
import { decodeTile } from "@/lib/mvt";
import { buildDxf, layerFor, type DxfPolyline } from "@/lib/dxf";
import { latLonToGrid, gridRef } from "@/lib/osgb";

/**
 * Exports the current view as CAD geometry rather than a picture.
 *
 * Tiles are fetched for the requested extent, decoded, reprojected from Web
 * Mercator into British National Grid, and written out as DXF in metres. The
 * result opens in AutoCAD at true 1:1 with real eastings and northings, so it
 * can be snapped to and dimensioned — which a screenshot never can.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const NGD = "https://api.os.uk/maps/vector/ngd/ota/v1/collections/ngd-base/tiles/3857";

// A ceiling on how much ground one export may cover. Tiles are the expensive
// unit here, and an accidental national-scale request would be costly.
const MAX_TILES = 36;

function lonToX(lon: number, z: number) {
  return ((lon + 180) / 360) * Math.pow(2, z);
}
function latToY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
}
function xToLon(x: number, z: number) {
  return (x / Math.pow(2, z)) * 360 - 180;
}
function yToLat(y: number, z: number) {
  const n = Math.PI - 2 * Math.PI * (y / Math.pow(2, z));
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  if (!withinRateLimit(auth.userId)) {
    return new NextResponse("Too many requests", { status: 429 });
  }

  const key = process.env.OS_API_KEY;
  if (!key) return new NextResponse("OS_API_KEY not configured", { status: 404 });

  const p = request.nextUrl.searchParams;
  const west = Number(p.get("west"));
  const south = Number(p.get("south"));
  const east = Number(p.get("east"));
  const north = Number(p.get("north"));
  // 16 is where OS start publishing detailed topography; below it there is
  // nothing worth exporting.
  const zoom = Math.min(Math.max(Number(p.get("zoom")) || 17, 16), 19);

  if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) {
    return new NextResponse("Invalid bounds", { status: 400 });
  }

  const x0 = Math.floor(lonToX(west, zoom));
  const x1 = Math.floor(lonToX(east, zoom));
  const y0 = Math.floor(latToY(north, zoom));
  const y1 = Math.floor(latToY(south, zoom));

  const count = (x1 - x0 + 1) * (y1 - y0 + 1);
  if (count > MAX_TILES) {
    return new NextResponse(
      `Area too large: ${count} tiles (limit ${MAX_TILES}). Zoom in or reduce the export area.`,
      { status: 413 }
    );
  }

  const polylines: DxfPolyline[] = [];
  const bounds = { minE: Infinity, minN: Infinity, maxE: -Infinity, maxN: -Infinity };

  const jobs: Promise<void>[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      jobs.push(
        (async (tx: number, ty: number) => {
          // OS order the path tileMatrix/tileRow/tileCol, so row precedes column.
          const res = await fetch(`${NGD}/${zoom}/${ty}/${tx}?key=${key}`, {
            headers: { Accept: "application/octet-stream" },
            next: { revalidate: 86400 },
          });
          if (!res.ok) return;

          const layers = decodeTile(await res.arrayBuffer());

          for (const layer of layers) {
            // Label layers carry points and text we can't place meaningfully
            // in CAD, so they're skipped rather than dropped in as stray dots.
            if (layer.name.includes("/label")) continue;
            const spec = layerFor(layer.name);

            for (const feature of layer.features) {
              if (feature.type === 1) continue; // points add nothing to a base map
              for (const part of feature.parts) {
                if (part.length < 2) continue;

                const pts: Array<[number, number]> = [];
                for (const [px, py] of part) {
                  // Tile-local units -> Web Mercator tile space -> lon/lat
                  const lon = xToLon(tx + px / layer.extent, zoom);
                  const lat = yToLat(ty + py / layer.extent, zoom);
                  const g = latLonToGrid(lat, lon);
                  pts.push([g.easting, g.northing]);
                  if (g.easting < bounds.minE) bounds.minE = g.easting;
                  if (g.easting > bounds.maxE) bounds.maxE = g.easting;
                  if (g.northing < bounds.minN) bounds.minN = g.northing;
                  if (g.northing > bounds.maxN) bounds.maxN = g.northing;
                }

                polylines.push({
                  layer: spec.name,
                  points: pts,
                  closed: feature.type === 3,
                });
              }
            }
          }
        })(x, y)
      );
    }
  }

  await Promise.all(jobs);

  if (!polylines.length) {
    return new NextResponse("No mapping found for that area", { status: 404 });
  }

  const dxf = buildDxf(polylines, bounds);
  const centreLat = (north + south) / 2;
  const centreLon = (east + west) / 2;
  const ref = gridRef(centreLat, centreLon, 5)?.replace(/\s+/g, "") ?? "site";
  const name = `TMDMap_${ref}_${new Date().toISOString().slice(0, 10)}.dxf`;

  return new NextResponse(dxf, {
    status: 200,
    headers: {
      "Content-Type": "application/dxf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "X-TMD-Entities": String(polylines.length),
      "Cache-Control": "private, no-store",
    },
  });
}
