/** Local previews when Claude APIs require sign-in (guest / offline). */

export function localBranchSeeds(content: string): string[] {
  const base = content.trim().slice(0, 200) || "this thought";
  return [
    `What if the opposite were true: ${base}?`,
    `Push further — ${base}`,
    `Against that: a counter-reading`,
    `If ${base} — then what follows?`,
  ];
}

export function localLegibilityBody(fragmentTexts: string[]): string {
  const parts = fragmentTexts.map((t) => t.trim()).filter(Boolean);
  if (parts.length === 0) return "Traced fragments (sign in for Claude legibility).";
  return parts.join("\n\n");
}

export function localExecuteOutputs(instruction: string, selection: string): string[] {
  const snippet = selection.trim().slice(0, 120);
  return [`[${instruction}] ${snippet}`];
}

export function localReflectLabels(
  fragmentIds: string[]
): { emphasize: string[]; labels: { ids: string[]; label: string }[] } {
  return {
    emphasize: fragmentIds,
    labels:
      fragmentIds.length > 1
        ? [{ ids: fragmentIds, label: "nearby cluster" }]
        : fragmentIds.length === 1
          ? [{ ids: fragmentIds, label: "focus" }]
          : [],
  };
}
