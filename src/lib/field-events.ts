/** Custom events the field emits so onboarding (and other UI) can react. */
export type FieldEventName =
  | "revealed"
  | "voice-start"
  | "type-start"
  | "crystallize"
  | "negative-space"
  | "select"
  | "lasso"
  | "workbench-arrived"
  | "tool-invoked"
  | "tool-execute"
  | "reflection"
  | "custom-tool-prompt"
  | "custom-tool-created"
  | "sketch"
  | "trace-complete"
  | "thread-legibility"
  | "page-open"
  | "page-selection"
  | "page-tool-invoked"
  | "page-close"
  | "returned-from-draft"
  | "branch"
  | "branch-focus"
  | "fragment-expand"
  | "drag-connect"
  | "merge"
  | "zoom-out"
  | "cosmos-visible"
  | "murmuration-visible";

export function emitFieldEvent(name: FieldEventName, detail?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(`ct:${name}`, { detail }));
}

export function onFieldEvent(
  name: FieldEventName,
  handler: (detail?: Record<string, unknown>) => void
): () => void {
  const fn = (e: Event) => handler((e as CustomEvent).detail);
  window.addEventListener(`ct:${name}`, fn);
  return () => window.removeEventListener(`ct:${name}`, fn);
}

export const ONBOARDING_KEY = "ct-onboarding-complete-v2";

export function isOnboardingComplete(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === "1";
  } catch {
    return false;
  }
}

export function markOnboardingComplete() {
  try {
    localStorage.setItem(ONBOARDING_KEY, "1");
  } catch {
    /* ignore */
  }
}
