/** Organic path through soil — the route that worked. */
export function filamentPath(from, to, seed, wobble = 1) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const spread = len * 0.22 * wobble;

  const c1x = from.x + dx * 0.25 + nx * spread * Math.sin(seed);
  const c1y = from.y + dy * 0.25 + ny * spread * Math.cos(seed * 1.3);
  const c2x = from.x + dx * 0.75 - nx * spread * Math.cos(seed * 0.7);
  const c2y = from.y + dy * 0.75 - ny * spread * Math.sin(seed * 0.9);

  const points = [];
  const steps = Math.max(24, Math.floor(len / 6));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push(cubicBezier(from.x, from.y, c1x, c1y, c2x, c2y, to.x, to.y, t));
  }
  return points;
}

function cubicBezier(x0, y0, x1, y1, x2, y2, x3, y3, t) {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * x0 + 3 * uu * t * x1 + 3 * u * tt * x2 + ttt * x3,
    y: uuu * y0 + 3 * uu * t * y1 + 3 * u * tt * y2 + ttt * y3,
  };
}

export class MyceliumRenderer {
  constructor(canvas, field) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.field = field;
    this.time = 0;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render(now) {
    const { ctx } = this;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.time = now * 0.001;

    ctx.clearRect(0, 0, w, h);

    const filaments = [...this.field.filaments.values()].sort(
      (a, b) => a.luminosity - b.luminosity
    );

    for (const filament of filaments) {
      this.drawFilament(filament);
    }

    for (const node of this.field.nodes.values()) {
      this.drawRootSystem(node);
      this.drawNode(node);
    }
  }

  drawFilament(filament) {
    const { from, to, growth, health, thickness, luminosity, seed, isDormant } = filament;
    if (growth <= 0.01) return;

    const path = filamentPath(from, to, seed);
    const visibleCount = Math.max(2, Math.floor(path.length * growth));
    const visible = path.slice(0, visibleCount);

    const baseAlpha = isDormant ? 0.08 + health * 0.12 : 0.15 + health * 0.35;
    const width = thickness * (0.6 + health * 0.4);

    if (luminosity > 0.45) {
      this.strokePath(visible, width * 3.5, luminosity * 0.12, [140, 200, 220], 0.6);
      this.strokePath(visible, width * 2, luminosity * 0.18, [180, 220, 235], 0.8);
    }

    const color = filament.isBridge
      ? [200, 215, 225]
      : this.field.fields.get(from.fieldId)?.tint || [180, 190, 200];

    this.strokePath(visible, width, baseAlpha, color, 1);
    this.strokePath(visible, width * 0.35, baseAlpha * 1.4, [240, 245, 250], 1);

    if (filament.name && growth > 0.85 && health > 0.3) {
      const mid = visible[Math.floor(visible.length / 2)];
      this.drawFilamentLabel(mid.x, mid.y, filament.name, luminosity, isDormant);
    }
  }

  strokePath(points, lineWidth, alpha, rgb, lineCap) {
    if (alpha < 0.01 || points.length < 2) return;
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = lineCap === 1 ? "round" : "butt";
    ctx.lineJoin = "round";
    ctx.strokeStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawFilamentLabel(x, y, text, luminosity, dormant) {
    const { ctx } = this;
    const alpha = dormant ? 0.12 : 0.18 + luminosity * 0.25;
    ctx.save();
    ctx.font = '300 11px "Cormorant Garamond", Georgia, serif';
    ctx.textAlign = "center";
    ctx.fillStyle = `rgba(190, 210, 225, ${alpha})`;
    ctx.fillText(text, x, y - 8);
    ctx.restore();
  }

  drawRootSystem(node) {
    const field = this.field.fields.get(node.fieldId);
    const tint = field?.tint || [160, 175, 190];
    const reach = 18 + node.depth * 28 + node.engagement * 12;
    const threads = 5 + Math.floor(node.engagement * 4);
    const pulse = 0.85 + 0.15 * Math.sin(this.time * 0.8 + node.x * 0.01);

    const { ctx } = this;
    ctx.save();
    ctx.lineCap = "round";

    for (let i = 0; i < threads; i++) {
      const angle = (i / threads) * Math.PI * 2 + node.bornAt * 0.0001;
      const len = reach * (0.6 + (i % 3) * 0.15) * pulse;
      const wobble = Math.sin(this.time * 0.5 + i + node.id.length) * 4;
      const ex = node.x + Math.cos(angle) * len + wobble;
      const ey = node.y + Math.sin(angle) * len + wobble * 0.6;

      ctx.strokeStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${0.04 + node.engagement * 0.06})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(node.x, node.y);
      ctx.quadraticCurveTo(
        node.x + Math.cos(angle + 0.4) * len * 0.5,
        node.y + Math.sin(angle + 0.4) * len * 0.5,
        ex,
        ey
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  drawNode(node) {
    const field = this.field.fields.get(node.fieldId);
    const tint = field?.tint || [160, 175, 190];
    const r = 3 + node.depth * 2.5 + node.engagement * 1.5;
    const glow = 0.12 + node.engagement * 0.25;
    const { ctx } = this;

    ctx.save();
    const grad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 3);
    grad.addColorStop(0, `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${glow})`);
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(${tint[0] + 30}, ${tint[1] + 30}, ${tint[2] + 30}, ${0.35 + node.engagement * 0.4})`;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fill();

    if (node.engagement > 0.15) {
      ctx.font = '300 12px "Cormorant Garamond", Georgia, serif';
      ctx.textAlign = "center";
      ctx.fillStyle = `rgba(180, 200, 215, ${0.15 + node.engagement * 0.3})`;
      ctx.fillText(node.label, node.x, node.y + r + 14);
    }
    ctx.restore();
  }
}
