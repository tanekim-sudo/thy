import { MyceliumField } from "./model.js";

/**
 * Seed a living demo: two fields touching, filaments growing,
 * dormancy, and re-activation.
 */
export function seedDemo(field, w, h) {
  const cx = w / 2;
  const cy = h / 2;

  field.addField("self", "Your field", [120, 155, 175]);
  field.addField("other", "Their field", [175, 150, 130]);

  const trust = field.addNode({
    x: cx - 140,
    y: cy - 30,
    label: "trust",
    fieldId: "self",
    depth: 0.55,
  });
  trust.engagement = 0.6;

  const doubt = field.addNode({
    x: cx + 130,
    y: cy + 20,
    label: "doubt",
    fieldId: "other",
    depth: 0.5,
  });
  doubt.engagement = 0.55;

  const pattern = field.addNode({
    x: cx - 60,
    y: cy + 70,
    label: "pattern",
    fieldId: "self",
    depth: 0.4,
  });

  const memory = field.addNode({
    x: cx - 200,
    y: cy + 50,
    label: "memory",
    fieldId: "self",
    depth: 0.35,
  });

  const question = field.addNode({
    x: cx + 180,
    y: cy - 60,
    label: "question",
    fieldId: "other",
    depth: 0.38,
  });

  const threshold = field.addNode({
    x: cx + 40,
    y: cy - 90,
    label: "threshold",
    fieldId: "other",
    depth: 0.42,
  });

  field.connect(trust, pattern, { name: "recognition" });
  field.connect(pattern, memory, { name: "root" });
  field.connect(doubt, question);
  field.connect(question, threshold, { name: "edge" });

  const bridge = field.connect(trust, doubt, {
    name: "the space between",
    isBridge: true,
  });
  bridge.growth = 0;
  bridge.traffic = 0;

  return {
    trust,
    doubt,
    pattern,
    memory,
    question,
    threshold,
    bridge,
  };
}

/** Scripted narrative beats — growth, thickening, dormancy, return. */
export function createDemoTimeline(demo, field) {
  const { trust, doubt, bridge, pattern, question } = demo;
  const beats = [];

  beats.push({
    at: 2000,
    run: () => {
      bridge.passTraffic(0.3);
    },
    hint: "A filament begins to grow between trust and doubt…",
  });

  beats.push({
    at: 5000,
    run: () => {
      bridge.passTraffic(1);
      trust.orbit(0.1);
      doubt.orbit(0.1);
    },
    hint: "Both return to the same territory. The connection thickens.",
  });

  beats.push({
    at: 9000,
    run: () => {
      for (let i = 0; i < 4; i++) bridge.passTraffic(1);
      trust.orbit(0.15);
      doubt.orbit(0.15);
    },
    hint: "Fed by two root systems — the filament grows luminous.",
  });

  beats.push({
    at: 14000,
    run: () => {
      field.connect(trust, pattern).passTraffic(2);
      field.connect(doubt, question).passTraffic(2);
    },
    hint: "New branches form around the shared idea.",
  });

  beats.push({
    at: 20000,
    run: () => {
      bridge.goDormant();
    },
    hint: "They go quiet. The filaments thin and dim — but the route remains.",
  });

  beats.push({
    at: 28000,
    run: () => {
      bridge.reactivate();
      trust.orbit(0.2);
      doubt.orbit(0.2);
      for (let i = 0; i < 5; i++) bridge.passTraffic(1);
    },
    hint: "They return. The connection re-activates. Nothing was lost.",
  });

  return beats;
}

export function layoutResponsive(field, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const scale = Math.min(w, h) / 800;

  const positions = {
    trust: [cx - 140 * scale, cy - 30 * scale],
    doubt: [cx + 130 * scale, cy + 20 * scale],
    pattern: [cx - 60 * scale, cy + 70 * scale],
    memory: [cx - 200 * scale, cy + 50 * scale],
    question: [cx + 180 * scale, cy - 60 * scale],
    threshold: [cx + 40 * scale, cy - 90 * scale],
  };

  for (const node of field.nodes.values()) {
    const key = node.label;
    if (positions[key]) {
      node.x = positions[key][0];
      node.y = positions[key][1];
    }
  }
}
