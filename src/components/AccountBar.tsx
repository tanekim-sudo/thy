"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * The only persistent chrome besides the orb: a quiet bar at the top.
 * Guests are told they're roaming free and invited to create a field;
 * signed-in minds see who they are and a way out.
 */
export function AccountBar() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signOut() {
    if (!isSupabaseConfigured) return;
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
  }

  if (!ready) return null;

  return (
    <div className="fixed right-5 top-4 z-40 flex items-center gap-4 text-[12px] font-light tracking-wide">
      {email ? (
        <>
          <span className="hidden text-[rgba(150,180,210,0.4)] sm:inline">{email}</span>
          <button
            onClick={signOut}
            className="text-[rgba(150,180,210,0.45)] underline-offset-4 transition-colors hover:text-[rgba(200,220,240,0.8)] hover:underline"
          >
            sign out
          </button>
        </>
      ) : (
        <>
          <span className="hidden italic text-[rgba(150,180,210,0.32)] sm:inline">
            playing as guest
          </span>
          <Link
            href="/login"
            className="text-[rgba(160,195,225,0.6)] underline-offset-4 transition-colors hover:text-[rgba(205,225,245,0.9)] hover:underline"
          >
            log in
          </Link>
          <Link
            href="/login?mode=signup"
            className="rounded-full border border-[rgba(150,190,220,0.25)] bg-[rgba(120,180,230,0.07)] px-3.5 py-1.5 text-[rgba(200,220,240,0.8)] transition-colors hover:bg-[rgba(120,180,230,0.14)]"
          >
            sign up
          </Link>
        </>
      )}
    </div>
  );
}
