"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emitFieldEvent } from "@/lib/field-events";
import { localExecuteOutputs } from "@/lib/field/guest-ai";
import type { ArrivedGlyph, DraftDoc, UserTool, WorkbenchSelection } from "@/lib/types";

interface PageViewProps {
  draft: DraftDoc;
  threadAvgPosition: [number, number];
  sessionId: string;
  tools: UserTool[];
  onClose: () => void;
  onDraftChange: (draft: DraftDoc) => void;
  onReturnedToField: (text: string, position: [number, number, number]) => void;
  onReflect: (selection: string, fragmentIds: string[]) => void;
}

/** Part 17.4–17.6 — Page craft mode floating in the same void. */
export function PageView({
  draft,
  threadAvgPosition,
  sessionId,
  tools,
  onClose,
  onDraftChange,
  onReturnedToField,
  onReflect,
}: PageViewProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState(draft.content);
  const [revealed, setRevealed] = useState(false);
  const [selection, setSelection] = useState<WorkbenchSelection | null>(null);
  const [glyphs, setGlyphs] = useState<ArrivedGlyph[]>([]);
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [creatingTool, setCreatingTool] = useState(false);
  const settleRef = useRef<ReturnType<typeof setTimeout>>();
  const seededRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (editorRef.current && !seededRef.current) {
      editorRef.current.innerText = draft.content;
      seededRef.current = true;
    }
  }, [draft.content]);

  const persist = useCallback(
    async (next: string, deleted?: string) => {
      try {
        const res = await fetch("/api/drafts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: draft.id,
            content: next,
            deletedText: deleted,
            sessionId,
            threadId: draft.threadId,
            avgPosition: { x: threadAvgPosition[0], y: threadAvgPosition[1] },
          }),
        });
        if (res.ok) {
          const data = await res.json();
          onDraftChange(data.draft);
          if (deleted?.trim()) {
            onReturnedToField(deleted.trim(), [
              threadAvgPosition[0],
              threadAvgPosition[1],
              0,
            ]);
          }
        }
      } catch {
        /* local edit still holds */
      }
    },
    [draft.id, draft.threadId, onDraftChange, onReturnedToField, sessionId, threadAvgPosition]
  );

  function onSelect() {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text) {
      dismissWorkbench();
      return;
    }
    setSelection({ kind: "text", fragmentIds: [], text });
    emitFieldEvent("page-selection", { length: text.length });
    clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => arriveGlyphs(text), 320);
  }

  function dismissWorkbench() {
    setGlyphs((g) => g.map((x) => ({ ...x, dismissing: true })));
    setTimeout(() => {
      setGlyphs([]);
      setSelection(null);
      setAlternatives([]);
    }, 400);
  }

  function arriveGlyphs(_anchorText: string) {
    const ranked = [...tools]
      .filter((t) => t.builtinKind !== "branch")
      .sort((a, b) => b.mass - a.mass || b.lastUsedAt - a.lastUsedAt)
      .slice(0, 3);
    const reflect = tools.find((t) => t.builtinKind === "reflect");
    const list: ArrivedGlyph[] = [];
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2 - 40;
    const entries = [
      ...ranked.map((t) => ({ id: t.id, instruction: t.instruction, glyphPath: t.glyphPath })),
      ...(reflect
        ? [{ id: "reflect" as const, instruction: reflect.instruction, glyphPath: undefined }]
        : []),
      { id: "create" as const, instruction: "", glyphPath: undefined },
    ];
    entries.forEach((e, i) => {
      const ang = -Math.PI / 2 + (i - (entries.length - 1) / 2) * 0.35;
      const edge = i % 4;
      const fromX = edge < 2 ? (edge === 0 ? -40 : window.innerWidth + 40) : cx + Math.cos(ang) * 400;
      const fromY = edge >= 2 ? (edge === 2 ? -40 : window.innerHeight + 40) : cy + Math.sin(ang) * 400;
      list.push({
        key: `${e.id}-${Date.now()}-${i}`,
        toolId: e.id,
        instruction: e.instruction,
        progress: 0,
        x: fromX,
        y: fromY,
        tx: cx + Math.cos(ang) * 120,
        ty: cy + Math.sin(ang) * 80,
        fromX,
        fromY,
        dismissing: false,
        isOpen: e.id === "create",
        isReflect: e.id === "reflect",
        glyphPath: e.glyphPath,
      });
    });
    setGlyphs(list);
  }

  useEffect(() => {
    if (!glyphs.length) return;
    let raf = 0;
    const tick = () => {
      setGlyphs((prev) =>
        prev.map((g) => {
          const target = g.dismissing ? 0 : 1;
          const progress = g.progress + (target - g.progress) * (g.dismissing ? 0.08 : 0.06);
          return {
            ...g,
            progress,
            x: g.fromX + (g.tx - g.fromX) * progress,
            y: g.fromY + (g.ty - g.fromY) * progress,
          };
        })
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [glyphs.length]);

  async function invokeGlyph(g: ArrivedGlyph) {
    emitFieldEvent("page-tool-invoked", { toolId: g.toolId });
    if (g.toolId === "create") {
      setCreatingTool(true);
      return;
    }
    if (!selection?.text) return;
    if (g.toolId === "reflect") {
      onReflect(selection.text, []);
      dismissWorkbench();
      return;
    }
    try {
      const tool = tools.find((t) => t.id === g.toolId);
      const instruction = tool?.instruction ?? g.instruction;
      const res = await fetch("/api/claude/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, selection: selection.text }),
      });
      if (res.status === 401) {
        setAlternatives(localExecuteOutputs(instruction, selection.text));
        return;
      }
      const data = await res.json();
      setAlternatives(Array.isArray(data.outputs) ? data.outputs : []);
      fetch(`/api/tools/${g.toolId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ used: true }),
      }).catch(() => {});
    } catch {
      /* quiet */
    }
  }

  async function createAndRunTool(instruction: string) {
    const text = instruction.trim();
    if (!text || !selection?.text) return;
    const res = await fetch("/api/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: text }),
    });
    const data = await res.json();
    const tool = data.tool as UserTool;
    const exec = await fetch("/api/claude/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: text, selection: selection.text }),
    });
    const out = await exec.json();
    setAlternatives(Array.isArray(out.outputs) ? out.outputs : []);
    setCreatingTool(false);
    void tool;
  }

  function applyAlternative(alt: string) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const replaced = range.toString();
    range.deleteContents();
    range.insertNode(document.createTextNode(alt));
    const next = editorRef.current?.innerText ?? content;
    setContent(next);
    persist(next, replaced);
    setAlternatives([]);
    dismissWorkbench();
    if (replaced.trim()) {
      emitFieldEvent("returned-from-draft", { text: replaced.trim() });
    }
  }

  function onInput() {
    const next = editorRef.current?.innerText ?? "";
    setContent(next);
    dismissWorkbench();
  }

  function onBlurSave() {
    persist(content);
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center transition-opacity duration-[1800ms]"
      style={{ opacity: revealed ? 1 : 0, background: "rgba(5,6,12,0.92)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative max-h-[78vh] w-[min(42rem,88vw)] overflow-y-auto rounded-sm px-12 py-14 shadow-[0_0_80px_rgba(200,160,90,0.08)]"
        style={{
          background: "linear-gradient(180deg, rgba(18,16,14,0.95) 0%, rgba(10,10,15,0.98) 100%)",
          border: "1px solid rgba(200,170,120,0.12)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className="page-editor whitespace-pre-wrap text-left text-[17px] font-light leading-[1.85] outline-none"
          style={{ color: "rgba(225,210,190,0.88)" }}
          onInput={onInput}
          onBlur={onBlurSave}
          onMouseUp={onSelect}
          onKeyUp={onSelect}
        />
        {alternatives.length > 0 && (
          <div className="mt-8 space-y-2 border-t border-[rgba(200,170,120,0.1)] pt-6">
            {alternatives.map((alt) => (
              <button
                key={alt}
                type="button"
                onClick={() => applyAlternative(alt)}
                className="block w-full border-0 bg-transparent text-left text-sm font-light italic text-[rgba(190,200,220,0.35)] transition-opacity hover:text-[rgba(210,220,235,0.55)]"
              >
                {alt}
              </button>
            ))}
          </div>
        )}
      </div>

      {glyphs.map((g) => (
        <button
          key={g.key}
          type="button"
          aria-label={g.isReflect ? "reflect" : g.isOpen ? "create tool" : "tool"}
          onClick={() => invokeGlyph(g)}
          className="pointer-events-auto absolute z-[70] border-0 bg-transparent p-3"
          style={{
            left: g.x,
            top: g.y,
            transform: "translate(-50%,-50%)",
            opacity: g.progress * 0.85,
          }}
        >
          {g.isReflect ? (
            <span
              className="block h-8 w-8 rounded-full border border-[rgba(180,200,230,0.35)]"
              style={{ boxShadow: "0 0 12px rgba(140,180,220,0.2)" }}
            />
          ) : g.isOpen ? (
            <svg width="36" height="36" viewBox="-1.2 -1.2 2.4 2.4">
              <path
                d="M 0.9 0 A 1 1 0 1 1 -0.2 0.85"
                fill="none"
                stroke="rgba(180,210,240,0.5)"
                strokeWidth="0.08"
              />
            </svg>
          ) : (
            <svg width="32" height="32" viewBox="-1.3 -1.3 2.6 2.6">
              <polygon
                points={(g.glyphPath ? JSON.parse(g.glyphPath) : [[0, -1], [1, 0], [0, 1], [-1, 0]])
                  .map((p: number[]) => `${p[0]},${p[1]}`)
                  .join(" ")}
                fill="none"
                stroke="rgba(160,200,235,0.45)"
                strokeWidth="0.06"
              />
            </svg>
          )}
        </button>
      ))}

      {creatingTool && (
        <div className="fixed inset-x-0 bottom-24 z-[80] flex justify-center">
          <input
            autoFocus
            placeholder="state the instruction…"
            className="w-[min(80vw,28rem)] border-0 border-b border-[rgba(150,190,220,0.25)] bg-transparent text-center text-base font-light text-[rgba(200,220,240,0.75)] outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter") createAndRunTool((e.target as HTMLInputElement).value);
              if (e.key === "Escape") setCreatingTool(false);
            }}
          />
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        className="absolute bottom-10 left-1/2 z-[70] -translate-x-1/2 border-0 bg-transparent text-[11px] font-light tracking-widest text-[rgba(150,180,210,0.35)]"
      >
        return to field
      </button>
    </div>
  );
}
