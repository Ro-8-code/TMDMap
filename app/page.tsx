import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  // With no auth backend there is nothing to sign in to, and the login page
  // is a dead end. Send people to the map instead.
  if (!supabaseConfigured) redirect("/map");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/map" : "/login");
}
