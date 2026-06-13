import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Server-side Supabase client bound to the request's cookies. Returns null when
 * Supabase isn't configured so callers can fail closed (treat as unauthenticated)
 * instead of crashing the build or runtime.
 *
 * Cookie writes are wrapped in try/catch because Server Components render in a
 * read-only cookie context; the middleware is responsible for refreshing tokens.
 */
export function createSupabaseServerClient() {
  if (!isSupabaseConfigured) return null;

  const cookieStore = cookies();

  return createServerClient(url!, anonKey!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options as CookieOptions)
          );
        } catch {
          // Called from a Server Component — safe to ignore.
        }
      },
    },
  });
}
