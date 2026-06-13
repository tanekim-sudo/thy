import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "./supabase/server";

/** The authenticated user's id, or null when not signed in / not configured. */
export async function getUserId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Guard for API route handlers. Resolves to the userId, or returns a 401
 * response to short-circuit the handler:
 *
 *   const auth = await requireUser();
 *   if (auth instanceof NextResponse) return auth;
 *   const userId = auth;
 */
export async function requireUser(): Promise<string | NextResponse> {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return userId;
}
