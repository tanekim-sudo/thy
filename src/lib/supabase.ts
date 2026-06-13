import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client.
 *
 * Note on the product's local-first philosophy: a user's field lives on their
 * own device (Prisma/SQLite), and spoken thoughts are transcribed locally once
 * whisper.cpp lands. Supabase is for the *shared* layer only — the eventual
 * mycelium cosmos where two fields touch — never the private field itself.
 *
 * Uses the publishable (anon) key, which is designed to be exposed in the
 * client. Row-Level Security must guard anything that touches it.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
