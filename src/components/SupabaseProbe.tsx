"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Temporary connectivity probe. Logs the result of a trivial Supabase query to
 * the browser console on load. Remove once the shared layer is wired up.
 *
 * A "table not found" error here is still a SUCCESS for the connection test —
 * it means the client reached Supabase; the table just doesn't exist yet.
 */
export function SupabaseProbe() {
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("sync_operations")
        .select("operation_id")
        .limit(1);
      console.log("Supabase test:", data, error);
    })();
  }, []);

  return null;
}
