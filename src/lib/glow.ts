import * as THREE from "three";

/** A soft radial glow texture — the luminous body of a thought. */
export function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.85)");
  g.addColorStop(0.45, "rgba(255,255,255,0.25)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** A tight, bright core — the dense fruiting heart of a node. */
export function makeCoreTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.32, "rgba(255,255,255,0.95)");
  g.addColorStop(0.55, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** A wide, very soft atmospheric halo — the diffuse aura around a cluster. */
export function makeHaloTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0.5)");
  g.addColorStop(0.3, "rgba(255,255,255,0.18)");
  g.addColorStop(0.7, "rgba(255,255,255,0.04)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Rotate a color's hue by `shift` turns (0..1) — the field's personal signature. */
export function hueShift(color: THREE.Color, shift: number): THREE.Color {
  if (!shift) return color;
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  hsl.h = (hsl.h + shift + 1) % 1;
  return color.setHSL(hsl.h, hsl.s, hsl.l);
}

// ---- 18.1 — The two lights -------------------------------------------------
// There are exactly two lights in this universe and never a third hue. Every
// fragment, connection and pulse is some blend of these. Provenance and meaning
// are carried by shape, texture and intensity — never by colour.

/**
 * STRUCTURAL light — cool, desaturated white-blue-violet (#c9def0). The colour
 * of what *exists*: dormant fragment glow, connections at rest, the palimpsest,
 * the cosmic web. At full intensity it is this colour; it scales down toward the
 * base field colour (#0a0a0f) as intensity drops.
 */
export const STRUCTURAL_LIGHT = new THREE.Color(0.788, 0.871, 0.941); // #c9def0

/** The base field colour structural light decays toward. */
export const BASE_FIELD = new THREE.Color(0.039, 0.039, 0.059); // #0a0a0f

/**
 * VITAL light — cyan-teal-green, ranging warm→cool (#4dffc4 → #2dd4bf). The
 * colour of what is *happening*: a fragment in the moment of its creation, the
 * synaptic pulse along a firing connection, the bioluminescent response to
 * touch, the flock of currently-attended fragments.
 */
export const VITAL_WARM = new THREE.Color(0.302, 1.0, 0.769); // #4dffc4
export const VITAL_COOL = new THREE.Color(0.176, 0.831, 0.749); // #2dd4bf

/**
 * Vital light at a given intensity. Freshest events sit at the warm end of the
 * vital range and settle toward the cool end as the instant passes.
 */
export function vitalColor(t = 1): THREE.Color {
  return VITAL_COOL.clone().lerp(VITAL_WARM, Math.max(0, Math.min(1, t)));
}

/**
 * A fragment's colour is the single blend the whole medium is built on: pure
 * vital light in the moment of being thought, cooling to pure structural light
 * as it settles into the field. `vitality` is 0 (settled / structural) → 1
 * (just-happened / vital). Brightness is applied separately by the caller via
 * opacity and HDR multipliers, so this returns only the hue blend.
 */
export function fragmentColor(vitality: number): THREE.Color {
  const v = Math.max(0, Math.min(1, vitality));
  return STRUCTURAL_LIGHT.clone().lerp(vitalColor(v), v);
}

/**
 * How "vital" a fragment is right now: high at the instant of creation (and
 * while still crystallizing), again briefly each time attention returns, then
 * decaying back to structural. Caller may add transient bursts on top.
 */
export function fragmentVitality(
  node: {
    timestamp: number;
    lastAttendedAt?: number;
    crystallizing?: number;
  },
  nowMs: number
): number {
  // Still materializing → still being thought.
  const creating = node.crystallizing != null ? 1 - Math.min(1, node.crystallizing) : 0;
  // Recently spoken into being.
  const born = Math.exp(-(nowMs - node.timestamp) / 4000);
  // Recently returned to.
  const attended = node.lastAttendedAt
    ? Math.exp(-(nowMs - node.lastAttendedAt) / 2600) * 0.7
    : 0;
  return Math.min(1, Math.max(creating, born, attended));
}

/**
 * Connections render in structural light, regardless of their semantic type
 * (18.1: provenance and meaning are never colour). Type and strength are
 * expressed through shape, micro-branching and intensity instead.
 */
export function filamentColor(): THREE.Color {
  return STRUCTURAL_LIGHT.clone();
}
