import { hashStr } from "@/lib/field/mycelium";

/** Closed organic glyph curve from an instruction string (Part 14.4). */
export function glyphFromInstruction(instruction: string, segments = 24): [number, number][] {
  const seed = hashStr(instruction);
  const pts: [number, number][] = [];
  const lobes = 3 + (seed % 4);
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const wobble = 0.12 + ((hashStr(`${instruction}:${i}`) % 100) / 100) * 0.18;
    const r = 1 + wobble * Math.sin(lobes * t + (seed % 100) * 0.01);
    pts.push([Math.cos(t) * r, Math.sin(t) * r]);
  }
  return pts;
}

/** Deliberately open curve for the "create a tool" glyph. */
export function openGlyphCurve(segments = 20): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 1.55 - Math.PI * 0.25;
    const r = 1 + Math.sin(t * 2) * 0.08;
    pts.push([Math.cos(t) * r, Math.sin(t) * r]);
  }
  return pts;
}

/** Reflect motif — expanding ring / aperture (not a closed glyph). */
export function reflectRingPoints(rings = 3, seg = 32): [number, number][][] {
  const out: [number, number][][] = [];
  for (let r = 0; r < rings; r++) {
    const rad = 0.55 + r * 0.22;
    const ring: [number, number][] = [];
    for (let i = 0; i < seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      ring.push([Math.cos(t) * rad, Math.sin(t) * rad]);
    }
    out.push(ring);
  }
  return out;
}

export function serializeGlyph(pts: [number, number][]): string {
  return JSON.stringify(pts);
}

export function parseGlyph(path: string | null | undefined): [number, number][] {
  if (!path) return [];
  try {
    const arr = JSON.parse(path);
    return Array.isArray(arr) ? arr.map((p) => [Number(p[0]), Number(p[1])] as [number, number]) : [];
  } catch {
    return [];
  }
}
