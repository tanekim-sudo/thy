let nextId = 1;
const uid = () => `m-${nextId++}`;

/** A root node — one idea in someone's field. */
export class RootNode {
  constructor({ x, y, label, fieldId, depth = 0.3 }) {
    this.id = uid();
    this.x = x;
    this.y = y;
    this.label = label;
    this.fieldId = fieldId;
    this.depth = depth;
    this.engagement = 0;
    this.bornAt = Date.now();
    this.filamentIds = new Set();
  }

  orbit(amount = 0.08) {
    this.engagement = Math.min(1, this.engagement + amount);
    this.depth = Math.min(1, this.depth + amount * 0.4);
  }
}

/**
 * A living filament between two nodes.
 * The filament is itself a node — it can be named, branch, attract others.
 */
export class Filament {
  constructor({ from, to, name = "", isBridge = false }) {
    this.id = uid();
    this.from = from;
    this.to = to;
    this.name = name;
    this.isBridge = isBridge;
    this.createdAt = Date.now();
    this.traffic = 0;
    this.lastTrafficAt = Date.now();
    this.growth = 0;
    this.health = 1;
    this.dualEngagement = 0;
    this.seed = Math.random() * 1000;
    this.branchFilamentIds = new Set();

    from.filamentIds.add(this.id);
    to.filamentIds.add(this.id);
  }

  passTraffic(amount = 1) {
    this.traffic += amount;
    this.lastTrafficAt = Date.now();
    this.health = Math.min(1, this.health + 0.15);
    if (this.growth < 1) this.growth = Math.min(1, this.growth + 0.06);
    this.from.orbit(amount * 0.04);
    this.to.orbit(amount * 0.04);
    this.updateDualEngagement();
  }

  updateDualEngagement() {
    if (!this.isBridge) return;
    this.dualEngagement = Math.min(
      1,
      (this.from.engagement + this.to.engagement) * 0.35 + this.traffic * 0.04
    );
  }

  goDormant() {
    this.lastTrafficAt = Date.now() - 60000;
  }

  reactivate() {
    this.lastTrafficAt = Date.now();
    this.health = Math.min(1, this.health + 0.55);
    this.passTraffic(0.5);
  }

  update(dt, now) {
    if (this.growth < 1) {
      this.growth = Math.min(1, this.growth + dt * 0.12);
    }

    const idleSec = (now - this.lastTrafficAt) / 1000;
    if (idleSec > 8) {
      this.health = Math.max(0.12, this.health - dt * 0.018);
    }

    this.updateDualEngagement();
  }

  get thickness() {
    return 0.4 + Math.min(this.traffic * 0.35, 5);
  }

  get luminosity() {
    if (!this.isBridge) return Math.min(0.35, this.from.depth * 0.2);
    return Math.min(1, this.dualEngagement * 0.85 + (this.health > 0.5 ? 0.15 : 0));
  }

  get isDormant() {
    return this.health < 0.35;
  }
}

/** One person's field — a root system in the soil. */
export class Field {
  constructor(id, label, tint) {
    this.id = id;
    this.label = label;
    this.tint = tint;
    this.nodeIds = new Set();
  }
}

/** The full mycelium — no center, no hierarchy. Structure is intelligence. */
export class MyceliumField {
  constructor() {
    this.nodes = new Map();
    this.filaments = new Map();
    this.fields = new Map();
  }

  addField(id, label, tint) {
    const field = new Field(id, label, tint);
    this.fields.set(id, field);
    return field;
  }

  addNode({ x, y, label, fieldId, depth }) {
    const node = new RootNode({ x, y, label, fieldId, depth });
    this.nodes.set(node.id, node);
    const field = this.fields.get(fieldId);
    if (field) field.nodeIds.add(node.id);
    return node;
  }

  connect(from, to, options = {}) {
    const existing = this.findFilament(from.id, to.id);
    if (existing) {
      existing.passTraffic();
      return existing;
    }
    const filament = new Filament({ from, to, ...options });
    this.filaments.set(filament.id, filament);
    return filament;
  }

  findFilament(aId, bId) {
    for (const f of this.filaments.values()) {
      if (
        (f.from.id === aId && f.to.id === bId) ||
        (f.from.id === bId && f.to.id === aId)
      ) {
        return f;
      }
    }
    return null;
  }

  findNearestNode(x, y, maxDist = 48, fieldId = null) {
    let best = null;
    let bestD = maxDist;
    for (const node of this.nodes.values()) {
      if (fieldId && node.fieldId !== fieldId) continue;
      const d = Math.hypot(node.x - x, node.y - y);
      if (d < bestD) {
        bestD = d;
        best = node;
      }
    }
    return best;
  }

  update(dt, now = Date.now()) {
    for (const filament of this.filaments.values()) {
      filament.update(dt, now);
    }
  }

  passTrafficNear(x, y, radius = 60) {
    let hit = false;
    for (const filament of this.filaments.values()) {
      const mid = {
        x: (filament.from.x + filament.to.x) / 2,
        y: (filament.from.y + filament.to.y) / 2,
      };
      if (Math.hypot(mid.x - x, mid.y - y) < radius) {
        filament.passTraffic();
        hit = true;
      }
    }
    return hit;
  }
}
