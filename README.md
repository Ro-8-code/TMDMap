# TMD Map

Ordnance Survey mapping for traffic-management drawings. Search a UK address or
postcode, land on the site, capture the map into AutoCAD.

**Setup instructions: [SETUP.md](SETUP.md)** — start there.

## What it does

- **Accounts.** Email + password signup, with a verification email that must be
  clicked before sign-in works. Sessions handled by Supabase Auth.
- **Search.** One box, Google-Maps style. Full postcodes, partial postcodes,
  street names, place names and building numbers.
- **Maps.** Five basemaps: OS Leisure (1:25k/1:50k paper style), OS Outdoor,
  OS Road, OS Light, and OpenStreetMap as a no-key fallback.

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
- **`middleware.ts`** — gates `/map` behind a session and bounces signed-in
  users away from the auth pages. If Supabase env vars are absent it stands
  down entirely, so the app still boots and shows a setup message rather than
  crashing.

## Development

```bash
npm run dev     # http://localhost:3100
npm run build
```
