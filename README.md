# TMD Map

Ordnance Survey mapping for traffic-management drawings. Search a UK address or
postcode, land on the site, capture the map into AutoCAD.

**Setup instructions: [SETUP.md](SETUP.md)** — start there.

## What it does

- **Accounts.** Email + password signup, with a verification email that must be
  clicked before sign-in works. Sessions handled by Supabase Auth.
- **Search.** One box, Google-Maps style. Full postcodes, partial postcodes,
  street names, place names and building numbers.
- **Maps.** OS NGD vector (MasterMap-grade detail) in either drawing linework
  or full OS styling, plus the OS Maps raster backdrops (Leisure, Outdoor,
  Road, Light) and OpenStreetMap as a no-key fallback.
- **Scale lock.** One click snaps the view to 1:200, 1:500, 1:1250 or 1:2500,
  the standard UK drawing-office scales.
- **Export PNG.** Downloads the map at full device resolution with no UI over
  it, and a caption strip burned in carrying the scale bar, National Grid
  reference, coordinates and attribution.

## Stack

Next.js 15 (App Router) · MapLibre GL JS · Supabase Auth · deployed on Vercel.
No paid services.

## Notable bits

- **`app/api/tiles/[layer]/[z]/[x]/[y]/route.ts`** — the OS Data Hub key is
  passed to OS as a query parameter, so requesting tiles straight from the
  browser would publish the key and let anyone burn the free allowance. All
  tiles are proxied through this route instead; the key never leaves the
  server, and the proxy only answers same-origin requests.
- **`app/api/search/route.ts`** — merges two free sources.
  [postcodes.io](https://postcodes.io) handles postcodes (exact ONS centroids,
  and it autocompletes partials), Nominatim handles everything else. Postcode
  hits are ranked first, since that's how a site usually gets identified.
  Proxied server-side so Nominatim gets the identifying User-Agent its usage
  policy requires.
- **`lib/osgb.ts`** — WGS84 lat/lon to an OSGB36 National Grid reference, the
  full way: a Helmert transformation onto Airy 1830 followed by the National
  Grid transverse Mercator projection. Traffic management drawings are
  dimensioned against the National Grid, so an approximation won't do.
  Verified to the metre against Buckingham Palace, Ben Nevis, Cardiff Castle
  and Deansgate.
- **`lib/capture.ts`** — the export. Once a raster is in AutoCAD there is no
  metadata left, so anything the drawing needs has to be pixels in the image:
  a scale bar of known ground length, the grid reference, and the exact
  metres-per-pixel. Scaling the raster against the bar is reliable whatever
  DPI the export happened at.
- **`lib/cadStyle.ts`** — turns an OS vector style into survey linework. OS's
  source-layer names aren't documented and would rot as their schema changes,
  so this rewrites the style by layer *type* instead: fills lose their colour
  and keep an outline, lines thin to pen strokes, icons go. Building footprints
  come out as footprints whatever OS called the layer.
- **`app/api/ngd-style/route.ts`** — fetches OS's own stylesheet, points every
  URL in it back at our proxy so the key stays server-side, then applies the
  transform. Deriving from the live style means new OS layers appear on their
  own.
- **`middleware.ts`** — gates `/map` behind a session and bounces signed-in
  users away from the auth pages. If Supabase env vars are absent it stands
  down entirely, so the app still boots and shows a setup message rather than
  crashing.

## Development

```bash
npm run dev     # http://localhost:3100
npm run build
```
