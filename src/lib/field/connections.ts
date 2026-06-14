import type { FilamentEdge } from "@/lib/types";

/** Default conduction for a never-traversed connection (18.3). */
export const DEFAULT_CONDUCTION_SPEED = 0.1;

const MYELINATE_STRENGTH = 0.05;
const MYELINATE_CONDUCTION = 0.05;
const INSTANT_PULSE_THRESHOLD = 0.88;

/**
 * 18.3 — Pruning vs. fading. During decay the micro-branches retract over the
 * first ~60% of the journey from peak strength to zero; only in the final ~40%
 * does the main channel itself thin and dim.
 */
export function connectionPruningVisuals(
  strength: number,
  peakStrength: number
): { branchStrength: number; mainStrength: number } {
  const peak = Math.max(peakStrength, strength, 0.001);
  const ratio = Math.max(0, Math.min(1, strength / peak));
  const branchRatio = ratio > 0.4 ? (ratio - 0.4) / 0.6 : 0;
  const mainRatio = ratio <= 0.4 ? ratio / 0.4 : 1;
  return {
    branchStrength: peak * branchRatio,
    mainStrength: peak * mainRatio,
  };
}

/** Pulse travel time: ~1.5s at conduction 0, near-instant at 1. */
export function pulseDurationMs(conductionSpeed: number): number {
  const c = Math.max(0, Math.min(1, conductionSpeed));
  return 80 + 1500 * (1 - c);
}

export function isInstantPulse(conductionSpeed: number): boolean {
  return conductionSpeed >= INSTANT_PULSE_THRESHOLD;
}

/** Ensure client-side defaults on edges loaded without 18.3 fields. */
export function normalizeFilament(f: FilamentEdge): FilamentEdge {
  const strength = f.strength ?? 0.1;
  return {
    ...f,
    strength,
    conductionSpeed: f.conductionSpeed ?? DEFAULT_CONDUCTION_SPEED,
    peakStrength: f.peakStrength ?? strength,
  };
}

/**
 * Myelination — each traversal thickens the connection and speeds conduction.
 * Returns the pulse duration for the visual that should fire this traversal.
 */
export function traverseFilament(f: FilamentEdge): number {
  f.strength = Math.min(1, f.strength + MYELINATE_STRENGTH);
  f.conductionSpeed = Math.min(
    1,
    (f.conductionSpeed ?? DEFAULT_CONDUCTION_SPEED) + MYELINATE_CONDUCTION
  );
  f.peakStrength = Math.max(f.peakStrength ?? f.strength, f.strength);
  f.traffic = (f.traffic ?? 0) + 1;
  f.isActive = true;
  return pulseDurationMs(f.conductionSpeed);
}

/** Active connection degree for hub rendering (18.3 cell-body effect). */
export function fragmentDegree(
  nodeId: string,
  filaments: FilamentEdge[],
  minStrength = 0.05
): number {
  let d = 0;
  for (const f of filaments) {
    if (f.strength < minStrength) continue;
    if (f.sourceId === nodeId || f.targetId === nodeId) d++;
  }
  return d;
}

export const HUB_DEGREE_THRESHOLD = 4;
