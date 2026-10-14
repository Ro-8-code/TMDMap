import MapView from "./MapView";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  // Who is exporting. Stamped onto every file that leaves the app, so a
  // drawing produced on a shared login still carries the account it came from.
  let account = "";
  if (supabaseConfigured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    account = data.user?.email ?? "";
  }

  // The key itself stays on the server; the client only learns whether OS
  // mapping is available so it can pick a sensible default basemap.
  return (
    <MapView osConfigured={Boolean(process.env.OS_API_KEY)} account={account} />
  );
}
