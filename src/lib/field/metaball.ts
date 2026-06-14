/** Metaball grid splatting + marching-squares contours for murmuration silhouettes. */

export interface MetaballPoint {
  x: number;
  y: number;
  weight: number;
}

export interface MetaballGrid {
  data: Float32Array;
  cols: number;
  rows: number;
  minX: number;
  minY: number;
  cellW: number;
  cellH: number;
  maxVal: number;
}

/** Splat weighted points into a regular grid. */
export function buildMetaballGrid(
  points: MetaballPoint[],
  cols = 40,
  rows = 30,
  pad = 80,
  sigma = 2.2
): MetaballGrid | null {
  if (points.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const cellW = (maxX - minX) / (cols - 1);
  const cellH = (maxY - minY) / (rows - 1);
  const grid = new Float32Array(cols * rows);
  const sigma2 = sigma * sigma;
  const r = 4;

  for (const p of points) {
    const cx = (p.x - minX) / cellW;
    const cy = (p.y - minY) / cellH;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(rows - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(cols - 1, Math.ceil(cx + r)); x++) {
        const dx = x - cx;
        const dy = y - cy;
        grid[y * cols + x] += p.weight * Math.exp(-(dx * dx + dy * dy) / (2 * sigma2));
      }
    }
  }

  let maxVal = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] > maxVal) maxVal = grid[i];
  }
  return { data: grid, cols, rows, minX, minY, cellW, cellH, maxVal: Math.max(0.0001, maxVal) };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function interpX(x: number, y: number, v0: number, v1: number, threshold: number, g: MetaballGrid) {
  const t = (threshold - v0) / (v1 - v0 + 1e-6);
  return { x: g.minX + lerp(x, x + 1, t) * g.cellW, y: g.minY + y * g.cellH };
}

function interpY(x: number, y: number, v0: number, v1: number, threshold: number, g: MetaballGrid) {
  const t = (threshold - v0) / (v1 - v0 + 1e-6);
  return { x: g.minX + x * g.cellW, y: g.minY + lerp(y, y + 1, t) * g.cellH };
}

function sample(g: MetaballGrid, x: number, y: number) {
  if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) return 0;
  return g.data[y * g.cols + x];
}

/**
 * Full marching-squares contour — returns line-segment pairs for THREE.LineSegments.
 */
export function marchingSquaresContour(g: MetaballGrid, threshold: number): Float32Array {
  const segments: number[] = [];
  const { cols, rows } = g;

  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const v0 = sample(g, x, y);
      const v1 = sample(g, x + 1, y);
      const v2 = sample(g, x + 1, y + 1);
      const v3 = sample(g, x, y + 1);

      const a = v0 >= threshold ? 1 : 0;
      const b = v1 >= threshold ? 1 : 0;
      const c = v2 >= threshold ? 1 : 0;
      const d = v3 >= threshold ? 1 : 0;
      const idx = a | (b << 1) | (c << 2) | (d << 3);
      if (idx === 0 || idx === 15) continue;

      const top = interpX(x, y, v0, v1, threshold, g);
      const right = interpY(x + 1, y, v1, v2, threshold, g);
      const bottom = interpX(x, y + 1, v3, v2, threshold, g);
      const left = interpY(x, y, v0, v3, threshold, g);

      const push = (p1: { x: number; y: number }, p2: { x: number; y: number }) => {
        segments.push(p1.x, p1.y, -18, p2.x, p2.y, -18);
      };

      switch (idx) {
        case 1:
          push(left, bottom);
          break;
        case 2:
          push(bottom, right);
          break;
        case 3:
          push(left, right);
          break;
        case 4:
          push(top, right);
          break;
        case 5:
          push(left, top);
          push(bottom, right);
          break;
        case 6:
          push(top, bottom);
          break;
        case 7:
          push(left, top);
          break;
        case 8:
          push(left, top);
          break;
        case 9:
          push(top, bottom);
          break;
        case 10:
          push(left, bottom);
          push(top, right);
          break;
        case 11:
          push(top, right);
          break;
        case 12:
          push(left, right);
          break;
        case 13:
          push(bottom, right);
          break;
        case 14:
          push(left, bottom);
          break;
      }
    }
  }

  return new Float32Array(segments);
}

/** Soft-filled interior for metaball silhouette (canvas → texture). */
export function rasterizeMetaballFill(
  g: MetaballGrid,
  threshold: number,
  soft = 0.35
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const w = g.cols;
  const h = g.rows;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const d = img.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = g.data[y * w + x] / g.maxVal;
      const t = threshold / g.maxVal;
      const alpha = Math.max(0, Math.min(1, (v - t + soft) / soft));
      const i = (y * w + x) * 4;
      d[i] = 201;
      d[i + 1] = 222;
      d[i + 2] = 240;
      d[i + 3] = Math.floor(alpha * 90);
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, width: w, height: h };
}
