/**
 * Turns an Ordnance Survey vector style into survey-drawing linework.
 *
 * The competitor drawings we're matching aren't screenshots of a map — they're
 * OS MasterMap/NGD topography drawn as thin grey lines: building footprints,
 * both kerb lines of every road, pavement edges, property boundaries. A raster
 * basemap can't produce that at any resolution.
 *
 * Rather than hand-listing OS's source-layer names — which are undocumented
 * and would silently rot when OS changes their schema — this walks whatever
 * style OS serves and rewrites it by layer *type*. Fills lose their colour and
 * keep only an outline, lines go thin and grey, text goes grey. The result
 * reads as a drawing backdrop whatever OS put in the style.
 */

export type AnyStyle = {
  version: number;
  sources: Record<string, Record<string, unknown>>;
  sprite?: string | Array<{ id: string; url: string }>;
  glyphs?: string;
  layers: Array<Record<string, any>>;
  [k: string]: unknown;
};

/**
 * Ink weights, chosen to read like a plotted drawing rather than a web map.
 *
 * OS serve their topography as filled polygons — buildings, road surfaces,
 * land parcels. A drawing wants the edges, not the fills, and it wants them
 * ranked: buildings read heaviest, road casings next, then structures and
 * boundaries. MapLibre's `fill-outline-color` is stuck at one pixel, which is
 * what made the first attempt look washed out, so anything needing real weight
 * gets a companion line layer drawn over the top of the fill.
 */
const PAPER = "#ffffff";
const DEFAULT_INK = "#6e6e6e";
const TEXT = "#3f3f3f";

type Weight = { color: string; width: number };

// Keyed on the NGD source-layer names. Anything not listed still gets sensible
// defaults by layer type, so an OS schema change degrades rather than breaks.
const WEIGHTS: Record<string, Weight> = {
  bld_fts_buildingpart: { color: "#1a1a1a", width: 1.3 },
  Local_buildings: { color: "#1a1a1a", width: 1.1 },
  District_buildings: { color: "#1a1a1a", width: 1.1 },

  trn_fts_roadtrackorpath: { color: "#3d3d3d", width: 1.0 },
  trn_fts_roadline: { color: "#3d3d3d", width: 1.0 },
  Roads: { color: "#3d3d3d", width: 1.0 },
  trn_ntwk_pathlink: { color: "#8a8a8a", width: 0.7 },
  trn_fts_rail: { color: "#4a4a4a", width: 0.9 },
  trn_fts_cartographicraildetail: { color: "#4a4a4a", width: 0.8 },

  str_fts_structure: { color: "#5a5a5a", width: 0.85 },
  str_fts_structureline: { color: "#6e6e6e", width: 0.75 },
  str_fts_compoundstructure: { color: "#5a5a5a", width: 0.85 },
  str_fts_fieldboundary: { color: "#9a9a9a", width: 0.6 },

  lnd_fts_land: { color: "#a2a2a2", width: 0.6 },
  lnd_fts_landform: { color: "#a2a2a2", width: 0.6 },
  lnd_fts_landformline: { color: "#a2a2a2", width: 0.6 },

  wtr_fts_water: { color: "#6f8fa6", width: 0.9 },
  wtr_ntwk_waterlink: { color: "#6f8fa6", width: 0.8 },
  Surfacewater: { color: "#6f8fa6", width: 0.9 },
  Waterlines: { color: "#6f8fa6", width: 0.8 },
};

// Fills in this set are heavy enough to deserve a real stroke rather than the
// one-pixel outline a fill layer can manage.
const NEEDS_STROKE = new Set(
  Object.entries(WEIGHTS)
    .filter(([, w]) => w.width >= 0.75)
    .map(([name]) => name)
);

export function toCadLinework(style: AnyStyle): AnyStyle {
  const layers: Record<string, any>[] = [];

  for (const layer of style.layers) {
    const src = layer["source-layer"] as string | undefined;
    const weight = src ? WEIGHTS[src] : undefined;
    const next: Record<string, any> = {
      ...layer,
      paint: { ...(layer.paint ?? {}) },
      layout: { ...(layer.layout ?? {}) },
    };

    switch (layer.type) {
      case "background":
        next.paint["background-color"] = PAPER;
        delete next.paint["background-pattern"];
        layers.push(next);
        break;

      case "fill": {
        // Keep the shape, drop the colour.
        next.paint["fill-color"] = PAPER;
        next.paint["fill-opacity"] = 1;
        next.paint["fill-outline-color"] = weight?.color ?? DEFAULT_INK;
        delete next.paint["fill-pattern"];
        layers.push(next);

        if (src && NEEDS_STROKE.has(src)) {
          layers.push({
            id: `${layer.id}__edge`,
            type: "line",
            source: layer.source,
            "source-layer": src,
            ...(layer.filter ? { filter: layer.filter } : {}),
            ...(layer.minzoom !== undefined ? { minzoom: layer.minzoom } : {}),
            ...(layer.maxzoom !== undefined ? { maxzoom: layer.maxzoom } : {}),
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": weight!.color, "line-width": weight!.width },
          });
        }
        break;
      }

      case "line":
        next.paint["line-color"] = weight?.color ?? DEFAULT_INK;
        next.paint["line-opacity"] = 1;
        next.paint["line-width"] = weight ? weight.width : thinLine(layer.paint?.["line-width"]);
        delete next.paint["line-pattern"];
        delete next.paint["line-gradient"];
        layers.push(next);
        break;

      case "symbol":
        // Street names and house numbers are half the value of a survey
        // drawing, so they stay — just in drawing ink.
        next.paint["text-color"] = TEXT;
        next.paint["text-halo-color"] = PAPER;
        next.paint["text-halo-width"] = 1.4;
        delete next.layout["icon-image"];
        delete next.paint["icon-color"];
        layers.push(next);
        break;

      case "fill-extrusion":
        // 3D buildings have no place on a plan drawing.
        break;

      default:
        layers.push(next);
    }
  }

  return { ...style, layers };
}


/**
 * Halves a line width wherever it appears, including inside MapLibre's
 * zoom-interpolation expressions. Used for layers we have no explicit weight
 * for, so unknown OS layers stay proportionate instead of becoming slabs.
 */
function thinLine(width: unknown): unknown {
  if (typeof width === "number") return Math.max(0.5, width * 0.5);
  if (Array.isArray(width)) return width.map((v) => (typeof v === "number" ? thinLine(v) : v));
  if (width && typeof width === "object") {
    const w = width as { stops?: Array<[number, number]> };
    if (Array.isArray(w.stops)) {
      return { ...w, stops: w.stops.map(([z, v]) => [z, Math.max(0.5, v * 0.5)]) };
    }
  }
  return width ?? 0.7;
}

/**
 * Points every URL in the style back at our own proxy, so the OS API key stays
 * on the server. Tiles, sprites and glyphs all carry the key otherwise.
 */
export function rewriteUrls(style: AnyStyle, base: string): AnyStyle {
  const proxy = (url: string) => {
    const match = url.match(/^https:\/\/api\.os\.uk\/(.+?)(\?.*)?$/);
    return match ? `${base}/api/os/${match[1]}` : url;
  };

  const sources: AnyStyle["sources"] = {};
  for (const [id, source] of Object.entries(style.sources ?? {})) {
    const copy: Record<string, unknown> = { ...source };

    if (Array.isArray(copy.tiles)) {
      copy.tiles = (copy.tiles as string[]).map(proxy);
    }

    if (typeof copy.url === "string") {
      // OS point the source at an OGC tileset document rather than TileJSON,
      // which MapLibre can't read — and following it would hand the browser
      // tile URLs with our key in them. Build the tile template directly
      // instead. OS order the path tileMatrix/tileRow/tileCol, so it's
      // {z}/{y}/{x}, not the {z}/{x}/{y} nearly every other service uses.
      const tileset = copy.url.match(
        /^https:\/\/api\.os\.uk\/(.+?\/tiles\/[^/?]+)(\?.*)?$/
      );
      if (tileset) {
        copy.tiles = [`${base}/api/os/${tileset[1]}/{z}/{y}/{x}`];
        delete copy.url;
      } else {
        copy.url = proxy(copy.url);
      }
    }

    sources[id] = copy;
  }

  return {
    ...style,
    sources,
    sprite:
      typeof style.sprite === "string"
        ? proxy(style.sprite)
        : Array.isArray(style.sprite)
          ? style.sprite.map((s) => ({ ...s, url: proxy(s.url) }))
          : style.sprite,
    glyphs: typeof style.glyphs === "string" ? proxy(style.glyphs) : style.glyphs,
  };
}
