/** Ray-casting point-in-polygon test (lasso selection). */
export function pointInPolygon(px: number, py: number, poly: [number, number][]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** World-space nodes whose centers fall inside a screen-space lasso polygon. */
export function nodesInLasso(
  polyScreen: [number, number][],
  nodes: { id: string; position: [number, number, number] }[],
  project: (x: number, y: number, z: number) => { x: number; y: number } | null
): string[] {
  const ids: string[] = [];
  for (const n of nodes) {
    const p = project(n.position[0], n.position[1], n.position[2]);
    if (p && pointInPolygon(p.x, p.y, polyScreen)) ids.push(n.id);
  }
  return ids;
}

/** Append fragment ids encountered in path order (trace gesture). */
export function traceNearPath(
  path: { x: number; y: number }[],
  nodes: { id: string; position: [number, number, number] }[],
  project: (x: number, y: number, z: number) => { x: number; y: number } | null,
  radiusPx = 48
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const pt of path) {
    for (const n of nodes) {
      if (seen.has(n.id)) continue;
      const p = project(n.position[0], n.position[1], n.position[2]);
      if (!p) continue;
      if (Math.hypot(p.x - pt.x, p.y - pt.y) < radiusPx) {
        seen.add(n.id);
        ordered.push(n.id);
      }
    }
  }
  return ordered;
}
