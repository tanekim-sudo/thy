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

/** Color of a node by its charge and state. Cool for resonant, warm for tension. */
export function nodeColor(charge: number, isSynthesis: boolean): THREE.Color {
  if (isSynthesis) return new THREE.Color(0.85, 0.92, 1.0);
  // charge -1 (tension, warm) .. +1 (resonant, cool blue)
  const warm = new THREE.Color(0.95, 0.62, 0.42);
  const cool = new THREE.Color(0.5, 0.72, 0.95);
  const neutral = new THREE.Color(0.62, 0.74, 0.86);
  if (charge >= 0) return neutral.clone().lerp(cool, Math.min(1, charge));
  return neutral.clone().lerp(warm, Math.min(1, -charge));
}

export function filamentColor(type: string): THREE.Color {
  switch (type) {
    case "tension":
      return new THREE.Color(0.95, 0.55, 0.4);
    case "echo":
      return new THREE.Color(0.72, 0.6, 0.95);
    case "temporal":
      return new THREE.Color(0.55, 0.85, 0.7);
    default:
      return new THREE.Color(0.55, 0.72, 0.92);
  }
}
