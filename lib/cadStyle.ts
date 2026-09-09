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

/** Ink weights, chosen to read like a plotted drawing rather than a web map. */
const INK = "#8a8a8a";
const INK_STRONG = "#5c5c5c";
const TEXT = "#6b6b6b";
const PAPER = "#ffffff";

export function toCadLinework(style: AnyStyle): AnyStyle {
  const layers = style.layers.map((layer): Record<string, any> | null => {
    const next = { ...layer, paint: { ...(layer.paint ?? {}) }, layout: { ...(layer.layout ?? {}) } };

    switch (layer.type) {
      case "background":
        next.paint["background-color"] = PAPER;
        delete next.paint["background-pattern"];
        break;

      case "fill":
        // Keep the shape, drop the colour: a hairline outline and no wash. This
        // is what turns filled building polygons into footprint outlines.
        next.paint["fill-color"] = PAPER;
        next.paint["fill-opacity"] = 1;
        next.paint["fill-outline-color"] = INK_STRONG;
        delete next.paint["fill-pattern"];
        break;

      case "line":
        next.paint["line-color"] = INK;
        next.paint["line-opacity"] = 1;
        // Road casings arrive as wide coloured lines; thin them to pen strokes.
        next.paint["line-width"] = thinLine(layer.paint?.["line-width"]);
        delete next.paint["line-pattern"];
        delete next.paint["line-gradient"];
        break;

      case "symbol":
        next.paint["text-color"] = TEXT;
        next.paint["text-halo-color"] = PAPER;
        next.paint["text-halo-width"] = 1.2;
        // Icons are web-map furniture (POI pins, shields) and only add noise
        // under a traffic management overlay.
        delete next.layout["icon-image"];
        delete next.paint["icon-color"];
        break;

      case "fill-extrusion":
        // 3D buildings have no place on a plan drawing.
        return null;

      default:
        break;
    }

    return next;
  });

  return {
    ...style,
    layers: layers.filter((l): l is Record<string, any> => l !== null),
  };
}

/**
 * Halves a line width wherever it appears, including inside MapLibre's
 * zoom-interpolation expressions, so roads stay proportionate as you zoom
 * instead of becoming slabs.
 */
function thinLine(width: unknown): unknown {
  if (typeof width === "number") return Math.max(0.4, width * 0.45);
  if (Array.isArray(width)) return width.map((v) => (typeof v === "number" ? thinLine(v) : v));
  if (width && typeof width === "object") {
    const w = width as { stops?: Array<[number, number]> };
    if (Array.isArray(w.stops)) {
      return { ...w, stops: w.stops.map(([z, v]) => [z, Math.max(0.4, v * 0.45)]) };
    }
  }
  return width ?? 0.6;
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
      copy.url = proxy(copy.url);
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
