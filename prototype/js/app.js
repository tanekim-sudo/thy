import { MyceliumField } from "./mycelium/model.js";
import { MyceliumRenderer } from "./mycelium/renderer.js";
import { seedDemo, createDemoTimeline, layoutResponsive } from "./mycelium/demo.js";

const canvas = document.getElementById("mycelium");
const hintEl = document.getElementById("hint");
const field = new MyceliumField();
const renderer = new MyceliumRenderer(canvas, field);

let demo = null;
let beats = [];
let beatIndex = 0;
let demoStart = 0;
const userFieldId = "self";

function init() {
  renderer.resize();
  demo = seedDemo(field, window.innerWidth, window.innerHeight);
  beats = createDemoTimeline(demo, field);
  demoStart = performance.now();
  beatIndex = 0;

  window.addEventListener("resize", () => {
    renderer.resize();
    layoutResponsive(field, window.innerWidth, window.innerHeight);
  });

  canvas.addEventListener("click", onCanvasClick);
  canvas.addEventListener("mousemove", onCanvasHover);

  requestAnimationFrame(loop);
}

function loop(now) {
  const dt = 1 / 60;
  runDemoBeats(now);
  field.update(dt, now);
  renderer.render(now);
  requestAnimationFrame(loop);
}

function runDemoBeats(now) {
  const elapsed = now - demoStart;
  while (beatIndex < beats.length && elapsed >= beats[beatIndex].at) {
    beats[beatIndex].run();
    if (hintEl && beats[beatIndex].hint) {
      hintEl.textContent = beats[beatIndex].hint;
      hintEl.classList.add("hint--visible");
    }
    beatIndex++;
  }
}

function onCanvasClick(e) {
  const { x, y } = pointerPos(e);
  const nearest = field.findNearestNode(x, y, 55, userFieldId);

  if (nearest) {
    nearest.orbit(0.12);
    for (const fid of nearest.filamentIds) {
      field.filaments.get(fid)?.passTraffic(1.5);
    }
    field.passTrafficNear(x, y, 80);
    if (hintEl) {
      hintEl.textContent = `Returning to "${nearest.label}" — the filament thickens.`;
      hintEl.classList.add("hint--visible");
    }
    return;
  }

  const otherNearest = field.findNearestNode(x, y, 70);
  if (otherNearest && otherNearest.fieldId !== userFieldId) {
    const mine = field.findNearestNode(x, y, 120, userFieldId);
    if (mine) {
      const bridge = field.connect(mine, otherNearest, {
        name: "new filament",
        isBridge: true,
      });
      if (bridge.growth < 0.15) bridge.growth = 0.1;
      if (hintEl) {
        hintEl.textContent = "Extending the mycelium — a living filament begins to grow.";
        hintEl.classList.add("hint--visible");
      }
      return;
    }
  }

  const label = prompt("Name this root node:", "thought");
  if (!label) return;

  const node = field.addNode({
    x,
    y,
    label: label.trim().slice(0, 24),
    fieldId: userFieldId,
    depth: 0.25,
  });
  node.engagement = 0.2;

  const anchor = field.findNearestNode(x, y, 100, userFieldId);
  if (anchor && anchor.id !== node.id) {
    field.connect(anchor, node).passTraffic(0.5);
  }

  if (hintEl) {
    hintEl.textContent = `"${node.label}" takes root in the soil.`;
    hintEl.classList.add("hint--visible");
  }
}

function onCanvasHover(e) {
  const pos = pointerPos(e);
  canvas.style.cursor = field.findNearestNode(pos.x, pos.y, 40) ? "pointer" : "crosshair";
}

function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

init();
