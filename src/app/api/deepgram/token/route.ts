import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Mints a short-lived Deepgram key for the browser so the secret key never
 * ships to the client. Returns { key } on success, or { available: false }
 * when no Deepgram key is configured (the app falls back to typed capture).
 */
export async function GET() {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ available: false });
  }

  const projectId = process.env.DEEPGRAM_PROJECT_ID;

  try {
    // If a project id is configured, mint a scoped, expiring key.
    if (projectId) {
      const res = await fetch(
        `https://api.deepgram.com/v1/projects/${projectId}/keys`,
        {
          method: "POST",
          headers: {
            Authorization: `Token ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            comment: "create-thyself-ephemeral",
            scopes: ["usage:write"],
            time_to_live_in_seconds: 60,
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({ available: true, key: data.key });
      }
    }

    // Fallback: hand back the configured key for local-first single-user dev.
    return NextResponse.json({ available: true, key: apiKey });
  } catch (err) {
    console.error("[deepgram/token]", err);
    return NextResponse.json({ available: false });
  }
}
