"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  emitFieldEvent,
  isOnboardingComplete,
  markOnboardingComplete,
  onFieldEvent,
  ONBOARDING_KEY,
  type FieldEventName,
} from "@/lib/field-events";

interface Step {
  id: string;
  section: string;
  title: string;
  body: string;
  hint?: string;
  waitFor?: FieldEventName | FieldEventName[];
  spotlight?: "orb" | "center" | "top" | "page";
  guestNote?: string;
  /** Read-only step — no gesture required. */
  observe?: boolean;
}

const WAIT_TIMEOUT_MS = 20_000;

const STEPS: Step[] = [
  // —— Arrival ——
  {
    id: "welcome",
    section: "Arrival",
    title: "You are in the dark",
    body: "This is not a notes app. It is a living field — a cognitive medium where unformed thought can exist before it becomes a sentence. The opening fade is deliberate: you arrive in utter darkness, then the void reveals itself.",
    spotlight: "center",
    observe: true,
  },
  {
    id: "voice",
    section: "Capture",
    title: "Speak into the orb",
    body: "The faint glow at the bottom is the only chrome. Click it and speak — raw, unedited, false starts welcome. Deepgram transcribes live; prosody (pace, trailing off) becomes texture on the fragment.",
    hint: "Click the orb and say something aloud.",
    waitFor: "voice-start",
    spotlight: "orb",
  },
  {
    id: "type",
    section: "Capture",
    title: "Or type instead",
    body: "No microphone? The orb falls back to typing. A hidden line appears; press Enter to crystallize, Escape to release without committing.",
    hint: "If voice is blocked, click the orb again to type.",
    waitFor: "type-start",
    spotlight: "orb",
  },
  {
    id: "crystallize",
    section: "Capture",
    title: "Thought becomes matter",
    body: "When you finish, the phrase crystallizes into the field — a glowing spore with mass, luminosity, and position. Physics takes over: fragments drift, flock, and settle.",
    hint: "Complete a thought (voice or Enter).",
    waitFor: "crystallize",
    spotlight: "center",
  },
  {
    id: "negative",
    section: "Capture",
    title: "Negative space",
    body: "Start typing, then press Escape without committing. What you almost said leaves a peripheral trace — negative space. Abandoned partials haunt the edges of the field.",
    hint: "Click orb → type a few words → Escape.",
    waitFor: "negative-space",
    spotlight: "orb",
  },
  {
    id: "partial",
    section: "Capture",
    title: "Live partials",
    body: "While capturing, your in-progress words float at center in italic — never corrected, never auto-completed. Release without Enter and it becomes negative space instead.",
    spotlight: "center",
    observe: true,
  },

  // —— Selection & workbench ——
  {
    id: "select",
    section: "Workbench",
    title: "Highlight is the invocation",
    body: "Tap a fragment once. A bright ring means selected — separate from confidence (opacity). The workbench has no fixed location; it arrives when you highlight.",
    hint: "Tap any fragment.",
    waitFor: "select",
    spotlight: "center",
  },
  {
    id: "workbench",
    section: "Workbench",
    title: "Tools drift toward you",
    body: "After ~300ms, glyphs sail in from the screen edges like iron filings toward a magnet. Your most-used custom tools rank highest. Long-press a glyph to edit its instruction.",
    hint: "Wait for glyphs to arrive.",
    waitFor: "workbench-arrived",
    spotlight: "center",
  },
  {
    id: "reflect",
    section: "Workbench",
    title: "Reflect — constellation mode",
    body: "The expanding ring is Reflect. It runs Claude's reflection layer (or a local preview as guest): clusters brighten, faint labels drift over groups. On-demand — not automatic zoom-out.",
    hint: "Tap the Reflect glyph on your selection.",
    waitFor: "reflection",
    spotlight: "center",
    guestNote: "Guest: local cluster highlight. Sign in for Claude reflection.",
  },
  {
    id: "generic-tool",
    section: "Workbench",
    title: "Invoke a custom tool",
    body: "Any saved tool glyph runs Claude execute on your selection — new fragments materialize near the highlight. Tools gain mass each time you use them.",
    hint: "Tap any non-Reflect, non-Branch tool glyph.",
    waitFor: "tool-execute",
    spotlight: "center",
    guestNote: "Guest: local preview output. Sign in for Claude.",
  },
  {
    id: "create-tool",
    section: "Workbench",
    title: "Create a tool on the spot",
    body: "The open curve glyph creates a new tool: state an instruction in plain language ('find the contradiction', 'name the fear'). It saves to your workbench and runs immediately.",
    hint: "Tap open-curve → type instruction → Enter.",
    waitFor: "custom-tool-created",
    spotlight: "center",
  },

  // —— Gestures ——
  {
    id: "lasso",
    section: "Gestures",
    title: "Lasso many at once",
    body: "Hold Alt and draw a freehand loop through empty space. Everything inside gets selected — one gesture, one workbench response.",
    hint: "Alt + drag to lasso.",
    waitFor: "lasso",
    spotlight: "center",
  },
  {
    id: "drag",
    section: "Gestures",
    title: "Drag is thinking",
    body: "Drag a fragment through the field. Hold it near another — a resonance filament grows. Lichtenberg-style tubes pulse when connections fire. Pull apart to thin the link.",
    hint: "Drag one fragment near another.",
    waitFor: "drag-connect",
    spotlight: "center",
  },
  {
    id: "merge",
    section: "Gestures",
    title: "Fusion / synthesis",
    body: "Drop one fragment onto another (or let strongly-linked pairs collide). They fuse into a synthesis node; originals dim beneath like palimpsest layers — not deleted, buried.",
    hint: "Drag a fragment onto another to merge.",
    waitFor: "merge",
    spotlight: "center",
  },
  {
    id: "sketch",
    section: "Gestures",
    title: "Sketch stroke",
    body: "Hold Shift and drag across empty space. The stroke becomes its own sketch fragment, wired to whatever it passes near.",
    hint: "Shift + drag to sketch.",
    waitFor: "sketch",
    spotlight: "center",
  },

  // —— Thread → Page pipeline ——
  {
    id: "trace",
    section: "Page",
    title: "Trace a thread",
    body: "Hold Ctrl (or ⌘) and drag near fragments in reading order. A warm gold line links them — a thread through the field, persisted to your account.",
    hint: "Ctrl + drag across 2+ fragments.",
    waitFor: "trace-complete",
    spotlight: "center",
  },
  {
    id: "legibility",
    section: "Page",
    title: "Legibility — thread to text",
    body: "Long-press the gold thread (~850ms). Claude legibility weaves the traced fragments into coherent page text. Source fragments get a warm in-draft tint.",
    hint: "Long-press the gold thread line.",
    waitFor: "thread-legibility",
    spotlight: "center",
    guestNote: "Guest: local joined preview. Sign in for Claude legibility.",
  },
  {
    id: "page-open",
    section: "Page",
    title: "Page craft mode",
    body: "Legibility opens a floating page in the same void — editable, persistent, anchored near the thread's centroid. This is Part 17: field → trace → legibility → page → craft.",
    waitFor: "page-open",
    spotlight: "page",
    observe: true,
  },
  {
    id: "page-select",
    section: "Page",
    title: "Highlight text on the page",
    body: "On the page, highlight any passage. The same workbench glyphs arrive — Reflect, your tools, create-new — but scoped to text selection instead of field fragments.",
    hint: "Select words in the page editor.",
    waitFor: "page-selection",
    spotlight: "page",
  },
  {
    id: "page-tool",
    section: "Page",
    title: "Run a tool on the page",
    body: "Invoke a tool on highlighted page text. Claude returns alternatives below the page — click one to replace the selection. Edits auto-save to drafts.",
    hint: "Highlight text → tap a tool glyph.",
    waitFor: "page-tool-invoked",
    spotlight: "page",
    guestNote: "Guest: local alternative preview on 401.",
  },
  {
    id: "page-return",
    section: "Page",
    title: "Deleted text returns to the field",
    body: "When you replace or delete text on the page, the removed words return to the field as dim returned_from_draft fragments — nothing is ever truly lost.",
    hint: "Apply an alternative or delete a phrase on the page.",
    waitFor: "returned-from-draft",
    spotlight: "page",
  },
  {
    id: "page-close",
    section: "Page",
    title: "Close the page",
    body: "Dismiss the page to return fully to the field. Draft content persists; in-draft fragments keep their warm tint until you clear the draft.",
    hint: "Click close / backdrop to leave the page.",
    waitFor: "page-close",
    spotlight: "page",
  },

  // —— Branch ——
  {
    id: "branch",
    section: "Branch",
    title: "Branch — divergent seeds",
    body: "Select exactly one fragment. Invoke Branch from the workbench. Claude (or guest preview) radiates up to four seed siblings — different hues, branch filaments, pending germination.",
    hint: "Select one fragment → Branch glyph.",
    waitFor: "branch",
    spotlight: "center",
    guestNote: "Guest: local seed variants. Sign in for Claude branches.",
  },
  {
    id: "focus",
    section: "Branch",
    title: "Focus a branch",
    body: "Double-tap a branch seed. The rest of the field dims to ghost-light. Work inside the branch is real — attending graduates the seed from proposal to permanent thought.",
    hint: "Double-tap a branch fragment.",
    waitFor: "branch-focus",
    spotlight: "center",
  },

  // —— Attention ——
  {
    id: "expand-fragment",
    section: "Attention",
    title: "Double-tap to attend",
    body: "Double-tap any normal (non-branch) fragment to expand it full-screen and register a return — mass and luminosity rise; filaments pulse. Returns are tracked; after three, state becomes fruiting.",
    hint: "Double-tap a regular fragment.",
    waitFor: "fragment-expand",
    spotlight: "center",
  },

  // —— Zoom & cosmos ——
  {
    id: "zoom",
    section: "Cosmos",
    title: "Zoom is level of thought",
    body: "Scroll to zoom out. Text fades; clusters become nebulae; density field and theme clusters drive murmuration silhouettes. Zoom in for full detail.",
    hint: "Scroll out until the field pulls back.",
    waitFor: "zoom-out",
    spotlight: "center",
  },
  {
    id: "cosmos",
    section: "Cosmos",
    title: "Cosmos web — sessions across time",
    body: "Zoom further to reveal the cosmos layer: other sessions as distant points, cross-session resonance filaments between structurally similar thoughts (embedding similarity). Your live session is included.",
    hint: "Keep scrolling out to see inter-session links.",
    waitFor: "cosmos-visible",
    spotlight: "center",
  },
  {
    id: "murmuration",
    section: "Cosmos",
    title: "Murmuration silhouettes",
    body: "At zoomed-out scale, clusters show bird-flock murmuration contours — triggered when AI tools fire or branches germinate. A visual chorus of where meaning clusters.",
    hint: "Zoom out until flock silhouettes appear (or branch earlier).",
    waitFor: "murmuration-visible",
    spotlight: "center",
  },

  // —— AI substrate ——
  {
    id: "ai-interpret",
    section: "Claude substrate",
    title: "Interpretation layer (9.1)",
    body: "Signed in, Claude interprets the whole field every ~25s — never display text, only substrate: semantic positions, filament adjustments, cluster shapes. The field silently reorganizes.",
    spotlight: "center",
    observe: true,
    guestNote: "Requires sign-in. Guests use spatial proximity linking only.",
  },
  {
    id: "ai-expand",
    section: "Claude substrate",
    title: "Expansion whisper (9.2)",
    body: "On large clusters, Claude occasionally expands — peripheral ai_expansion fragments materialize at the edges, dim and slow, until you attend to them.",
    spotlight: "center",
    observe: true,
  },
  {
    id: "ai-disturb",
    section: "Claude substrate",
    title: "Disturb pair (9.3)",
    body: "When two fragments sit in tension, Claude may place an ai_disturb question between them — negative charge, provocative, never prescriptive.",
    spotlight: "center",
    observe: true,
  },
  {
    id: "ai-implicit",
    section: "Claude substrate",
    title: "Implicit question (9.4)",
    body: "If you circle a region without resolving it, Claude may place a single ai_implicit question at the void center. Attending it lifts Alexander's void — the center can hold content for the session.",
    spotlight: "center",
    observe: true,
  },
  {
    id: "ai-surface",
    section: "Claude substrate",
    title: "Surface adjustment (idle)",
    body: "After ~90s idle, Claude may surface a field adjustment — brighten a node, thicken a filament, pull nodes together. Subtle, never interruptive.",
    spotlight: "center",
    observe: true,
  },
  {
    id: "semantic",
    section: "Claude substrate",
    title: "Semantic filaments",
    body: "New thoughts get Claude semantic embeddings and filaments — not just spatial proximity. The mycelium grows meaning-connections; conduction pulses travel at filament speed.",
    spotlight: "center",
    observe: true,
  },

  // —— Persistence ——
  {
    id: "palimpsest",
    section: "Memory",
    title: "Palimpsest — ghost sessions",
    body: "Prior sessions leave faint point-cloud substrates beneath your field (snapshot API). Landing on dense ghost regions subtly pulls new thoughts — the past exerts gravity.",
    spotlight: "center",
    observe: true,
  },
  {
    id: "guest",
    section: "Memory",
    title: "Guest vs account",
    body: "Guests play locally (localStorage). Sign in to persist thoughts, threads, drafts, tools, negative space, and unlock full Claude. First sign-in can adopt your guest field into the account.",
    spotlight: "top",
    observe: true,
  },
  {
    id: "tour-restart",
    section: "Memory",
    title: "Replay this tour",
    body: "Anytime: click 'tour' in the account bar (top right) to run this walkthrough again.",
    spotlight: "top",
    observe: true,
  },
  {
    id: "finale",
    section: "Memory",
    title: "Enter the field",
    body: "You have seen every layer — capture, workbench, gestures, thread→page, branch, attention, zoom/cosmos, Claude substrate, and persistence. The field is yours. Silence makes it breathe.",
    spotlight: "center",
    observe: true,
  },
];

function CelebrationBurst() {
  return (
    <div className="onboarding-celebrate pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {Array.from({ length: 24 }).map((_, i) => (
        <span
          key={i}
          className="onboarding-particle"
          style={{
            left: `${5 + (i * 4.1) % 90}%`,
            animationDelay: `${i * 0.06}s`,
            background: i % 3 === 0 ? "rgba(140,200,255,0.9)" : "rgba(200,170,255,0.75)",
          }}
        />
      ))}
    </div>
  );
}

function subscribeFieldEvents(
  names: FieldEventName[],
  handler: () => void
): () => void {
  const offs = names.map((n) => onFieldEvent(n, handler));
  return () => offs.forEach((off) => off());
}

export function OnboardingTour() {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [waitTimedOut, setWaitTimedOut] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthed(false);
      return;
    }
    (async () => {
      try {
        const sb = createSupabaseBrowserClient();
        const { data } = await sb.auth.getUser();
        setAuthed(Boolean(data.user?.id));
      } catch {
        setAuthed(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (isOnboardingComplete()) return;
    const t = setTimeout(() => setActive(true), 2800);
    return () => clearTimeout(t);
  }, []);

  const current = STEPS[step];

  const advance = useCallback(() => {
    if (step >= STEPS.length - 1) {
      setCelebrate(true);
      markOnboardingComplete();
      emitFieldEvent("revealed");
      setTimeout(() => {
        setActive(false);
        setCelebrate(false);
      }, 1600);
      return;
    }
    const next = STEPS[step + 1];
    setStep((s) => s + 1);
    setWaitTimedOut(false);
    setWaiting(Boolean(next?.waitFor) && !next?.observe);
  }, [step]);

  useEffect(() => {
    if (!active || !current?.waitFor || current.observe) {
      setWaiting(false);
      setWaitTimedOut(false);
      return;
    }
    const names = Array.isArray(current.waitFor) ? current.waitFor : [current.waitFor];
    setWaiting(true);
    setWaitTimedOut(false);
    const timeout = setTimeout(() => setWaitTimedOut(true), WAIT_TIMEOUT_MS);
    const off = subscribeFieldEvents(names, () => {
      setWaiting(false);
      setWaitTimedOut(false);
    });
    return () => {
      clearTimeout(timeout);
      off();
    };
  }, [active, current?.waitFor, current?.observe, step]);

  useEffect(() => {
    const onRestart = () => {
      setStep(0);
      setActive(true);
      setCelebrate(false);
      setWaitTimedOut(false);
      try {
        localStorage.removeItem(ONBOARDING_KEY);
        localStorage.removeItem("ct-onboarding-complete-v1");
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("ct:restart-onboarding", onRestart);
    return () => window.removeEventListener("ct:restart-onboarding", onRestart);
  }, []);

  if (!active) return null;

  const progress = ((step + 1) / STEPS.length) * 100;
  const spotlightClass =
    current.spotlight === "orb"
      ? "onboarding-spotlight-orb"
      : current.spotlight === "top"
        ? "onboarding-spotlight-top"
        : current.spotlight === "page"
          ? "onboarding-spotlight-page"
          : "onboarding-spotlight-center";

  const canAdvance = current.observe || !waiting || waitTimedOut;
  const nextLabel =
    step >= STEPS.length - 1
      ? "enter the field"
      : current.observe
        ? "next"
        : waiting && !waitTimedOut
          ? "try it…"
          : waitTimedOut
            ? "continue"
            : "next";

  return (
    <div className="onboarding-root fixed inset-0 z-[100] pointer-events-none">
      {celebrate && <CelebrationBurst />}
      <div
        className={`onboarding-dim pointer-events-auto ${spotlightClass}`}
        onClick={(e) => e.stopPropagation()}
      />

      <div className="pointer-events-auto absolute bottom-[7.5rem] left-1/2 z-[101] w-[min(92vw,28rem)] -translate-x-1/2">
        <div
          className="onboarding-card max-h-[min(52vh,22rem)] overflow-y-auto rounded-lg border border-[rgba(150,190,220,0.15)] px-6 py-5 shadow-[0_8px_40px_rgba(0,0,0,0.5)]"
          style={{
            background: "linear-gradient(165deg, rgba(14,16,24,0.94) 0%, rgba(8,9,14,0.97) 100%)",
          }}
        >
          <div className="mb-3 h-0.5 overflow-hidden rounded-full bg-[rgba(100,130,160,0.15)]">
            <div
              className="h-full bg-[rgba(140,190,230,0.55)] transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mb-0.5 text-[10px] font-light uppercase tracking-[0.22em] text-[rgba(130,165,200,0.45)]">
            {current.section}
          </p>
          <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-[rgba(100,130,160,0.35)]">
            {step + 1} / {STEPS.length}
            {authed === true ? " · Claude when signed in" : authed === false ? " · guest previews active" : ""}
          </p>
          <h2 className="mb-2 text-lg font-light text-[rgba(215,228,245,0.92)]">{current.title}</h2>
          <p className="mb-3 text-[13px] font-light leading-relaxed text-[rgba(170,195,220,0.65)]">
            {current.body}
          </p>
          {current.guestNote && authed === false && (
            <p className="mb-3 text-[11px] font-light text-[rgba(160,200,240,0.5)]">{current.guestNote}</p>
          )}
          {current.hint && (
            <p className="onboarding-hint mb-4 text-[12px] font-light italic text-[rgba(140,180,220,0.45)]">
              ↳ {current.hint}
            </p>
          )}
          {waiting && !waitTimedOut && !current.observe && (
            <p className="mb-3 text-[11px] font-light text-[rgba(120,160,200,0.4)]">
              Do the gesture in the field — skip step or wait ~20s to continue.
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                markOnboardingComplete();
                setActive(false);
              }}
              className="border-0 bg-transparent text-[11px] font-light text-[rgba(130,160,190,0.4)] underline-offset-2 hover:text-[rgba(180,210,235,0.7)] hover:underline"
            >
              skip tour
            </button>
            <div className="flex gap-2">
              {waiting && !waitTimedOut && !current.observe && (
                <button
                  type="button"
                  onClick={() => {
                    setWaiting(false);
                    setWaitTimedOut(true);
                  }}
                  className="rounded-full border border-[rgba(120,150,180,0.2)] bg-transparent px-4 py-2 text-[11px] font-light text-[rgba(160,190,220,0.55)] hover:border-[rgba(150,190,220,0.35)]"
                >
                  skip step
                </button>
              )}
              <button
                type="button"
                disabled={!canAdvance}
                onClick={advance}
                className="rounded-full border border-[rgba(150,190,220,0.3)] bg-[rgba(100,160,210,0.12)] px-5 py-2 text-[12px] font-light tracking-wide text-[rgba(210,225,245,0.9)] transition-all hover:bg-[rgba(100,160,210,0.22)] disabled:opacity-40"
              >
                {nextLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
