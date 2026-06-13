"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * A near-invisible account presence in the corner. Hovering reveals the signed-in
 * email and a way out. Kept faint so it never competes with the field.
 */
export function AccountBadge() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  async function signOut() {
    if (!isSupabaseConfigured) return;
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  if (!email) return null;

  return (
    <div
      className="fixed right-4 top-4 z-40 flex flex-col items-end gap-1"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[rgba(160,200,235,0.35)]" />
      {open && (
        <div className="flex flex-col items-end gap-1.5 rounded-lg bg-[rgba(10,12,20,0.6)] px-3 py-2 backdrop-blur-sm">
          <span className="text-[11px] font-light tracking-wide text-[rgba(180,205,230,0.5)]">
            {email}
          </span>
          <button
            onClick={signOut}
            className="text-[11px] font-light tracking-wide text-[rgba(150,180,210,0.45)] underline-offset-4 transition-colors hover:text-[rgba(200,220,240,0.8)] hover:underline"
          >
            sign out
          </button>
        </div>
      )}
    </div>
  );
}
