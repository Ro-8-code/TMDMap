/**
 * DXF writer for traffic management base drawings.
 *
 * A raster screenshot has to be scaled by eye and can't be snapped to. This
 * writes real geometry in British National Grid metres, so the drawing opens
 * in AutoCAD at true 1:1 — an easting/northing in the file is the same number
 * the site is dimensioned against.
 *
 * Format is DXF R12 (AC1009). It's the oldest and plainest revision, which is
 * exactly why it's used: every CAD package on the market reads it without
 * complaint, and it needs no handles, classes or object tables.
 */

export type DxfLayerSpec = { name: string; colour: number };
export type DxfPolyline = { layer: string; points: Array<[number, number]>; closed: boolean };

/**
 * AutoCAD Colour Index values. Chosen to print sensibly in monochrome: the
 * heavier the feature, the darker it plots.
 */
export const TM_LAYERS: Record<string, DxfLayerSpec> = {
  building: { name: "TMD-BUILDING", colour: 7 },
  kerb: { name: "TMD-KERB", colour: 1 },
  road: { name: "TMD-ROAD", colour: 3 },
  path: { name: "TMD-PATH", colour: 4 },
  rail: { name: "TMD-RAIL", colour: 8 },
  structure: { name: "TMD-STRUCTURE", colour: 5 },
  boundary: { name: "TMD-BOUNDARY", colour: 9 },
  water: { name: "TMD-WATER", colour: 5 },
  land: { name: "TMD-LAND", colour: 8 },
  other: { name: "TMD-OTHER", colour: 8 },
};

function pair(code: number | string, value: string | number): string {
  return `${code}\n${value}\n`;
}

export function buildDxf(
  polylines: DxfPolyline[],
  bounds: { minE: number; minN: number; maxE: number; maxN: number }
): string {
  const used = new Map<string, DxfLayerSpec>();
  for (const spec of Object.values(TM_LAYERS)) used.set(spec.name, spec);

  let out = "";

  // ---- HEADER: drawing extents, in National Grid metres ----
  out += pair(0, "SECTION") + pair(2, "HEADER");
  out += pair(9, "$ACADVER") + pair(1, "AC1009");
  out += pair(9, "$INSUNITS") + pair(70, 6); // 6 = metres
  out += pair(9, "$EXTMIN") + pair(10, bounds.minE.toFixed(3)) + pair(20, bounds.minN.toFixed(3)) + pair(30, "0.0");
  out += pair(9, "$EXTMAX") + pair(10, bounds.maxE.toFixed(3)) + pair(20, bounds.maxN.toFixed(3)) + pair(30, "0.0");
  out += pair(0, "ENDSEC");

  // ---- TABLES: layer definitions ----
  out += pair(0, "SECTION") + pair(2, "TABLES");
  out += pair(0, "TABLE") + pair(2, "LAYER") + pair(70, used.size);
  for (const spec of used.values()) {
    out += pair(0, "LAYER");
    out += pair(2, spec.name);
    out += pair(70, 0);
    out += pair(62, spec.colour);
    out += pair(6, "CONTINUOUS");
  }
  out += pair(0, "ENDTAB") + pair(0, "ENDSEC");

  // ---- ENTITIES ----
  out += pair(0, "SECTION") + pair(2, "ENTITIES");
  for (const pl of polylines) {
    if (pl.points.length < 2) continue;

    out += pair(0, "POLYLINE");
    out += pair(8, pl.layer);
    out += pair(66, 1); // vertices follow
    out += pair(70, pl.closed ? 1 : 0);
    out += pair(10, "0.0") + pair(20, "0.0") + pair(30, "0.0");

    for (const [e, n] of pl.points) {
      out += pair(0, "VERTEX");
      out += pair(8, pl.layer);
      out += pair(10, e.toFixed(3));
      out += pair(20, n.toFixed(3));
      out += pair(30, "0.0");
    }

    out += pair(0, "SEQEND") + pair(8, pl.layer);
  }
  out += pair(0, "ENDSEC");
  out += pair(0, "EOF");

  return out;
}

/**
 * Maps an OS NGD source-layer onto a CAD layer. Road surface polygons are the
 * important one: their edges are the kerb lines a TM scheme is set out from,
 * so they get their own layer rather than being lumped in with carriageway.
 */
export function layerFor(sourceLayer: string): DxfLayerSpec {
  const s = sourceLayer.toLowerCase();
  if (s.includes("building")) return TM_LAYERS.building;
  if (s.includes("roadtrackorpath") || s.includes("roadline")) return TM_LAYERS.kerb;
  if (s.startsWith("roads") || s === "roads") return TM_LAYERS.road;
  if (s.includes("path")) return TM_LAYERS.path;
  if (s.includes("rail")) return TM_LAYERS.rail;
  if (s.includes("fieldboundary")) return TM_LAYERS.boundary;
  if (s.includes("structure")) return TM_LAYERS.structure;
  if (s.includes("water") || s.includes("surfacewater")) return TM_LAYERS.water;
  if (s.startsWith("lnd_") || s.includes("land")) return TM_LAYERS.land;
  return TM_LAYERS.other;
}
