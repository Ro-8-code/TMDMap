import type { Map as MLMap } from "maplibre-gl";
import { gridRef } from "./osgb";

/** Metres of ground per screen pixel, at a given latitude and zoom. */
export function metresPerPixel(lat: number, zoom: number) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

/**
 * The zoom at which the map draws at a given paper scale, assuming a 96 DPI
 * display — the same assumption AutoCAD and every UK drawing office makes.
 */
export function zoomForScale(scale: number, lat: number) {
  const metresPerCssPixel = (0.0254 / 96) * scale;
  return Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / metresPerCssPixel);
}

/** A round scale-bar length that fits comfortably inside `maxPx` pixels. */
function niceBarLength(maxMetres: number) {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  let best = steps[0];
  for (const s of steps) if (s <= maxMetres) best = s;
  return best;
}

/**
 * Renders the current map view to a PNG with a caption strip burned in.
 *
 * The strip is the point of this: once the image is in AutoCAD there's no
 * metadata left, so the scale bar, grid reference and metres-per-pixel figure
 * have to be pixels in the image itself. Scaling the raster against a known
 * ground length is the reliable way in, whatever DPI the export happened at.
 */
export async function captureMap(
  map: MLMap,
  label: string,
  attribution: string
): Promise<Blob> {
  const src = map.getCanvas();
  const centre = map.getCenter();
  const zoom = map.getZoom();

  // The map canvas is sized in device pixels; keep them, so the export is as
  // sharp as the display allowed rather than being downsampled to CSS pixels.
  const dpr = src.width / src.clientWidth;
  const mpp = metresPerPixel(centre.lat, zoom) / dpr;

  const STRIP = Math.round(64 * dpr);
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height + STRIP;

  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Could not create the export canvas.");

  // MapLibre renders on demand, so ask for a repaint before reading the
  // drawing buffer — otherwise it can come back empty. The wait is raced
  // against a timeout because a map with nothing left to draw may never fire
  // another 'render', and a stuck export button is worse than a stale frame.
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      map.off("render", done);
      resolve();
    };
    const timer = setTimeout(done, 1500);
    map.once("render", done);
    map.triggerRepaint();
  });

  ctx.drawImage(src, 0, 0);

  // ---- caption strip ----
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, src.height, out.width, STRIP);
  ctx.fillStyle = "#111815";
  ctx.fillRect(0, src.height, out.width, Math.max(1, Math.round(2 * dpr)));

  const pad = Math.round(16 * dpr);
  const baseY = src.height + Math.round(26 * dpr);

  // Scale bar, sized to a round ground distance.
  const maxBarPx = Math.min(out.width * 0.25, 260 * dpr);
  const barMetres = niceBarLength(maxBarPx * mpp);
  const barPx = barMetres / mpp;
  const barY = src.height + Math.round(40 * dpr);

  ctx.strokeStyle = "#111815";
  ctx.fillStyle = "#111815";
  ctx.lineWidth = Math.max(1, Math.round(1.5 * dpr));
  ctx.beginPath();
  ctx.moveTo(pad, barY - Math.round(5 * dpr));
  ctx.lineTo(pad, barY);
  ctx.lineTo(pad + barPx, barY);
  ctx.lineTo(pad + barPx, barY - Math.round(5 * dpr));
  ctx.stroke();

  ctx.font = `${Math.round(11 * dpr)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(
    barMetres >= 1000 ? `${barMetres / 1000} km` : `${barMetres} m`,
    pad + barPx + Math.round(8 * dpr),
    barY
  );

  // Location line.
  const ref = gridRef(centre.lat, centre.lng, 5);
  ctx.font = `600 ${Math.round(13 * dpr)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(label || "Site location", pad, baseY);

  ctx.font = `${Math.round(11 * dpr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillStyle = "#4a535d";
  const detail = [
    ref ? `NGR ${ref}` : null,
    `${centre.lat.toFixed(5)}, ${centre.lng.toFixed(5)}`,
    `${mpp.toFixed(3)} m/px`,
  ]
    .filter(Boolean)
    .join("   ·   ");
  ctx.fillText(detail, pad + Math.round(220 * dpr), baseY);

  // Attribution, right-aligned — it has to travel with the image.
  ctx.textAlign = "right";
  ctx.font = `${Math.round(10 * dpr)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(attribution, out.width - pad, src.height + Math.round(48 * dpr));
  ctx.textAlign = "left";

  return new Promise((resolve, reject) => {
    out.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed."))),
      "image/png"
    );
  });
}

/** A filename a drawing office can read at a glance. */
export function captureFilename(label: string, lat: number, lon: number) {
  const ref = gridRef(lat, lon, 5)?.replace(/\s+/g, "") ?? "nogrid";
  const slug =
    label
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "site";
  const stamp = new Date().toISOString().slice(0, 10);
  return `TMDMap_${slug}_${ref}_${stamp}.png`;
}
