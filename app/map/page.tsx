import MapView from "./MapView";

export const dynamic = "force-dynamic";

export default function MapPage() {
  // The key itself stays on the server; the client only learns whether OS
  // mapping is available so it can pick a sensible default basemap.
  return <MapView osConfigured={Boolean(process.env.OS_API_KEY)} />;
}
