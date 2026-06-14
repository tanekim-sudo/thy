import { glyphFromInstruction, serializeGlyph } from "@/lib/field/glyphs";
import type { UserTool } from "@/lib/types";

export const BUILTIN_BRANCH_INSTRUCTION =
  "Show me three or four different directions this could go — not continuations, divergent directions, each just a few words, like seeds.";

export const BUILTIN_REFLECT_INSTRUCTION =
  "Show me the shape of this — spatial reorganization, not a summary.";

/** In-memory builtins so guests get Reflect + Branch without /api/tools. */
export function guestBuiltinTools(): UserTool[] {
  return [
    {
      id: "guest-builtin-branch",
      instruction: BUILTIN_BRANCH_INSTRUCTION,
      glyphPath: serializeGlyph(glyphFromInstruction(BUILTIN_BRANCH_INSTRUCTION)),
      mass: 1.2,
      opacity: 0.7,
      attentionCount: 0,
      lastUsedAt: 0,
      isBuiltin: true,
      builtinKind: "branch",
    },
    {
      id: "guest-builtin-reflect",
      instruction: BUILTIN_REFLECT_INSTRUCTION,
      glyphPath: serializeGlyph(glyphFromInstruction(BUILTIN_REFLECT_INSTRUCTION)),
      mass: 1.2,
      opacity: 0.7,
      attentionCount: 0,
      lastUsedAt: 0,
      isBuiltin: true,
      builtinKind: "reflect",
    },
  ];
}

export function mergeBuiltinTools(userTools: UserTool[]): UserTool[] {
  const merged = [...userTools];
  for (const b of guestBuiltinTools()) {
    if (!merged.some((t) => t.builtinKind === b.builtinKind)) merged.push(b);
  }
  return merged;
}
