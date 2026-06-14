/**
 * Part 7 — low-resolution density field (heatmap substrate).
 * Rebuilt each frame from fragment mass/luminosity; sampled by the
 * bioluminescent trail and available for zoomed-out heatmap rendering.
 */
export class DensityField {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cell: number;
  private readonly originX: number;
  private readonly originY: number;
  private readonly grid: Float32Array;
  private maxDensity = 1;

  constructor(
    cols = 56,
    rows = 42,
    cell = 34,
    originX = -952,
    originY = -714
  ) {
    this.cols = cols;
    this.rows = rows;
    this.cell = cell;
    this.originX = originX;
    this.originY = originY;
    this.grid = new Float32Array(cols * rows);
  }

  /** Rebuild from current fragment positions (mass × confidence). */
  rebuild(nodes: { position: [number, number, number]; mass: number; luminosity: number }[]) {
    this.grid.fill(0);
    const r = 3;
    const sigma2 = 1.8 * 1.8;

    for (const n of nodes) {
      const wx = n.position[0];
      const wy = n.position[1];
      const w = n.mass * (0.35 + n.luminosity * 0.65);
      const cx = (wx - this.originX) / this.cell;
      const cy = (wy - this.originY) / this.cell;
      const x0 = Math.max(0, Math.floor(cx - r));
      const x1 = Math.min(this.cols - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r));
      const y1 = Math.min(this.rows - 1, Math.ceil(cy + r));

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const g = Math.exp(-(dx * dx + dy * dy) / (2 * sigma2));
          this.grid[y * this.cols + x] += w * g;
        }
      }
    }

    let max = 0;
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] > max) max = this.grid[i];
    }
    this.maxDensity = Math.max(0.0001, max);
  }

  /** Normalized density at world (x, y) — 0 in void, 1 at local peak. */
  sample(x: number, y: number): number {
    const fx = (x - this.originX) / this.cell - 0.5;
    const fy = (y - this.originY) / this.cell - 0.5;
    if (fx < 0 || fy < 0 || fx >= this.cols - 1 || fy >= this.rows - 1) {
      return 0.08;
    }

    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;

    const i00 = this.grid[y0 * this.cols + x0];
    const i10 = this.grid[y0 * this.cols + x0 + 1];
    const i01 = this.grid[(y0 + 1) * this.cols + x0];
    const i11 = this.grid[(y0 + 1) * this.cols + x0 + 1];
    const raw = (1 - tx) * (1 - ty) * i00 + tx * (1 - ty) * i10 + (1 - tx) * ty * i01 + tx * ty * i11;

    return Math.max(0.08, Math.min(1, raw / this.maxDensity));
  }

  /** Raw grid for Part 7 heatmap overlay. */
  getGrid(): { data: Float32Array; cols: number; rows: number; max: number } {
    return { data: this.grid, cols: this.cols, rows: this.rows, max: this.maxDensity };
  }

  /** World-space bounds of the density grid. */
  getBounds(): { minX: number; minY: number; width: number; height: number } {
    return {
      minX: this.originX,
      minY: this.originY,
      width: this.cols * this.cell,
      height: this.rows * this.cell,
    };
  }

  /** Soft structural-light heatmap for zoomed-out density read. */
  rasterizeHeatmap(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = this.cols;
    canvas.height = this.rows;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(this.cols, this.rows);
    const d = img.data;
    const inv = 1 / this.maxDensity;

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const v = this.grid[y * this.cols + x] * inv;
        const t = Math.pow(Math.min(1, v), 0.62);
        const i = (y * this.cols + x) * 4;
        d[i] = 201;
        d[i + 1] = 222;
        d[i + 2] = 240;
        d[i + 3] = Math.floor(t * 72);
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
}
