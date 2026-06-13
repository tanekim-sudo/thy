import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client — for the shared layer only (the eventual mycelium cosmos),
 * never the private local-first field.
 *
 * Created lazily and defensively: if the NEXT_PUBLIC_SUPABASE_* env vars are
 * absent (e.g. during a CI/Vercel build where they aren't configured), this
 * stays null instead of throwing at import time and breaking the build. Callers
 * must handle the null case. Uses the publishable (anon) key, which is meant to
 * be exposed in the client — guard data with Row-Level Security.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!client) client = createClient(url!, anonKey!);
  return client;
}

/** Convenience handle — null when Supabase isn't configured. */
export const supabase: SupabaseClient | null = getSupabase();
