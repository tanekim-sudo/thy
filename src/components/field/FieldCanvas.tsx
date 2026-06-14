"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  stepPhysics,
  computeSemanticPosition,
  applyAdjustment,
} from "@/lib/physics";
import {
  makeGlowTexture,
  makeCoreTexture,
  makeHaloTexture,
  fragmentColor,
  fragmentVitality,
  filamentColor,
  vitalColor,
  STRUCTURAL_LIGHT,
} from "@/lib/glow";
import {
  FilamentTube,
  LichtenbergFilament,
  generateHyphae,
  hashStr,
} from "@/lib/field/mycelium";
import {
  connectionPruningVisuals,
  traverseFilament,
  isInstantPulse,
  normalizeFilament,
  HUB_DEGREE_THRESHOLD,
  DEFAULT_CONDUCTION_SPEED,
} from "@/lib/field/connections";
import {
  COSMOS_FILAMENT_OPACITY,
  cosmosLinkKey,
  cosmosVisibility,
  liveSessionCentroid,
} from "@/lib/field/cosmos";
import { DensityField } from "@/lib/field/density";
import { MurmurationField, murmurationVisibility, delay } from "@/lib/field/murmuration";
import { createFieldComposer } from "@/lib/field/postfx";
import { Transcriber } from "@/lib/transcription";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { nodesInLasso, traceNearPath } from "@/lib/field/selection";
import { openGlyphCurve, parseGlyph, serializeGlyph } from "@/lib/field/glyphs";
import { PageView } from "@/components/field/PageView";
import { emitFieldEvent } from "@/lib/field-events";
import {
  localBranchSeeds,
  localExecuteOutputs,
  localLegibilityBody,
  localReflectLabels,
} from "@/lib/field/guest-ai";
import type {
  ThoughtNode,
  FilamentEdge,
  Prosody,
  NegativeMark,
  UserTool,
  FieldThread,
  DraftDoc,
  ArrivedGlyph,
  CosmosSession,
  CosmosResonance,
} from "@/lib/types";

const uuid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`;

interface PendingAdjustment {
  brightenNodeId?: string;
  brightenAmount?: number;
  thickenFilamentId?: string;
  thickenAmount?: number;
  pullNodes?: { a: string; b: string; delta: number }[];
  durationMs: number;
  startedAt: number;
}

interface NodeVisual {
  core: THREE.Sprite;
  glow: THREE.Sprite;
  halo: THREE.Sprite;
  hubCore?: THREE.Sprite;
  hyphae: THREE.LineSegments;
  sketch?: THREE.Line;
  spin: number;
  axis: THREE.Vector3;
}

interface CondPulse {
  filamentId: string;
  start: number;
  duration: number;
  instant: boolean;
}

interface SettlingResidual {
  pos: THREE.Vector3;
  born: number;
  life: number;
  peak: number;
}

interface PendingSettle {
  startedAt: number;
  points: THREE.Vector3[];
}

export function FieldCanvas() {
  const mountRef = useRef<HTMLDivElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const glyphLayerRef = useRef<HTMLDivElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  const [partial, setPartial] = useState("");
  const [listening, setListening] = useState(false);
  const [typing, setTyping] = useState(false);
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState<ThoughtNode | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [pageDraft, setPageDraft] = useState<DraftDoc | null>(null);
  const [tools, setTools] = useState<UserTool[]>([]);
  const [threadAvgPos, setThreadAvgPos] = useState<[number, number]>([0, 0]);
  const voiceBlockedRef = useRef(false);

  // Open from utter darkness — the void resolves into being.
  useEffect(() => {
    const t = setTimeout(() => {
      setRevealed(true);
      emitFieldEvent("revealed");
    }, 80);
    return () => clearTimeout(t);
  }, []);

  const voiceRef = useRef<Transcriber | null>(null);
  const apiRef = useRef<{
    beginCapture: () => void;
    crystallize: (text: string, prosody?: Prosody) => void;
    onPartialText: (t: string) => void;
  } | null>(null);

  // World state lives in refs so the 60fps loop never waits on React.
  const nodesRef = useRef<ThoughtNode[]>([]);
  const filamentsRef = useRef<FilamentEdge[]>([]);
  const energyRef = useRef<"drift" | "turbulence">("drift");
  const lastActivityRef = useRef<number>(Date.now());
  const unprocessedRef = useRef<Set<string>>(new Set());
  const sessionIdRef = useRef<string>(uuid());
  const pendingAdjustRef = useRef<PendingAdjustment | null>(null);
  // Per-mind colour signature — every field runs a little warmer or cooler.
  const hueRef = useRef<number>(0);
  // Whether thoughts persist to an account, or live only on this device.
  const authedRef = useRef<boolean>(false);

  // Live capture thread.
  const captureRef = useRef<{
    active: boolean;
    target: [number, number, number];
    progress: number;
    text: string;
  }>({ active: false, target: [0, 0, 0], progress: 0, text: "" });

  useEffect(() => {
    const mount = mountRef.current!;
    const width = window.innerWidth;
    const height = window.innerHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a0f, 0.0013);

    const camera = new THREE.PerspectiveCamera(52, width / height, 1, 6000);
    camera.position.set(0, 0, 340);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x0a0a0f, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const fieldFx = createFieldComposer(renderer, scene, camera, width, height);

    const glowTex = makeGlowTexture();
    const coreTex = makeCoreTexture();
    const haloTex = makeHaloTexture();

    // ---- The void, designed from darkness outward ----------------------
    const skyGeom = new THREE.SphereGeometry(3200, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        // deep space: #111118 at the breathing heart, #0a0a0f at the edges
        cInner: { value: new THREE.Color(0.067, 0.067, 0.094) },
        cOuter: { value: new THREE.Color(0.039, 0.039, 0.059) },
        uTime: { value: 0 },
        // Substrate displacement amplitude — felt, never seen. Rises in silence.
        uNoiseAmp: { value: 1.0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 cInner;
        uniform vec3 cOuter;
        uniform float uTime;
        uniform float uNoiseAmp;

        // Value noise + light fbm — a slow drifting substrate, not a texture.
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float vnoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p) {
          float v = 0.0;
          v += 0.5 * vnoise(p);
          v += 0.25 * vnoise(p * 2.03);
          return v;
        }

        void main() {
          vec3 d = normalize(vDir);
          float t = uTime * 0.00004;
          // domain warp — extremely slow, sub-perceptual
          float warp = (fbm(d * 2.2 + vec3(t, t * 0.7, -t)) - 0.5) * 0.06 * uNoiseAmp;
          float h = d.y * 0.5 + 0.5 + warp;
          float rad = smoothstep(0.0, 1.0, 1.0 - length(d.xy) * 0.5) + warp * 0.5;
          vec3 col = mix(cOuter, cInner, smoothstep(0.0, 1.0, h) * 0.6 + rad * 0.4);
          // a breathing tide deep in the dark
          col += cInner * 0.15 * (0.5 + 0.5 * sin(uTime * 0.0003 + d.x * 2.0));
          // faint grain of structure, lifting in stillness
          col += cInner * 0.05 * uNoiseAmp * (fbm(d * 9.0 + vec3(t * 2.0)) - 0.5);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(skyGeom, skyMat);
    sky.renderOrder = -2;
    scene.add(sky);

    // ---- Drifting spores — the medium is alive, not empty --------------
    const SPORE_COUNT = 620;
    const sporePos = new Float32Array(SPORE_COUNT * 3);
    const sporeVel = new Float32Array(SPORE_COUNT * 3);
    const SPORE_R = 900;
    for (let i = 0; i < SPORE_COUNT; i++) {
      sporePos[i * 3] = (Math.random() - 0.5) * SPORE_R * 2;
      sporePos[i * 3 + 1] = (Math.random() - 0.5) * SPORE_R * 2;
      sporePos[i * 3 + 2] = (Math.random() - 0.5) * SPORE_R;
      sporeVel[i * 3] = (Math.random() - 0.5) * 0.04;
      sporeVel[i * 3 + 1] = (Math.random() - 0.5) * 0.04;
      sporeVel[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
    }
    const sporeGeom = new THREE.BufferGeometry();
    sporeGeom.setAttribute("position", new THREE.BufferAttribute(sporePos, 3));
    const sporeMat = new THREE.PointsMaterial({
      map: glowTex,
      size: 3.2,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: new THREE.Color(0.45, 0.62, 0.85),
      sizeAttenuation: true,
    });
    const spores = new THREE.Points(sporeGeom, sporeMat);
    spores.frustumCulled = false;
    scene.add(spores);

    // ---- The breathing center — Alexander's void -----------------------
    const voidGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: haloTex,
        color: new THREE.Color(0.12, 0.17, 0.28),
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    voidGlow.scale.set(150, 150, 1);
    scene.add(voidGlow);

    // ---- The tracing thread — a thought in the act of being spoken -----
    // Capture is creation-in-progress, so the thread burns in vital light (HDR
    // so it blooms) rather than the structural light of settled connections.
    const captureTube = new FilamentTube(99173, new THREE.Color(0.6, 2.5, 2.0), 30, 7);
    (captureTube.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
    scene.add(captureTube.mesh);

    // ---- Energy pulses — nutrients routing through the network ---------
    const PULSE_COUNT = 180;
    const pulses: THREE.Sprite[] = [];
    for (let i = 0; i < PULSE_COUNT; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: coreTex,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      s.visible = false;
      scene.add(s);
      pulses.push(s);
    }

    // ---- Bioluminescent cursor trail — thinking leaves light -----------
    const TRAIL_MAX = 26;
    const TRAIL_LIFE = 2400;
    const BLOOM_DURATION = 1500;
    const SETTLE_LIFE_MIN = 10000;
    const SETTLE_LIFE_MAX = 15000;
    const SETTLE_MAX_OPACITY = 0.08;
    const SETTLE_POOL = 72;

    const densityField = new DensityField();
    const murmurationField = new MurmurationField();
    const themeClusters: string[][] = [];

    const BIRD_POOL = 100;
    const birdSprites: THREE.Sprite[] = [];
    for (let i = 0; i < BIRD_POOL; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: coreTex,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          color: STRUCTURAL_LIGHT.clone(),
        })
      );
      s.visible = false;
      s.renderOrder = -1;
      scene.add(s);
      birdSprites.push(s);
    }
    const silhouetteLines = new Map<string, THREE.Line>();

    const trail: { pos: THREE.Vector3; born: number }[] = [];
    const trailSprites: THREE.Sprite[] = [];
    for (let i = 0; i < TRAIL_MAX; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          // The cursor is current touch — vital light, not structural.
          color: vitalColor(0.4),
        })
      );
      s.visible = false;
      scene.add(s);
      trailSprites.push(s);
    }

    // Settling — faint residual afterglow where bloom has passed (6.4 / bay).
    const settlingResiduals: SettlingResidual[] = [];
    const pendingSettles: PendingSettle[] = [];
    const settleSprites: THREE.Sprite[] = [];
    for (let i = 0; i < SETTLE_POOL; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          color: vitalColor(0.55),
        })
      );
      s.visible = false;
      scene.add(s);
      settleSprites.push(s);
    }

    // ---- Negative space — what was approached but never said -----------
    const negativeMarks: NegativeMark[] = [];
    let negDirty = false;
    const negGeom = new THREE.BufferGeometry();
    negGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
    const negPoints = new THREE.Points(
      negGeom,
      new THREE.PointsMaterial({
        map: coreTex,
        size: 5,
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: new THREE.Color(0.4, 0.46, 0.6),
        sizeAttenuation: true,
      })
    );
    negPoints.frustumCulled = false;
    scene.add(negPoints);

    function rebuildNegative() {
      if (negativeMarks.length === 0) {
        negPoints.visible = false;
        return;
      }
      const arr = new Float32Array(negativeMarks.length * 3);
      for (let i = 0; i < negativeMarks.length; i++) {
        // Push each mark out to the rim of the field — present at the periphery.
        const m = negativeMarks[i];
        const len = Math.hypot(m.x, m.y) || 1;
        const r = 620 + ((hashStr(m.content || String(i)) % 100) / 100) * 120;
        arr[i * 3] = (m.x / len) * r;
        arr[i * 3 + 1] = (m.y / len) * r;
        arr[i * 3 + 2] = -120 - (hashStr(m.content || String(i)) % 120);
      }
      negGeom.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      negGeom.attributes.position.needsUpdate = true;
      negPoints.visible = true;
    }

    // ---- Transient attention bursts ------------------------------------
    // Touch-bloom propagation along connections, and star-birth on a
    // confidence threshold crossing. Both decay over ~1.5s.
    const bloomBurst = new Map<string, { amt: number; start: number }>();
    const birthBurst = new Map<string, { amt: number; start: number }>();
    // 18.3 — one-shot conduction pulses fired on each traversal.
    const condPulses: CondPulse[] = [];
    const lastTraverseAt = new Map<string, number>();

    // Field breathing amplitude (drives substrate displacement during silence).
    let breathAmp = 1.0;

    // Scene-graph registries keyed by domain id.
    const nodeVis = new Map<string, NodeVisual>();
    const tubes = new Map<string, LichtenbergFilament>();
    // 18.4 — cosmos web: inter-session filaments and session cluster points.
    const cosmosSessions: CosmosSession[] = [];
    const cosmosResonances: CosmosResonance[] = [];
    const cosmosSprites = new Map<string, THREE.Sprite>();
    const cosmosTubes = new Map<string, LichtenbergFilament>();
    const labelEls = new Map<string, HTMLDivElement>();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const parallax = { x: 0, y: 0, tx: 0, ty: 0 };

    function screenToWorld(clientX: number, clientY: number): THREE.Vector3 {
      pointer.x = (clientX / window.innerWidth) * 2 - 1;
      pointer.y = -(clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const target = new THREE.Vector3();
      raycaster.ray.intersectPlane(groundPlane, target);
      return target ?? new THREE.Vector3();
    }

    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    const tmpC = new THREE.Vector3();

    // ---- Phase-2 systems state -----------------------------------------
    // The implicit-question center-lift, on-demand reflection mode, the
    // cross-session palimpsest substrate, and sketch capture.
    let voidLifted = false;
    let reflection:
      | { emphasize: Set<string>; labels: { ids: string[]; label: string }[]; until: number }
      | null = null;
    const reflectEls: HTMLDivElement[] = [];
    const palimpsest: { x: number; y: number; mass: number }[] = [];

    // Sketch capture (hold Shift and drag over empty field).
    let sketching = false;
    let sketchPts: THREE.Vector3[] = [];
    const sketchLiveGeom = new THREE.BufferGeometry();
    sketchLiveGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(600 * 3), 3));
    const sketchLive = new THREE.Line(
      sketchLiveGeom,
      new THREE.LineBasicMaterial({
        color: new THREE.Color(0.7, 0.85, 1.0),
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    sketchLive.frustumCulled = false;
    sketchLive.visible = false;
    scene.add(sketchLive);

    // Faint palimpsest substrate — the ghost of recent sessions, beneath.
    const palimGeom = new THREE.BufferGeometry();
    palimGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
    const palimPoints = new THREE.Points(
      palimGeom,
      new THREE.PointsMaterial({
        map: haloTex,
        size: 90,
        transparent: true,
        opacity: 0.04,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: new THREE.Color(0.3, 0.4, 0.55),
        sizeAttenuation: true,
      })
    );
    palimPoints.frustumCulled = false;
    palimPoints.visible = false;
    palimPoints.renderOrder = -1;
    scene.add(palimPoints);

    function buildSketchLine(pathJson: string): THREE.Line | null {
      let pts: number[][];
      try {
        pts = JSON.parse(pathJson);
      } catch {
        return null;
      }
      if (!Array.isArray(pts) || pts.length < 2) return null;
      const arr = new Float32Array(pts.length * 3);
      for (let i = 0; i < pts.length; i++) {
        arr[i * 3] = pts[i][0] ?? 0;
        arr[i * 3 + 1] = pts[i][1] ?? 0;
        arr[i * 3 + 2] = pts[i][2] ?? 0;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      return new THREE.Line(
        g,
        new THREE.LineBasicMaterial({
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          color: new THREE.Color(0.7, 0.85, 1.0),
        })
      );
    }

    function rebuildPalimpsest() {
      if (palimpsest.length === 0) {
        palimPoints.visible = false;
        return;
      }
      const arr = new Float32Array(palimpsest.length * 3);
      for (let i = 0; i < palimpsest.length; i++) {
        arr[i * 3] = palimpsest[i].x;
        arr[i * 3 + 1] = palimpsest[i].y;
        arr[i * 3 + 2] = -40;
      }
      palimGeom.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      palimGeom.attributes.position.needsUpdate = true;
      (palimPoints.material as THREE.PointsMaterial).size = 90;
      palimPoints.visible = true;
    }

    // ---- Part 14 / 15 / 17 — Selection, workbench, threads, branch focus ---
    const selectedIds = new Set<string>();
    let selectSettleTimer: ReturnType<typeof setTimeout> | undefined;
    const selectionEls = new Map<string, HTMLDivElement>();
    const arrivedGlyphs: ArrivedGlyph[] = [];
    let glyphAnimRaf = 0;
    let creatingTool = false;
    let toolCreateInput: HTMLInputElement | null = null;

    const userTools: UserTool[] = [];
    const fieldThreads: FieldThread[] = [];
    const threadLineGeoms = new Map<string, THREE.BufferGeometry>();
    const threadLines = new Map<string, THREE.Line>();

    let lassoing = false;
    let lassoPts: [number, number][] = [];
    let tracing = false;
    let traceScreenPts: { x: number; y: number }[] = [];
    let activeTraceThreadId: string | null = null;

    let branchFocusId: string | null = null;
    let threadLegibilityTimer: ReturnType<typeof setTimeout> | undefined;
    const BRANCH_HUES = [0.08, 0.22, 0.42, 0.62];
    const WARM_GOLD = new THREE.Color(0.95, 0.72, 0.38);

    function projectNode(n: ThoughtNode) {
      tmpA.set(n.position[0], n.position[1], n.position[2]).project(camera);
      if (tmpA.z > 1) return null;
      return {
        x: (tmpA.x * 0.5 + 0.5) * window.innerWidth,
        y: (-tmpA.y * 0.5 + 0.5) * window.innerHeight,
      };
    }

    function selectionCentroidScreen(): { x: number; y: number } {
      let cx = 0;
      let cy = 0;
      let c = 0;
      for (const id of selectedIds) {
        const n = nodesRef.current.find((x) => x.id === id);
        const p = n ? projectNode(n) : null;
        if (p) {
          cx += p.x;
          cy += p.y;
          c++;
        }
      }
      if (!c) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      return { x: cx / c, y: cy / c };
    }

    function dismissWorkbench() {
      for (const g of arrivedGlyphs) g.dismissing = true;
      clearTimeout(selectSettleTimer);
      setTimeout(() => {
        arrivedGlyphs.length = 0;
        if (glyphLayerRef.current) glyphLayerRef.current.innerHTML = "";
      }, 500);
    }

    function scheduleWorkbenchArrival() {
      clearTimeout(selectSettleTimer);
      if (selectedIds.size === 0) {
        dismissWorkbench();
        return;
      }
      selectSettleTimer = setTimeout(() => arriveWorkbenchGlyphs(), 300);
    }

    function renderGlyphs() {
      const layer = glyphLayerRef.current;
      if (!layer) return;
      layer.innerHTML = "";
      for (const g of arrivedGlyphs) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "workbench-glyph";
        btn.style.cssText = `position:absolute;left:${g.x}px;top:${g.y}px;transform:translate(-50%,-50%);opacity:${g.progress * 0.9};border:0;background:transparent;cursor:pointer;padding:10px;pointer-events:auto;`;
        if (g.isReflect) {
          btn.innerHTML = `<span style="display:block;width:32px;height:32px;border-radius:50%;border:1px solid rgba(180,200,230,0.4);box-shadow:0 0 14px rgba(140,180,220,0.25)"></span>`;
        } else if (g.isOpen) {
          const pts = openGlyphCurve()
            .map((p) => `${p[0] * 14},${p[1] * 14}`)
            .join(" ");
          btn.innerHTML = `<svg width="36" height="36" viewBox="-20 -20 40 40"><polyline points="${pts}" fill="none" stroke="rgba(180,210,240,0.55)" stroke-width="1.2"/></svg>`;
        } else {
          const pts = parseGlyph(g.glyphPath)
            .map((p) => `${p[0] * 14},${p[1] * 14}`)
            .join(" ");
          btn.innerHTML = `<svg width="32" height="32" viewBox="-20 -20 40 40"><polygon points="${pts}" fill="none" stroke="rgba(160,200,235,0.5)" stroke-width="1"/></svg>`;
        }
        btn.onmousedown = (e) => e.stopPropagation();
        btn.onclick = (e) => {
          e.stopPropagation();
          invokeWorkbenchGlyph(g);
        };
        btn.oncontextmenu = (e) => e.preventDefault();
        let pressTimer: ReturnType<typeof setTimeout>;
        btn.onpointerdown = () => {
          pressTimer = setTimeout(() => {
            if (g.toolId !== "create" && g.toolId !== "reflect" && g.instruction) {
              const el = document.createElement("input");
              el.value = g.instruction;
              el.className =
                "absolute z-50 border-0 border-b border-[rgba(150,190,220,0.3)] bg-transparent text-center text-xs text-[rgba(200,220,240,0.7)] outline-none";
              el.style.left = `${g.x}px`;
              el.style.top = `${g.y - 36}px`;
              el.style.transform = "translateX(-50%)";
              el.style.width = "220px";
              layer.appendChild(el);
              el.focus();
              el.onkeydown = (ev) => {
                if (ev.key === "Enter") {
                  fetch(`/api/tools/${g.toolId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ instruction: el.value }),
                  }).catch(() => {});
                  g.instruction = el.value;
                  el.remove();
                }
                if (ev.key === "Escape") el.remove();
              };
            }
          }, 600);
        };
        btn.onpointerup = () => clearTimeout(pressTimer);
        layer.appendChild(btn);
      }
    }

    function tickGlyphs() {
      for (const g of arrivedGlyphs) {
        const target = g.dismissing ? 0 : 1;
        g.progress += (target - g.progress) * (g.dismissing ? 0.09 : 0.07);
        g.x = g.fromX + (g.tx - g.fromX) * g.progress;
        g.y = g.fromY + (g.ty - g.fromY) * g.progress;
      }
      arrivedGlyphs.filter((g) => g.dismissing && g.progress < 0.02).forEach((g) => {
        const i = arrivedGlyphs.indexOf(g);
        if (i >= 0) arrivedGlyphs.splice(i, 1);
      });
      renderGlyphs();
      if (arrivedGlyphs.length) glyphAnimRaf = requestAnimationFrame(tickGlyphs);
    }

    function arriveWorkbenchGlyphs() {
      if (selectedIds.size === 0) return;
      arrivedGlyphs.length = 0;
      const cen = selectionCentroidScreen();
      const ranked = [...userTools]
        .filter((t) => t.builtinKind !== "reflect")
        .sort((a, b) => b.mass - a.mass || b.lastUsedAt - a.lastUsedAt);
      const picks: { id: string; instruction: string; glyphPath?: string; isReflect?: boolean; isOpen?: boolean }[] = [];
      if (selectedIds.size === 1) {
        const branch = userTools.find((t) => t.builtinKind === "branch");
        if (branch) picks.push({ id: branch.id, instruction: branch.instruction, glyphPath: branch.glyphPath });
      }
      for (const t of ranked.slice(0, 3)) {
        if (!picks.find((p) => p.id === t.id)) {
          picks.push({ id: t.id, instruction: t.instruction, glyphPath: t.glyphPath });
        }
      }
      const reflect = userTools.find((t) => t.builtinKind === "reflect");
      if (reflect) picks.push({ id: "reflect", instruction: reflect.instruction, isReflect: true });
      picks.push({ id: "create", instruction: "", isOpen: true });

      picks.slice(0, 5).forEach((p, i) => {
        const ang = -Math.PI / 2 + (i - (picks.length - 1) / 2) * 0.38;
        const edge = i % 4;
        const fromX =
          edge < 2 ? (edge === 0 ? -50 : window.innerWidth + 50) : cen.x + Math.cos(ang) * 420;
        const fromY =
          edge >= 2 ? (edge === 2 ? -50 : window.innerHeight + 50) : cen.y + Math.sin(ang) * 420;
        arrivedGlyphs.push({
          key: `${p.id}-${i}`,
          toolId: p.id,
          instruction: p.instruction,
          progress: 0,
          x: fromX,
          y: fromY,
          tx: cen.x + Math.cos(ang) * 100,
          ty: cen.y + Math.sin(ang) * 70,
          fromX,
          fromY,
          dismissing: false,
          isOpen: Boolean(p.isOpen),
          isReflect: Boolean(p.isReflect),
          glyphPath: p.glyphPath,
        });
      });
      cancelAnimationFrame(glyphAnimRaf);
      glyphAnimRaf = requestAnimationFrame(tickGlyphs);
      emitFieldEvent("workbench-arrived", { count: arrivedGlyphs.length });
    }

    function toggleSelect(id: string) {
      if (selectedIds.has(id)) selectedIds.delete(id);
      else {
        selectedIds.clear();
        selectedIds.add(id);
      }
      updateSelectionOutlines();
      scheduleWorkbenchArrival();
      if (selectedIds.size > 0) emitFieldEvent("select", { ids: [...selectedIds] });
    }

    function setSelection(ids: string[]) {
      selectedIds.clear();
      for (const id of ids) selectedIds.add(id);
      updateSelectionOutlines();
      scheduleWorkbenchArrival();
      if (ids.length > 0) emitFieldEvent("lasso", { count: ids.length });
      if (ids.length > 0) emitFieldEvent("select", { ids });
    }

    function clearSelection() {
      selectedIds.clear();
      dismissWorkbench();
      updateSelectionOutlines();
    }

    function updateSelectionOutlines() {
      for (const [id, el] of selectionEls) {
        if (!selectedIds.has(id)) {
          el.style.opacity = "0";
        }
      }
      for (const id of selectedIds) {
        let el = selectionEls.get(id);
        const n = nodesRef.current.find((x) => x.id === id);
        if (!n) continue;
        const p = projectNode(n);
        if (!p) continue;
        if (!el) {
          el = document.createElement("div");
          el.className = "selection-outline";
          el.style.cssText =
            "position:absolute;pointer-events:none;width:56px;height:56px;border-radius:50%;border:1px solid rgba(200,230,255,0.55);box-shadow:0 0 18px rgba(160,200,240,0.25);transform:translate(-50%,-50%);transition:opacity 0.2s;";
          labelLayerRef.current?.appendChild(el);
          selectionEls.set(id, el);
        }
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
        el.style.opacity = "1";
      }
    }

    function selectionText(): string {
      return [...selectedIds]
        .map((id) => nodesRef.current.find((n) => n.id === id)?.rawText)
        .filter(Boolean)
        .join("\n");
    }

    async function invokeWorkbenchGlyph(g: ArrivedGlyph) {
      if (!authedRef.current && g.toolId !== "create") {
        setStatus("preview mode — sign in for full Claude");
      }
      emitFieldEvent("tool-invoked", { toolId: g.toolId });
      if (g.toolId === "create") {
        emitFieldEvent("custom-tool-prompt");
        creatingTool = true;
        if (!toolCreateInput && glyphLayerRef.current) {
          toolCreateInput = document.createElement("input");
          toolCreateInput.placeholder = "state the instruction…";
          toolCreateInput.className =
            "fixed bottom-28 left-1/2 z-50 w-[min(80vw,28rem)] -translate-x-1/2 border-0 border-b border-[rgba(150,190,220,0.25)] bg-transparent text-center text-base font-light text-[rgba(200,220,240,0.75)] outline-none";
          glyphLayerRef.current.appendChild(toolCreateInput);
          toolCreateInput.focus();
          toolCreateInput.onkeydown = async (ev) => {
            if (ev.key === "Enter" && toolCreateInput) {
              const instruction = toolCreateInput.value.trim();
              if (!instruction) return;
              if (authedRef.current) {
                const res = await fetch("/api/tools", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ instruction }),
                });
                const data = await res.json();
                if (data.tool) userTools.push(data.tool);
              }
              emitFieldEvent("custom-tool-created", { instruction });
              await runGenericTool(instruction);
              toolCreateInput.remove();
              toolCreateInput = null;
              creatingTool = false;
              dismissWorkbench();
            }
            if (ev.key === "Escape" && toolCreateInput) {
              toolCreateInput.remove();
              toolCreateInput = null;
              creatingTool = false;
            }
          };
        }
        return;
      }
      const tool = userTools.find((t) => t.id === g.toolId);
      if (g.isReflect || tool?.builtinKind === "reflect") {
        await runReflectionOnSelection();
        dismissWorkbench();
        return;
      }
      if (tool?.builtinKind === "branch" && selectedIds.size === 1) {
        const id = [...selectedIds][0];
        const node = nodesRef.current.find((n) => n.id === id);
        if (node) await runBranchTool(node);
        dismissWorkbench();
        return;
      }
      if (tool) {
        fetch(`/api/tools/${tool.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ used: true }),
        }).catch(() => {});
        await runGenericTool(tool.instruction);
      }
      dismissWorkbench();
    }

    async function runGenericTool(instruction: string) {
      const sel = selectionText();
      if (!sel) return;
      if (!authedRef.current) {
        const outputs = localExecuteOutputs(instruction, sel);
        const cen = selectionCentroidScreen();
        const wp = screenToWorld(cen.x, cen.y);
        outputs.forEach((text, i) => {
          void (async () => {
            murmurationField.triggerMurmurForMembers([...selectedIds]);
            await delay(1400);
            createAiFragment(text, "ai_expansion", [wp.x + i * 28, wp.y + 40, -8], 0.2);
          })();
        });
        emitFieldEvent("tool-execute", { instruction });
        return;
      }
      try {
        const res = await fetch("/api/claude/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instruction, selection: sel }),
        });
        const data = await res.json();
        const outputs: string[] = Array.isArray(data.outputs) ? data.outputs : [];
        const cen = selectionCentroidScreen();
        const wp = screenToWorld(cen.x, cen.y);
        outputs.slice(0, 3).forEach((text, i) => {
          void (async () => {
            murmurationField.triggerMurmurForMembers([...selectedIds]);
            await delay(1400);
            createAiFragment(text, "ai_expansion", [wp.x + i * 28, wp.y + 40, -8], 0.2);
          })();
        });
        if (outputs.length === 0) setStatus("Claude returned nothing — try again in a moment");
        else emitFieldEvent("tool-execute", { instruction });
      } catch {
        setStatus("could not reach Claude — check connection");
      }
    }

    async function runReflectionOnSelection() {
      const ids = [...selectedIds];
      if (!authedRef.current) {
        const local = localReflectLabels(ids);
        const emphasize = new Set<string>(local.emphasize);
        reflection = { emphasize, labels: local.labels, until: performance.now() + 10000 };
        emitFieldEvent("reflection", { fragmentIds: ids });
        return;
      }
      try {
        const res = await fetch("/api/claude/reflect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionIdRef.current, fragmentIds: ids }),
        });
        const data = await res.json();
        const r = data.reflection;
        if (!r) return;
        const emphasize = new Set<string>();
        for (const c of r.emphasizeClusters ?? []) for (const id of c) emphasize.add(id);
        for (const id of ids) emphasize.add(id);
        reflection = { emphasize, labels: r.clusterLabels ?? [], until: performance.now() + 10000 };
        emitFieldEvent("reflection", { fragmentIds: ids });
      } catch {
        /* quiet */
      }
    }

    async function runBranchTool(source: ThoughtNode) {
      let seeds: string[] = [];
      if (!authedRef.current) {
        seeds = localBranchSeeds(source.rawText);
      } else {
        try {
          const res = await fetch("/api/claude/branch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: source.rawText }),
          });
          if (!res.ok) throw new Error("branch failed");
          const data = await res.json();
          seeds = Array.isArray(data.seeds) ? data.seeds : [];
        } catch {
          setStatus("Branch needs Claude — check connection");
          return;
        }
      }
      if (seeds.length === 0) return;
      murmurationField.triggerMurmurForMembers([source.id]);
      await delay(1400);
      const n = Math.min(4, seeds.length);
        const dist = 95;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2;
          const pos: [number, number, number] = [
            source.position[0] + Math.cos(ang) * dist,
            source.position[1] + Math.sin(ang) * dist,
            source.position[2],
          ];
          const node = createAiFragment(String(seeds[i]), "ai_branch", pos, 0.15);
          node.parentFragmentId = source.id;
          node.branchHue = i;
          node.branchPendingGerm = true;
          const f = edge(source.id, node.id, 0.22, "branch");
          filamentsRef.current.push(f);
          fireCondPulse(f);
        }
        emitFieldEvent("branch", { count: n });
    }

    function focusSetForBranch(branchId: string): Set<string> {
      const out = new Set<string>([branchId]);
      const branch = nodesRef.current.find((n) => n.id === branchId);
      if (branch?.parentFragmentId) out.add(branch.parentFragmentId);
      for (const f of filamentsRef.current) {
        if (f.type !== "branch") continue;
        if (f.sourceId === branchId) out.add(f.targetId);
        if (f.targetId === branchId) out.add(f.sourceId);
      }
      return out;
    }

    function isFocusDimmed(nodeId: string): boolean {
      if (!branchFocusId) return false;
      return !focusSetForBranch(branchFocusId).has(nodeId);
    }

    function rebuildThreadLine(thread: FieldThread) {
      if (thread.positions.length < 2) return;
      const arr = new Float32Array(thread.positions.length * 3);
      for (let i = 0; i < thread.positions.length; i++) {
        arr[i * 3] = thread.positions[i][0];
        arr[i * 3 + 1] = thread.positions[i][1];
        arr[i * 3 + 2] = -5;
      }
      let geom = threadLineGeoms.get(thread.id);
      let line = threadLines.get(thread.id);
      if (!geom) {
        geom = new THREE.BufferGeometry();
        threadLineGeoms.set(thread.id, geom);
      }
      geom.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      if (!line) {
        line = new THREE.Line(
          geom,
          new THREE.LineBasicMaterial({
            color: WARM_GOLD,
            transparent: true,
            opacity: 0.35,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        threadLines.set(thread.id, line);
        scene.add(line);
      } else {
        line.geometry = geom;
      }
    }

    async function completeTrace(fragmentIds: string[]) {
      if (fragmentIds.length === 0) return;
      const positions = fragmentIds
        .map((id) => nodesRef.current.find((n) => n.id === id))
        .filter(Boolean)
        .map((n) => [n!.position[0], n!.position[1]] as [number, number]);
      if (!authedRef.current) {
        const id = uuid();
        fieldThreads.push({ id, fragmentIds, positions });
        rebuildThreadLine(fieldThreads[fieldThreads.length - 1]);
        emitFieldEvent("trace-complete", { count: fragmentIds.length });
        return;
      }
      try {
        const res = await fetch("/api/threads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            fragmentIds,
            extendThreadId: activeTraceThreadId,
          }),
        });
        const data = await res.json();
        if (data.thread) {
          const existing = fieldThreads.find((t) => t.id === data.thread.id);
          if (existing) {
            existing.fragmentIds = data.thread.fragmentIds;
            existing.positions = data.thread.positions;
          } else {
            fieldThreads.push(data.thread);
          }
          rebuildThreadLine(data.thread);
          activeTraceThreadId = data.thread.id;
          emitFieldEvent("trace-complete", { count: fragmentIds.length });
        }
      } catch {
        /* quiet */
      }
    }

    function threadIdNearScreen(cx: number, cy: number): string | null {
      for (const t of fieldThreads) {
        for (const p of t.positions) {
          tmpA.set(p[0], p[1], -5).project(camera);
          if (tmpA.z > 1) continue;
          const sx = (tmpA.x * 0.5 + 0.5) * window.innerWidth;
          const sy = (-tmpA.y * 0.5 + 0.5) * window.innerHeight;
          if (Math.hypot(sx - cx, sy - cy) < 40) return t.id;
        }
      }
      return null;
    }

    async function legibilityForThread(threadId: string) {
      const thread = fieldThreads.find((t) => t.id === threadId);
      if (!thread) return;

      let ax = 0;
      let ay = 0;
      if (thread.positions.length) {
        for (const p of thread.positions) {
          ax += p[0];
          ay += p[1];
        }
        ax /= thread.positions.length;
        ay /= thread.positions.length;
      }

      if (!authedRef.current) {
        const texts = thread.fragmentIds
          .map((id) => nodesRef.current.find((n) => n.id === id)?.rawText ?? "")
          .filter(Boolean);
        const draft: DraftDoc = {
          id: `guest-${threadId}`,
          threadId,
          content: localLegibilityBody(texts),
          updatedAt: Date.now(),
        };
        for (const id of thread.fragmentIds) {
          const n = nodesRef.current.find((x) => x.id === id);
          if (n) n.inDraft = true;
        }
        setThreadAvgPos([ax, ay]);
        setPageDraft(draft);
        emitFieldEvent("thread-legibility", { threadId });
        emitFieldEvent("page-open", { draftId: draft.id });
        return;
      }

      try {
        const res = await fetch("/api/claude/legibility", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId }),
        });
        const data = await res.json();
        if (data.draft) {
          for (const id of data.fragmentIds ?? []) {
            const n = nodesRef.current.find((x) => x.id === id);
            if (n) n.inDraft = true;
          }
          setThreadAvgPos([ax, ay]);
          setPageDraft(data.draft);
          emitFieldEvent("thread-legibility", { threadId });
          emitFieldEvent("page-open", { draftId: data.draft.id });
        }
      } catch {
        setStatus("Legibility needs Claude — check connection");
      }
    }

    // ---- Sync three objects to data refs -------------------------------
    function fireCondPulse(f: FilamentEdge) {
      const duration = traverseFilament(f);
      condPulses.push({
        filamentId: f.id,
        start: performance.now(),
        duration,
        instant: isInstantPulse(f.conductionSpeed ?? DEFAULT_CONDUCTION_SPEED),
      });
      if (condPulses.length > 48) condPulses.shift();
    }

    function maybeTraverseOnDrag(f: FilamentEdge, now: number) {
      const last = lastTraverseAt.get(f.id) ?? 0;
      if (now - last < 500) return;
      lastTraverseAt.set(f.id, now);
      fireCondPulse(f);
      scheduleGuestSave();
    }

    /** Resolve a session id from cosmos API data (incl. __current__ alias). */
    function resolveCosmosSession(
      id: string,
      live: CosmosSession | null,
      byId: Map<string, CosmosSession>
    ): CosmosSession | null {
      if (id === "__current__" || id === sessionIdRef.current) return live;
      return byId.get(id) ?? null;
    }

    function buildCosmosSessionList(live: CosmosSession | null): CosmosSession[] {
      const list = [...cosmosSessions];
      if (live) {
        const cur = { ...live, id: sessionIdRef.current, isCurrent: true };
        const idx = list.findIndex((s) => s.id === sessionIdRef.current);
        if (idx >= 0) list[idx] = cur;
        else list.push(cur);
      }
      return list;
    }

    // 18.4 — Cosmos view: sessions as cluster lights linked by the cosmic web.
    function syncCosmos(now: number, lod: number) {
      const vis = cosmosVisibility(lod);
      if (vis <= 0.001) {
        for (const spr of cosmosSprites.values()) spr.visible = false;
        for (const tube of cosmosTubes.values()) tube.mesh.visible = false;
        return;
      }

      const live = liveSessionCentroid(nodesRef.current);
      const sessions = buildCosmosSessionList(live);
      const byId = new Map(sessions.map((s) => [s.id, s]));
      const seenSessions = new Set<string>();

      for (const s of sessions) {
        if (!s.isCurrent) {
          seenSessions.add(s.id);
          let spr = cosmosSprites.get(s.id);
          if (!spr) {
            spr = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: haloTex,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                color: STRUCTURAL_LIGHT.clone(),
              })
            );
            spr.renderOrder = -1;
            scene.add(spr);
            cosmosSprites.set(s.id, spr);
          }
          spr.position.set(s.position[0], s.position[1], s.position[2]);
          const size = 14 + Math.sqrt(Math.max(0.2, s.mass)) * 32;
          spr.scale.setScalar(size * (0.85 + vis * 0.25));
          const mat = spr.material as THREE.SpriteMaterial;
          mat.color.copy(STRUCTURAL_LIGHT).multiplyScalar(1.1 + Math.min(1.2, s.mass * 0.2));
          mat.opacity = 0.28 * vis;
          spr.visible = true;
        }
      }

      for (const [id, spr] of cosmosSprites) {
        if (!seenSessions.has(id)) {
          spr.visible = false;
        }
      }

      const energyAmp = energyRef.current === "turbulence" ? 10 : 6;
      const seenLinks = new Set<string>();

      for (const r of cosmosResonances) {
        const a = resolveCosmosSession(r.sourceSessionId, live, byId);
        const b = resolveCosmosSession(r.targetSessionId, live, byId);
        if (!a || !b) continue;

        const key = cosmosLinkKey(
          a.id === sessionIdRef.current ? "__current__" : a.id,
          b.id === sessionIdRef.current ? "__current__" : b.id
        );
        seenLinks.add(key);

        let tube = cosmosTubes.get(key);
        if (!tube) {
          tube = new LichtenbergFilament(hashStr(key), filamentColor());
          tube.mesh.renderOrder = -1;
          scene.add(tube.mesh);
          cosmosTubes.set(key, tube);
        }
        tube.mesh.visible = true;

        tmpA.set(a.position[0], a.position[1], a.position[2]);
        tmpB.set(b.position[0], b.position[1], b.position[2]);
        const strength = Math.max(0.15, Math.min(1, r.strength));
        tube.update(
          tmpA,
          tmpB,
          Math.max(0.5, a.mass),
          Math.max(0.5, b.mass),
          strength,
          strength,
          strength,
          now,
          energyAmp
        );

        const structural = filamentColor().multiplyScalar(0.35 + strength * 0.9);
        tube.setAppearance(structural, COSMOS_FILAMENT_OPACITY * vis * (0.5 + strength * 0.5));
      }

      for (const [key, tube] of cosmosTubes) {
        if (!seenLinks.has(key)) tube.mesh.visible = false;
      }
    }

    // 18.5 — Murmuration silhouettes at zoomed-out scale.
    function syncMurmuration(now: number, lod: number, dt: number) {
      const vis = murmurationVisibility(lod);
      murmurationField.update(
        nodesRef.current,
        filamentsRef.current,
        themeClusters,
        dt,
        now
      );

      if (vis <= 0.001) {
        for (const s of birdSprites) s.visible = false;
        for (const line of silhouetteLines.values()) line.visible = false;
        if (lod < 0.5) murmurationEmitted = false;
        return;
      }
      if (vis > 0.2 && !murmurationEmitted) {
        murmurationEmitted = true;
        emitFieldEvent("murmuration-visible");
      }

      const nodes = nodesRef.current;
      let birdIdx = 0;
      const activeClusterIds = new Set<string>();

      for (const cluster of murmurationField.clusters) {
        activeClusterIds.add(cluster.id);
        const birds = murmurationField.birdPositions(cluster, nodes);
        const murmurActive = cluster.murmurUntil > now;
        const flutter = murmurActive ? 1.25 : 1;

        for (const b of birds) {
          if (birdIdx >= BIRD_POOL) break;
          const s = birdSprites[birdIdx++];
          s.visible = true;
          s.position.set(b.x, b.y, -18);
          const base = b.role === "ai_peripheral" ? 2.0 : 3.6;
          s.scale.setScalar(base * flutter * (0.45 + vis * 0.75));
          const mat = s.material as THREE.SpriteMaterial;
          mat.color.copy(STRUCTURAL_LIGHT).multiplyScalar(
            b.role === "ai_peripheral" ? 0.65 : 1.05
          );
          mat.opacity = (b.role === "ai_peripheral" ? 0.18 : 0.42) * vis * flutter;
        }

        const contour = murmurationField.buildSilhouetteContour(cluster, nodes);
        let line = silhouetteLines.get(cluster.id);
        if (contour && contour.points.length >= 6) {
          if (!line) {
            const geom = new THREE.BufferGeometry();
            line = new THREE.Line(
              geom,
              new THREE.LineBasicMaterial({
                color: STRUCTURAL_LIGHT.clone(),
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
              })
            );
            line.frustumCulled = false;
            line.renderOrder = -1;
            scene.add(line);
            silhouetteLines.set(cluster.id, line);
          }
          line.visible = true;
          const geom = line.geometry as THREE.BufferGeometry;
          geom.setAttribute("position", new THREE.BufferAttribute(contour.points, 3));
          geom.attributes.position.needsUpdate = true;
          const mat = line.material as THREE.LineBasicMaterial;
          const resolveBoost = cluster.resolving ? 2.0 : 1;
          mat.opacity = (0.1 + cluster.coherence * 0.32) * vis * resolveBoost;
          mat.color.copy(STRUCTURAL_LIGHT).multiplyScalar(0.9 + cluster.coherence * 0.5 + (cluster.resolving ? 0.6 : 0));
        } else if (line) {
          line.visible = false;
        }
      }

      for (; birdIdx < BIRD_POOL; birdIdx++) {
        if (birdSprites[birdIdx].visible) birdSprites[birdIdx].visible = false;
      }
      for (const [id, line] of silhouetteLines) {
        if (!activeClusterIds.has(id)) line.visible = false;
      }
    }

    function syncScene(now: number, lod: number) {
      const nodes = nodesRef.current;
      const nowMs = Date.now();
      const seen = new Set<string>();
      const cosmosVis = cosmosVisibility(lod);
      const intraFade = 1 - cosmosVis * 0.88;
      const murVis = murmurationVisibility(lod);

      // 18.3 — hub fragments: degree ≥ threshold gets a tighter structural core.
      const hubDegree = new Map<string, number>();
      for (const f of filamentsRef.current) {
        if (f.strength < 0.05) continue;
        hubDegree.set(f.sourceId, (hubDegree.get(f.sourceId) ?? 0) + 1);
        hubDegree.set(f.targetId, (hubDegree.get(f.targetId) ?? 0) + 1);
      }

      for (const node of nodes) {
        seen.add(node.id);
        let vis = nodeVis.get(node.id);
        if (!vis) {
          const mk = (tex: THREE.Texture, op: number) =>
            new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: tex,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                opacity: op,
              })
            );
          const core = mk(coreTex, 1);
          const glow = mk(glowTex, 0.8);
          const halo = mk(haloTex, 0.18);
          scene.add(halo, glow, core);

          // The hyphal mat radiating from this thought. Jerky speech (high
          // input acceleration) sprays rougher, more irregular tendrils.
          const seed = hashStr(node.id);
          const hyGeom = generateHyphae(seed, {
            roots: 6 + Math.floor(Math.min(6, node.mass)),
            baseLength: 22 + node.mass * 4,
            spread: 1 + Math.min(1.4, (node.inputAcceleration ?? 0) * 1.6),
          });
          const hyphae = new THREE.LineSegments(
            hyGeom,
            new THREE.LineBasicMaterial({
              vertexColors: true,
              transparent: true,
              opacity: 0.5,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            })
          );
          hyphae.frustumCulled = false;
          scene.add(hyphae);

          let sketch: THREE.Line | undefined;
          if (node.contentType === "sketch" && node.sketchPath) {
            const sl = buildSketchLine(node.sketchPath);
            if (sl) {
              sketch = sl;
              scene.add(sketch);
            }
          }

          const r = (seed % 1000) / 1000;
          vis = {
            core,
            glow,
            halo,
            hyphae,
            sketch,
            spin: 0.00004 + r * 0.00008,
            axis: new THREE.Vector3(r - 0.5, 0.5 - r, 0.3).normalize(),
          };
          nodeVis.set(node.id, vis);

          const el = document.createElement("div");
          el.className = "node-label";
          labelLayerRef.current?.appendChild(el);
          labelEls.set(node.id, el);
        }

        const cryst = node.crystallizing ?? 1;
        const baseSize = 5.5 + Math.sqrt(node.mass) * 3.0 + node.returnCount * 1.1;
        const breath = 1 + Math.sin(now * 0.0011 + hashStr(node.id)) * 0.06;
        const lum = node.luminosity * cryst;
        const [px, py, pz] = node.position;

        // Transient bursts: touch-bloom propagation + star-birth on attention.
        const bl = bloomBurst.get(node.id);
        const bb = birthBurst.get(node.id);
        const bloomAmt = bl ? Math.max(0, 1 - (now - bl.start) / 1500) * bl.amt : 0;
        const birthAmt = bb ? Math.max(0, 1 - (now - bb.start) / 1500) * bb.amt : 0;
        const burst = bloomAmt + birthAmt;

        // 18.1 — the only colour decision in the field: how vital vs. structural
        // this fragment is right now. Born almost pure vital light, it cools to
        // structural as the moment passes; touch and attention re-ignite it.
        const vitality = Math.min(1, fragmentVitality(node, nowMs) + burst * 0.6);
        let color = fragmentColor(vitality);
        if (node.inDraft) color = color.clone().lerp(WARM_GOLD, 0.15);
        if (node.branchHue != null) {
          const hue = BRANCH_HUES[node.branchHue % BRANCH_HUES.length];
          color = color.clone().lerp(new THREE.Color().setHSL(hue, 0.45, 0.62), 0.22);
        }

        const focusDim = isFocusDimmed(node.id) ? 0.05 : 1;
        const renderLum = lum * focusDim;
        const emph = reflection && reflection.emphasize.has(node.id) ? 1 : 0;
        // Zoom-out dims individual detail; murmuration silhouettes take over.
        const detail = (1 - lod * 0.45) * (1 - murVis * 0.78);
        const nebula = lod * (0.06 + Math.min(0.5, node.mass) * 0.16) * (1 - murVis * 0.82);

        // Core — bright, HDR, blooms hard
        vis.core.position.set(px, py, pz);
        vis.core.scale.setScalar(baseSize * 0.9 * (0.5 + cryst * 0.5) * breath * (1 + burst * 0.7));
        const cMat = vis.core.material as THREE.SpriteMaterial;
        cMat.color.copy(color).multiplyScalar(1.5 + renderLum * 1.4 + burst * 1.6 + emph * 1.2);
        cMat.opacity = Math.min(1, 0.4 + renderLum * 0.6 + burst * 0.5 + emph * 0.3) * cryst * detail;

        // Glow — the soft body
        vis.glow.position.set(px, py, pz);
        vis.glow.scale.setScalar(baseSize * 2.4 * breath * (1 + burst * 0.5));
        const gMat = vis.glow.material as THREE.SpriteMaterial;
        gMat.color.copy(color);
        gMat.opacity = (0.12 + renderLum * 0.4 + burst * 0.3 + emph * 0.2) * cryst;

        // 18.3 — cell-body effect for hub fragments (structural light, tighter).
        const isHub = (hubDegree.get(node.id) ?? 0) >= HUB_DEGREE_THRESHOLD;
        if (isHub) {
          if (!vis.hubCore) {
            vis.hubCore = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: coreTex,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                opacity: 1,
              })
            );
            scene.add(vis.hubCore);
          }
          vis.hubCore.position.set(px, py, pz);
          const glowR = baseSize * 2.4 * breath;
          vis.hubCore.scale.setScalar(glowR * 0.5);
          const hubMat = vis.hubCore.material as THREE.SpriteMaterial;
          hubMat.color.copy(STRUCTURAL_LIGHT).multiplyScalar(2.0 + renderLum * 0.7);
          hubMat.opacity = (0.38 + renderLum * 0.42) * cryst * detail;
          vis.hubCore.visible = true;
        } else if (vis.hubCore) {
          vis.hubCore.visible = false;
        }

        // Halo — atmospheric aura, becomes a luminous nebula region zoomed out
        vis.halo.position.set(px, py, pz);
        vis.halo.scale.setScalar(baseSize * 6.5 * breath * (1 + lod * 3.4));
        const hMat = vis.halo.material as THREE.SpriteMaterial;
        hMat.color.copy(color);
        hMat.opacity = (0.04 + renderLum * 0.12 + burst * 0.12) * cryst + nebula + emph * 0.18;

        // Hyphae — drifting, breathing tendrils
        vis.hyphae.position.set(px, py, pz);
        vis.hyphae.quaternion.setFromAxisAngle(vis.axis, now * vis.spin);
        const hyScale = (0.4 + cryst * 0.6) * (0.85 + node.mass * 0.05);
        vis.hyphae.scale.setScalar(hyScale);
        const hyMat = vis.hyphae.material as THREE.LineBasicMaterial;
        hyMat.color.copy(color).multiplyScalar(0.7 + renderLum * 0.5);
        hyMat.opacity = (0.18 + renderLum * 0.42) * cryst * detail;

        // Sketch stroke (drawn fragments) rides with its fragment.
        if (vis.sketch) {
          vis.sketch.position.set(px, py, pz);
          const sMat = vis.sketch.material as THREE.LineBasicMaterial;
          sMat.color.copy(color).multiplyScalar(0.8 + renderLum * 0.6);
          sMat.opacity = (0.2 + renderLum * 0.6) * cryst * detail;
        }

        // Label overlay — only legible thoughts show text, and text fades out
        // as you zoom out (data unchanged; only render-state changes).
        const el = labelEls.get(node.id)!;
        const textVisible = renderLum > 0.34 && cryst > 0.6 && lod < 0.85;
        if (textVisible) {
          tmpA.set(px, py, pz).project(camera);
          const sx = (tmpA.x * 0.5 + 0.5) * window.innerWidth;
          const sy = (-tmpA.y * 0.5 + 0.5) * window.innerHeight;
          el.textContent =
            node.rawText.length > 42 ? node.rawText.slice(0, 42) + "…" : node.rawText;
          el.style.transform = `translate(-50%, 0) translate(${sx}px, ${sy + baseSize + 8}px)`;
          el.style.opacity = String(Math.min(0.6, 0.14 + renderLum * 0.5) * (1 - lod));
          el.style.display = tmpA.z < 1 ? "block" : "none";
        } else {
          el.style.opacity = "0";
        }

        if (selectedIds.has(node.id)) {
          let selEl = selectionEls.get(node.id);
          const sp = projectNode(node);
          if (sp) {
            if (!selEl) {
              selEl = document.createElement("div");
              selEl.className = "selection-outline";
              selEl.style.cssText =
                "position:absolute;pointer-events:none;width:56px;height:56px;border-radius:50%;border:1px solid rgba(200,230,255,0.55);box-shadow:0 0 18px rgba(160,200,240,0.25);transform:translate(-50%,-50%);";
              labelLayerRef.current?.appendChild(selEl);
              selectionEls.set(node.id, selEl);
            }
            selEl.style.left = `${sp.x}px`;
            selEl.style.top = `${sp.y}px`;
            selEl.style.opacity = "1";
          }
        }
      }

      // Retire visuals for removed nodes.
      for (const [id, vis] of nodeVis) {
        if (!seen.has(id)) {
          scene.remove(vis.core, vis.glow, vis.halo, vis.hyphae);
          if (vis.hubCore) scene.remove(vis.hubCore);
          (vis.core.material as THREE.Material).dispose();
          (vis.glow.material as THREE.Material).dispose();
          (vis.halo.material as THREE.Material).dispose();
          if (vis.hubCore) (vis.hubCore.material as THREE.Material).dispose();
          vis.hyphae.geometry.dispose();
          (vis.hyphae.material as THREE.Material).dispose();
          if (vis.sketch) {
            scene.remove(vis.sketch);
            vis.sketch.geometry.dispose();
            (vis.sketch.material as THREE.Material).dispose();
          }
          nodeVis.delete(id);
          labelEls.get(id)?.remove();
          labelEls.delete(id);
        }
      }

      // ---- Connections as Lichtenberg figures (18.2) -------------------
      // Each connection is a catenary main channel, tapered end-to-end by
      // sqrt(mass), micro-branching more the more it has been traversed. It
      // renders in structural light at intensity = strength; only the pulse is
      // ever vital.
      const nodeById = new Map(nodes.map((n) => [n.id, n]));
      const seenF = new Set<string>();
      let pulseIdx = 0;

      for (const f of filamentsRef.current) {
        const a = nodeById.get(f.sourceId);
        const b = nodeById.get(f.targetId);
        if (!a || !b) continue;
        seenF.add(f.id);

        let tube = tubes.get(f.id);
        if (!tube) {
          tube = new LichtenbergFilament(hashStr(f.id), filamentColor());
          scene.add(tube.mesh);
          tubes.set(f.id, tube);
        }

        const g = Math.min(1, f.growth);
        tmpA.set(a.position[0], a.position[1], a.position[2]);
        // Endpoint B grows out from A as the connection forms.
        tmpB.set(
          a.position[0] + (b.position[0] - a.position[0]) * g,
          a.position[1] + (b.position[1] - a.position[1]) * g,
          a.position[2] + (b.position[2] - a.position[2]) * g
        );
        const energyAmp = energyRef.current === "turbulence" ? 16 : 9;
        const peak = f.peakStrength ?? f.strength;
        const { branchStrength, mainStrength } = connectionPruningVisuals(f.strength, peak);
        tube.update(
          tmpA,
          tmpB,
          a.mass,
          b.mass * g + a.mass * (1 - g),
          branchStrength,
          mainStrength,
          f.strength,
          now,
          energyAmp
        );

        // Structural light — main channel brightness follows pruning phase.
        const structural = filamentColor().multiplyScalar(
          0.35 + mainStrength * 1.25 + (f.isActive ? 0.2 : 0)
        );
        tube.setAppearance(structural, (0.1 + mainStrength * 0.6) * g * intraFade);
      }

      // 18.3 — conduction pulses: one-shot vital light per traversal.
      while (condPulses.length && now - condPulses[0].start > condPulses[0].duration + 220) {
        condPulses.shift();
      }
      for (const pulse of condPulses) {
        if (pulseIdx >= PULSE_COUNT) break;
        const f = filamentsRef.current.find((x) => x.id === pulse.filamentId);
        const tube = tubes.get(pulse.filamentId);
        if (!f || !tube || !seenF.has(f.id)) continue;
        const a = nodeById.get(f.sourceId);
        const b = nodeById.get(f.targetId);
        if (!a || !b) continue;

        const elapsed = now - pulse.start;
        if (elapsed > pulse.duration) continue;
        const progress = elapsed / pulse.duration;

        if (pulse.instant) {
          const flash = 1 - progress;
          for (const n of [a, b]) {
            if (pulseIdx >= PULSE_COUNT) break;
            const sp = pulses[pulseIdx++];
            sp.visible = true;
            sp.position.set(n.position[0], n.position[1], n.position[2]);
            const pMat = sp.material as THREE.SpriteMaterial;
            pMat.color.copy(vitalColor(1)).multiplyScalar(2.1);
            pMat.opacity = flash * 0.88;
            sp.scale.setScalar((3.2 + f.strength * 3.5) * flash);
          }
        } else {
          tube.sampleMain(progress, tmpC);
          const sp = pulses[pulseIdx++];
          sp.visible = true;
          sp.position.copy(tmpC);
          const fade = Math.sin(Math.PI * progress);
          const pMat = sp.material as THREE.SpriteMaterial;
          pMat.color.copy(vitalColor(fade)).multiplyScalar(1.7);
          pMat.opacity = fade * 0.92;
          sp.scale.setScalar((2.5 + f.strength * 3) * (0.5 + fade * 0.7));
        }
      }

      // Hide unused pulses.
      for (let i = pulseIdx; i < PULSE_COUNT; i++) {
        if (pulses[i].visible) pulses[i].visible = false;
      }

      // Retire tubes for removed filaments.
      for (const [id, tube] of tubes) {
        if (!seenF.has(id)) {
          scene.remove(tube.mesh);
          tube.dispose();
          tubes.delete(id);
        }
      }
    }

    // ---- Capture thread visual -----------------------------------------
    function updateThread(now: number) {
      const cap = captureRef.current;
      const capMat = captureTube.mesh.material as THREE.MeshBasicMaterial;
      const orb = screenToWorld(window.innerWidth / 2, window.innerHeight - 70);
      if (!cap.active && capMat.opacity <= 0.01) {
        capMat.opacity = 0;
        captureTube.mesh.visible = false;
        return;
      }
      captureTube.mesh.visible = true;
      const reach = cap.active ? Math.min(1, cap.progress) : 0;
      tmpA.copy(orb);
      tmpB.set(
        orb.x + (cap.target[0] - orb.x) * reach,
        orb.y + (cap.target[1] - orb.y) * reach,
        orb.z + (cap.target[2] - orb.z) * reach
      );
      captureTube.update(tmpA, tmpB, now, 1.6 + reach * 1.2, 14);
      const targetOpacity = cap.active ? 0.55 + reach * 0.3 : 0;
      capMat.opacity += (targetOpacity - capMat.opacity) * 0.1;
    }

    // ---- Main loop -----------------------------------------------------
    let raf = 0;
    let last = performance.now();
    function loop(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000) * 60;
      last = now;

      const cap = captureRef.current;
      if (cap.active && cap.progress < 1) cap.progress = Math.min(1, cap.progress + dt * 0.04);

      for (const node of nodesRef.current) {
        if (node.crystallizing !== undefined && node.crystallizing < 1) {
          // AI-surfaced fragments resolve more slowly and dimly; the implicit
          // question slowest of all. User thoughts: warm = faster.
          const speed =
            node.origin === "ai_implicit"
              ? 0.012
              : node.origin === "ai_expansion" || node.origin === "ai_disturb"
              ? 0.022
              : 0.03 + (node.colorTemp ?? 0.4) * 0.045;
          node.crystallizing = Math.min(1, node.crystallizing + dt * speed);
        }
      }

      // AI-origin fragments are genuinely ephemeral until attended: they decay
      // toward nothing and are removed, unlike user-originated content.
      let aiRemovals: string[] | null = null;
      for (const node of nodesRef.current) {
        if (
          (node.origin === "ai_expansion" || node.origin === "ai_disturb" || node.origin === "ai_branch") &&
          !node.branchGraduated &&
          (node.attentionCount ?? 1) <= 1
        ) {
          node.luminosity = Math.max(0, node.luminosity - 0.00045 * dt);
          if (node.luminosity < 0.02 && Date.now() - node.timestamp > 60000) {
            (aiRemovals ??= []).push(node.id);
          }
        }
      }
      if (aiRemovals) for (const id of aiRemovals) removeFragment(id);

      // Field breathing: in long silence the most-recently-attended fragments
      // settle toward one another and the substrate stirs a little more.
      const silence = (Date.now() - lastActivityRef.current) / 1000;
      let breathingIds: Set<string> | undefined;
      if (silence > 8 && nodesRef.current.length > 1) {
        const recent = [...nodesRef.current]
          .sort(
            (a, b) =>
              (b.lastAttendedAt ?? b.timestamp) - (a.lastAttendedAt ?? a.timestamp)
          )
          .slice(0, 5);
        breathingIds = new Set(recent.map((n) => n.id));
      }
      breathAmp += ((silence > 8 ? 2.4 : 1.0) - breathAmp) * 0.01;

      const stepped = stepPhysics(nodesRef.current, filamentsRef.current, energyRef.current, dt, {
        breathingIds,
        voidLifted,
      });
      for (let i = 0; i < stepped.length; i++) {
        nodesRef.current[i].position = stepped[i].position;
        nodesRef.current[i].velocity = stepped[i].velocity;
        nodesRef.current[i].luminosity = stepped[i].luminosity;
      }

      const adj = pendingAdjustRef.current;
      if (adj) {
        const p = (Date.now() - adj.startedAt) / adj.durationMs;
        applyAdjustment(nodesRef.current, filamentsRef.current, adj, p);
        if (p >= 1) pendingAdjustRef.current = null;
      }

      if (energyRef.current === "turbulence" && Date.now() - lastActivityRef.current > 2500) {
        energyRef.current = "drift";
      }

      // Drifting spores
      for (let i = 0; i < SPORE_COUNT; i++) {
        sporePos[i * 3] += sporeVel[i * 3] * dt;
        sporePos[i * 3 + 1] += sporeVel[i * 3 + 1] * dt;
        sporePos[i * 3 + 2] += sporeVel[i * 3 + 2] * dt;
        for (let a = 0; a < 3; a++) {
          const lim = a === 2 ? SPORE_R * 0.5 : SPORE_R;
          if (sporePos[i * 3 + a] > lim) sporePos[i * 3 + a] = -lim;
          else if (sporePos[i * 3 + a] < -lim) sporePos[i * 3 + a] = lim;
        }
      }
      sporeGeom.attributes.position.needsUpdate = true;

      // Subtle parallax — depth you can feel
      parallax.x += (parallax.tx - parallax.x) * 0.04;
      parallax.y += (parallax.ty - parallax.y) * 0.04;
      const z = camera.position.z;
      camera.position.x = parallax.x;
      camera.position.y = parallax.y;
      camera.position.z = z;
      camera.lookAt(0, 0, 0);

      // Part 7 density field — rebuilt continuously for trail + future heatmap.
      densityField.rebuild(nodesRef.current);

      // Cursor trail — brightness and linger scale with local fragment density.
      while (trail.length && now - trail[0].born > TRAIL_LIFE * 1.35) trail.shift();
      for (let i = 0; i < TRAIL_MAX; i++) {
        const s = trailSprites[i];
        const pt = trail[trail.length - 1 - i];
        if (!pt) {
          if (s.visible) s.visible = false;
          continue;
        }
        const density = densityField.sample(pt.pos.x, pt.pos.y);
        const linger = 1 + (density - 0.08) * 0.85;
        const age = (now - pt.born) / (TRAIL_LIFE * linger);
        const k = Math.max(0, 1 - age);
        const dScale = 0.32 + density * 0.88;
        s.visible = true;
        s.position.copy(pt.pos);
        s.scale.setScalar((5 + k * 14) * (0.5 + dScale * 0.75));
        const tMat = s.material as THREE.SpriteMaterial;
        tMat.color.copy(vitalColor(0.25 + density * 0.55));
        tMat.opacity = k * k * 0.34 * dScale;
      }

      // Settling residuals — bay calming down after bloom propagation.
      for (let i = pendingSettles.length - 1; i >= 0; i--) {
        const pending = pendingSettles[i];
        if (now - pending.startedAt >= BLOOM_DURATION) {
          for (const pt of pending.points) {
            settlingResiduals.push({
              pos: pt.clone(),
              born: now,
              life: SETTLE_LIFE_MIN + Math.random() * (SETTLE_LIFE_MAX - SETTLE_LIFE_MIN),
              peak: SETTLE_MAX_OPACITY * (0.55 + Math.random() * 0.45),
            });
          }
          pendingSettles.splice(i, 1);
        }
      }
      while (
        settlingResiduals.length > SETTLE_POOL * 2 &&
        settlingResiduals[0].born + settlingResiduals[0].life < now
      ) {
        settlingResiduals.shift();
      }
      for (let i = settlingResiduals.length - 1; i >= 0; i--) {
        if (now - settlingResiduals[i].born > settlingResiduals[i].life) {
          settlingResiduals.splice(i, 1);
        }
      }
      for (let i = 0; i < SETTLE_POOL; i++) {
        const s = settleSprites[i];
        const r = settlingResiduals[settlingResiduals.length - 1 - i];
        if (!r) {
          if (s.visible) s.visible = false;
          continue;
        }
        const age = (now - r.born) / r.life;
        const k = Math.max(0, 1 - age);
        s.visible = true;
        s.position.copy(r.pos);
        s.scale.setScalar(10 + k * 8);
        const sMat = s.material as THREE.SpriteMaterial;
        sMat.color.copy(vitalColor(0.5 + k * 0.2));
        sMat.opacity = r.peak * k * k;
      }

      if (negDirty) {
        rebuildNegative();
        negDirty = false;
      }

      checkAutoMerge(now);

      // Live sketch stroke while drawing.
      if (sketching && sketchPts.length > 1) {
        const pos = sketchLiveGeom.attributes.position as THREE.BufferAttribute;
        const n = Math.min(sketchPts.length, 600);
        for (let i = 0; i < n; i++) pos.setXYZ(i, sketchPts[i].x, sketchPts[i].y, sketchPts[i].z);
        sketchLiveGeom.setDrawRange(0, n);
        pos.needsUpdate = true;
        sketchLive.visible = true;
      } else if (sketchLive.visible) {
        sketchLive.visible = false;
      }

      // Zoom = level of thought. Continuous LOD: 0 at/zoomed-in, 1 far out.
      const lod = THREE.MathUtils.clamp((camera.position.z - 420) / (1200 - 420), 0, 1);

      // Reflection mode — huge faint constellation labels over clusters.
      if (reflection && now < reflection.until) {
        for (let i = 0; i < reflection.labels.length && i < reflectEls.length + 4; i++) {
          let el = reflectEls[i];
          if (!el) {
            el = document.createElement("div");
            el.className = "reflect-label";
            el.style.cssText =
              "position:absolute;left:0;top:0;transform-origin:center;color:rgba(170,195,225,0.10);font-weight:300;letter-spacing:0.1em;pointer-events:none;white-space:nowrap;";
            labelLayerRef.current?.appendChild(el);
            reflectEls[i] = el;
          }
          const lab = reflection.labels[i];
          let cx = 0;
          let cy = 0;
          let c = 0;
          for (const id of lab.ids) {
            const nn = nodesRef.current.find((x) => x.id === id);
            if (nn) {
              cx += nn.position[0];
              cy += nn.position[1];
              c++;
            }
          }
          if (c === 0) {
            el.style.opacity = "0";
            continue;
          }
          tmpA.set(cx / c, cy / c, 0).project(camera);
          const sx = (tmpA.x * 0.5 + 0.5) * window.innerWidth;
          const sy = (-tmpA.y * 0.5 + 0.5) * window.innerHeight;
          el.textContent = lab.label;
          el.style.fontSize = `${Math.round(40 + lod * 80)}px`;
          el.style.transform = `translate(-50%,-50%) translate(${sx}px, ${sy}px)`;
          const fade = Math.min(1, (reflection.until - now) / 1500);
          el.style.opacity = String(0.1 * fade * (0.4 + lod * 0.6));
          el.style.display = tmpA.z < 1 ? "block" : "none";
        }
      } else {
        if (reflection) reflection = null;
        for (const el of reflectEls) el.style.opacity = "0";
      }

      voidGlow.material.opacity = (0.18 + Math.sin(now * 0.0006) * 0.06) * (1 - lod * 0.7);
      skyMat.uniforms.uTime.value = now;
      skyMat.uniforms.uNoiseAmp.value = breathAmp;
      updateThread(now);
      syncCosmos(now, lod);
      syncMurmuration(now, lod, dt);
      syncScene(now, lod);
      fieldFx.render();
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    // ---- Interaction ---------------------------------------------------
    let dragId: string | null = null;
    let downPos = { x: 0, y: 0 };
    let downAt = 0;
    let moved = false;

    function nearestNode(clientX: number, clientY: number, pxRadius = 40): ThoughtNode | null {
      let best: ThoughtNode | null = null;
      let bestD = pxRadius;
      for (const n of nodesRef.current) {
        const v = new THREE.Vector3(...n.position).project(camera);
        const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
        const d = Math.hypot(sx - clientX, sy - clientY);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    }

    // Drag-to-connect bookkeeping.
    let connectCand: { id: string; since: number } | null = null;
    const residualStrength = new Map<string, number>();
    const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

    function onPointerDown(e: PointerEvent) {
      const n = nearestNode(e.clientX, e.clientY);
      downPos = { x: e.clientX, y: e.clientY };
      downAt = performance.now();
      moved = false;
      connectCand = null;

      if (creatingTool) return;

      // Alt+drag = lasso selection; Ctrl/Meta+drag = trace thread (Part 17.2).
      if (!n && !e.shiftKey) {
        if (e.altKey) {
          lassoing = true;
          lassoPts = [[e.clientX, e.clientY]];
          dragId = null;
          return;
        }
        if (e.ctrlKey || e.metaKey) {
          tracing = true;
          traceScreenPts = [{ x: e.clientX, y: e.clientY }];
          dragId = null;
          return;
        }
      }

      // Hold Shift and drag over empty field to sketch a stroke fragment.
      if (e.shiftKey && !n) {
        sketching = true;
        sketchPts = [screenToWorld(e.clientX, e.clientY)];
        dragId = null;
        clearSelection();
        return;
      }

      if (!n) {
        const tid = threadIdNearScreen(e.clientX, e.clientY);
        if (tid) {
          clearTimeout(threadLegibilityTimer);
          threadLegibilityTimer = setTimeout(() => legibilityForThread(tid), 850);
        }
        clearSelection();
        dragId = null;
        return;
      }

      dragId = n.id;
      if (n) propagateBloom(n.id, 1.0, 0);
    }

    function onPointerMove(e: PointerEvent) {
      clearTimeout(threadLegibilityTimer);
      // gentle parallax follows the pointer
      parallax.tx = ((e.clientX / window.innerWidth) * 2 - 1) * 14;
      parallax.ty = -((e.clientY / window.innerHeight) * 2 - 1) * 10;

      // Bioluminescent trail follows the cursor everywhere it goes.
      const wp = screenToWorld(e.clientX, e.clientY);
      trail.push({ pos: wp.clone(), born: performance.now() });
      if (trail.length > TRAIL_MAX * 2) trail.shift();

      if (sketching) {
        sketchPts.push(wp.clone());
        if (sketchPts.length > 600) sketchPts.shift();
        lastActivityRef.current = Date.now();
        return;
      }

      if (lassoing) {
        lassoPts.push([e.clientX, e.clientY]);
        if (lassoPts.length > 400) lassoPts.shift();
        return;
      }

      if (tracing) {
        traceScreenPts.push({ x: e.clientX, y: e.clientY });
        if (traceScreenPts.length > 500) traceScreenPts.shift();
        return;
      }

      if (!dragId) return;
      if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) moved = true;
      if (!moved) return;
      const node = nodesRef.current.find((x) => x.id === dragId);
      if (!node) return;
      // Drag resistance — heavier (more-attended) thoughts are harder to move.
      const follow = THREE.MathUtils.clamp(1 / (1 + node.mass * 0.6), 0.16, 1);
      node.position = [
        node.position[0] + (wp.x - node.position[0]) * follow,
        node.position[1] + (wp.y - node.position[1]) * follow,
        node.position[2],
      ];
      node.velocity = [0, 0, 0];
      energyRef.current = "turbulence";
      lastActivityRef.current = Date.now();
      updateDragRelations(node, performance.now());
    }

    function connects(f: FilamentEdge, a: string, b: string) {
      return (
        (f.sourceId === a && f.targetId === b) ||
        (f.sourceId === b && f.targetId === a)
      );
    }

    // Holding one fragment near another forms a connection; pulling connected
    // fragments apart thins and eventually severs the thread (which can reform
    // with residual strength — the field routes around death).
    function updateDragRelations(node: ThoughtNode, now: number) {
      for (const f of filamentsRef.current) {
        const otherId =
          f.sourceId === node.id ? f.targetId : f.targetId === node.id ? f.sourceId : null;
        if (!otherId) continue;
        const o = nodesRef.current.find((n) => n.id === otherId);
        if (!o) continue;
        const d = Math.hypot(o.position[0] - node.position[0], o.position[1] - node.position[1]);
        if (d > 320) {
          f.strength = Math.max(0, f.strength - 0.012);
          f.isActive = f.strength > 0.05;
          if (f.strength <= 0.02) {
            residualStrength.set(
              pairKey(f.sourceId, f.targetId),
              Math.min(0.5, (residualStrength.get(pairKey(f.sourceId, f.targetId)) ?? 0) + 0.12)
            );
            filamentsRef.current = filamentsRef.current.filter((x) => x.id !== f.id);
            scheduleGuestSave();
          }
        } else if (d < 130) {
          maybeTraverseOnDrag(f, now);
        }
      }

      let near: ThoughtNode | null = null;
      let nearD = Infinity;
      for (const o of nodesRef.current) {
        if (o.id === node.id) continue;
        const d = Math.hypot(o.position[0] - node.position[0], o.position[1] - node.position[1]);
        if (d < nearD) {
          nearD = d;
          near = o;
        }
      }
      if (near && nearD < 72 && nearD > 16) {
        if (filamentsRef.current.some((f) => connects(f, node.id, near!.id))) {
          connectCand = null;
          return;
        }
        if (!connectCand || connectCand.id !== near.id) {
          connectCand = { id: near.id, since: now };
        } else if (now - connectCand.since > 600) {
          connectNodes(node, near, residualStrength.get(pairKey(node.id, near.id)) ?? 0);
          connectCand = null;
        }
      } else {
        connectCand = null;
      }
    }

    function connectNodes(a: ThoughtNode, b: ThoughtNode, residual: number) {
      const e = edge(a.id, b.id, Math.min(0.6, 0.2 + residual), "resonance");
      filamentsRef.current.push(e);
      fireCondPulse(e);
      propagateBloom(a.id, 0.7, 0);
      propagateBloom(b.id, 0.7, 0);
      bumpAttention(a, 0.05);
      bumpAttention(b, 0.05);
      energyRef.current = "turbulence";
      lastActivityRef.current = Date.now();
      scheduleGuestSave();
      emitFieldEvent("drag-connect");
    }

    function onPointerUp(e: PointerEvent) {
      clearTimeout(threadLegibilityTimer);
      if (lassoing) {
        lassoing = false;
        if (lassoPts.length > 8) {
          const ids = nodesInLasso(lassoPts, nodesRef.current, (x, y, z) => {
            tmpA.set(x, y, z).project(camera);
            if (tmpA.z > 1) return null;
            return {
              x: (tmpA.x * 0.5 + 0.5) * window.innerWidth,
              y: (-tmpA.y * 0.5 + 0.5) * window.innerHeight,
            };
          });
          setSelection(ids);
        }
        lassoPts = [];
        dragId = null;
        return;
      }

      if (tracing) {
        tracing = false;
        const ids = traceNearPath(traceScreenPts, nodesRef.current, (x, y, z) => {
          tmpA.set(x, y, z).project(camera);
          if (tmpA.z > 1) return null;
          return {
            x: (tmpA.x * 0.5 + 0.5) * window.innerWidth,
            y: (-tmpA.y * 0.5 + 0.5) * window.innerHeight,
          };
        });
        traceScreenPts = [];
        if (ids.length > 0) void completeTrace(ids);
        dragId = null;
        return;
      }

      if (sketching) {
        finalizeSketch();
        sketching = false;
        sketchPts = [];
        dragId = null;
        dismissWorkbench();
        return;
      }
      const node = dragId ? nodesRef.current.find((x) => x.id === dragId) : null;
      if (node && moved) {
        const other = nodesRef.current.find(
          (o) =>
            o.id !== node.id &&
            Math.hypot(
              o.position[0] - node.position[0],
              o.position[1] - node.position[1]
            ) < 14
        );
        if (other) {
          fuse(node, other);
        } else {
          patchPosition(node);
        }
      } else if (node && !moved && performance.now() - downAt < 350) {
        if (selectedIds.has(node.id) && selectedIds.size === 1) {
          selectedIds.delete(node.id);
          updateSelectionOutlines();
          dismissWorkbench();
        } else {
          toggleSelect(node.id);
        }
      }
      dragId = null;
    }

    function onDblClick(e: MouseEvent) {
      const n = nearestNode(e.clientX, e.clientY, 44);
      if (!n) {
        branchFocusId = null;
        return;
      }
      if (n.origin === "ai_branch" || filamentsRef.current.some((f) => f.type === "branch" && (f.sourceId === n.id || f.targetId === n.id))) {
        branchFocusId = n.origin === "ai_branch" ? n.id : n.id;
        const branchNode =
          n.origin === "ai_branch"
            ? n
            : filamentsRef.current.find((f) => f.type === "branch" && (f.sourceId === n.id || f.targetId === n.id))
            ? nodesRef.current.find(
                (x) =>
                  x.origin === "ai_branch" &&
                  filamentsRef.current.some(
                    (f) => f.type === "branch" && f.sourceId === n.id && f.targetId === x.id
                  )
              ) ?? n
            : n;
        branchFocusId = branchNode.id;
        emitFieldEvent("branch-focus", { id: branchFocusId });
        return;
      }
      registerReturn(n);
      setExpanded(n);
      emitFieldEvent("fragment-expand", { id: n.id });
    }

    let zoomEmitted = false;
    let cosmosEmitted = false;
    let murmurationEmitted = false;
    function fieldLod(): number {
      return THREE.MathUtils.clamp((camera.position.z - 420) / (1200 - 420), 0, 1);
    }
    function onWheel(e: WheelEvent) {
      camera.position.z = THREE.MathUtils.clamp(
        camera.position.z + e.deltaY * 0.5,
        120,
        1800
      );
      const lod = fieldLod();
      if (camera.position.z > 900 && !zoomEmitted) {
        zoomEmitted = true;
        emitFieldEvent("zoom-out");
      }
      if (lod > 0.55 && !cosmosEmitted) {
        cosmosEmitted = true;
        emitFieldEvent("cosmos-visible");
      }
      if (camera.position.z < 700) zoomEmitted = false;
      if (lod < 0.45) cosmosEmitted = false;
    }

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("dblclick", onDblClick);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: true });

    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      fieldFx.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener("resize", onResize);

    // ---- Guest persistence (on-device, no account) ---------------------
    const GUEST_KEY = "ct-guest-field-v1";
    let guestSaveTimer: ReturnType<typeof setTimeout> | undefined;

    function readGuest(): {
      nodes?: ThoughtNode[];
      filaments?: FilamentEdge[];
      negative?: NegativeMark[];
    } | null {
      try {
        const raw = localStorage.getItem(GUEST_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    }

    function loadGuest() {
      const g = readGuest();
      if (g && Array.isArray(g.nodes)) {
        nodesRef.current = g.nodes.map((n) => ({ ...n, crystallizing: 1 }));
        filamentsRef.current = (g.filaments || []).map((f) => normalizeFilament(f));
      }
      if (g && Array.isArray(g.negative)) {
        negativeMarks.push(...g.negative);
        negDirty = true;
      }
    }

    function clearGuest() {
      try {
        localStorage.removeItem(GUEST_KEY);
      } catch {
        /* ignore */
      }
    }

    function scheduleGuestSave() {
      if (authedRef.current) return;
      clearTimeout(guestSaveTimer);
      guestSaveTimer = setTimeout(() => {
        try {
          localStorage.setItem(
            GUEST_KEY,
            JSON.stringify({
              nodes: nodesRef.current,
              filaments: filamentsRef.current,
              negative: negativeMarks,
            })
          );
        } catch {
          /* storage full / unavailable — field still lives in memory */
        }
      }, 600);
    }

    // ---- Behaviors -----------------------------------------------------
    function patchPosition(node: ThoughtNode) {
      if (!authedRef.current) {
        scheduleGuestSave();
        return;
      }
      fetch(`/api/thoughts/${node.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: node.position }),
      }).catch(() => {});
    }

    function registerReturn(node: ThoughtNode) {
      const before = node.luminosity;
      node.returnCount += 1;
      node.mass = Math.min(2.2, node.mass + 0.4);
      node.luminosity = Math.min(1, node.luminosity + 0.2);
      node.attentionCount = (node.attentionCount ?? 1) + 1;
      node.lastAttendedAt = Date.now();
      adoptIfAi(node);
      if (before < 0.6 && node.luminosity >= 0.6) {
        birthBurst.set(node.id, { amt: 1.0, start: performance.now() });
      }
      energyRef.current = "turbulence";
      lastActivityRef.current = Date.now();
      for (const f of filamentsRef.current) {
        if (f.sourceId === node.id || f.targetId === node.id) {
          fireCondPulse(f);
        }
      }
      if (!authedRef.current) {
        scheduleGuestSave();
        return;
      }
      fetch(`/api/thoughts/${node.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incrementReturn: true }),
      }).catch(() => {});
    }

    // An attended AI-surfaced fragment becomes a permanent part of the field;
    // attending the implicit question lifts the center-void for the session.
    function adoptIfAi(node: ThoughtNode) {
      if (!node.origin || node.origin === "user") return;
      if (node.origin === "ai_implicit") voidLifted = true;
      else node.noDecay = false;
      if (node.origin === "ai_branch") {
        node.branchGraduated = true;
        node.branchPendingGerm = false;
      }
    }

    // Attention raises confidence (opacity) and a little mass; crossing the
    // legibility threshold sparks a star-birth glow. Returns can come from a
    // direct touch, a nearby new thought, or a freshly woven connection.
    function bumpAttention(node: ThoughtNode, amount: number) {
      const before = node.luminosity;
      node.luminosity = Math.min(1, node.luminosity + amount);
      node.mass = Math.min(2, node.mass + 0.03);
      node.attentionCount = (node.attentionCount ?? 1) + 1;
      node.lastAttendedAt = Date.now();
      adoptIfAi(node);
      if (before < 0.6 && node.luminosity >= 0.6) {
        birthBurst.set(node.id, { amt: 0.9, start: performance.now() });
      }
      if (authedRef.current) {
        fetch(`/api/thoughts/${node.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attention: { opacity: node.luminosity, mass: node.mass } }),
        }).catch(() => {});
      } else {
        scheduleGuestSave();
      }
    }

    function attentionNear(node: ThoughtNode) {
      for (const o of nodesRef.current) {
        if (o.id === node.id) continue;
        const d = Math.hypot(
          o.position[0] - node.position[0],
          o.position[1] - node.position[1],
          o.position[2] - node.position[2]
        );
        if (d < 120) bumpAttention(o, 0.06);
      }
    }

    // Bloom rides outward along connections, halving at each hop. After the
    // main pulse (~1.5s), faint settling residuals remain at each hop.
    function propagateBloom(
      id: string,
      amount: number,
      hop: number,
      wave?: { visited: Set<string>; points: THREE.Vector3[] }
    ) {
      if (amount < 0.05 || hop > 4) return;

      const ctx = wave ?? { visited: new Set<string>(), points: [] };
      const isRoot = hop === 0 && !wave;

      const prev = bloomBurst.get(id);
      bloomBurst.set(id, {
        amt: Math.max(prev?.amt ?? 0, amount),
        start: performance.now(),
      });
      if (!ctx.visited.has(id)) {
        ctx.visited.add(id);
        const node = nodesRef.current.find((n) => n.id === id);
        if (node) ctx.points.push(new THREE.Vector3(...node.position));
      }
      for (const f of filamentsRef.current) {
        const nb = f.sourceId === id ? f.targetId : f.targetId === id ? f.sourceId : null;
        if (nb) propagateBloom(nb, amount * 0.5, hop + 1, ctx);
      }
      if (isRoot && ctx.points.length > 0) {
        pendingSettles.push({ startedAt: performance.now(), points: [...ctx.points] });
      }
    }

    // A thought approached and then let go leaves a faint trace at the rim.
    function recordNegative(content: string) {
      emitFieldEvent("negative-space", { length: content.length });
      const tgt = captureRef.current.target;
      negativeMarks.push({ x: tgt[0], y: tgt[1], content: content.slice(0, 80) });
      if (negativeMarks.length > 200) negativeMarks.shift();
      negDirty = true;
      if (authedRef.current) {
        fetch("/api/negative-space", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            posX: tgt[0],
            posY: tgt[1],
            partialContent: content.slice(0, 80),
            sessionId: sessionIdRef.current,
          }),
        }).catch(() => {});
      } else {
        scheduleGuestSave();
      }
    }

    function fuse(a: ThoughtNode, b: ThoughtNode) {
      const id = uuid();
      const mid: [number, number, number] = [
        (a.position[0] + b.position[0]) / 2,
        (a.position[1] + b.position[1]) / 2,
        (a.position[2] + b.position[2]) / 2,
      ];
      const node: ThoughtNode = {
        id,
        rawText: `${a.rawText}  ⟡  ${b.rawText}`,
        timestamp: Date.now(),
        returnCount: 0,
        position: mid,
        velocity: [0, 0, 0],
        mass: Math.min(3, a.mass + b.mass),
        luminosity: Math.min(1, Math.max(a.luminosity, b.luminosity) + 0.15),
        texture: "smooth",
        state: "spore",
        charge: (a.charge + b.charge) / 2,
        isSynthesis: true,
        sourceThoughtIds: [a.id, b.id],
        crystallizing: 0,
        colorTemp:
          a.colorTemp != null || b.colorTemp != null
            ? ((a.colorTemp ?? 0.4) + (b.colorTemp ?? 0.4)) / 2
            : undefined,
        attentionCount: 1,
        lastAttendedAt: Date.now(),
      };
      // Originals are not deleted — they dim beneath the synthesis (palimpsest).
      a.luminosity = Math.max(0.12, a.luminosity * 0.5);
      b.luminosity = Math.max(0.12, b.luminosity * 0.5);
      nodesRef.current.push(node);
      filamentsRef.current.push(
        edge(a.id, id, 0.6, "resonance"),
        edge(b.id, id, 0.6, "resonance")
      );
      birthBurst.set(id, { amt: 1.0, start: performance.now() });
      energyRef.current = "turbulence";
      lastActivityRef.current = Date.now();
      persistThought(node);
      emitFieldEvent("merge", { aId: a.id, bId: b.id, synthesisId: id });
    }

    // Auto-merge: when two strongly connected fragments drift into contact,
    // they fuse on their own. Guarded so it fires at most once per frame.
    let lastAutoMerge = 0;
    function checkAutoMerge(now: number) {
      if (now - lastAutoMerge < 1200) return;
      for (const f of filamentsRef.current) {
        if (f.strength <= 0.5 || f.growth < 0.9) continue;
        const a = nodesRef.current.find((n) => n.id === f.sourceId);
        const b = nodesRef.current.find((n) => n.id === f.targetId);
        if (!a || !b || a.isSynthesis || b.isSynthesis) continue;
        const d = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]);
        if (d < 12) {
          lastAutoMerge = now;
          fuse(a, b);
          return;
        }
      }
    }

    // ---- Capture orchestration ----------------------------------------
    function beginCapture() {
      dismissWorkbench();
      clearSelection();
      const cap = captureRef.current;
      cap.active = true;
      cap.progress = 0.05;
      cap.text = "";
      cap.target = computeSemanticPosition(nodesRef.current);
      energyRef.current = "turbulence";
      lastActivityRef.current = Date.now();
    }

    function onPartialText(text: string) {
      const cap = captureRef.current;
      cap.text = text;
      cap.progress = Math.min(0.95, 0.1 + text.length * 0.01);
      lastActivityRef.current = Date.now();
      setPartial(text);
    }

    function crystallize(text: string, prosody?: Prosody) {
      const cap = captureRef.current;
      const trimmed = text.trim();
      cap.active = false;
      cap.progress = 0;
      setPartial("");
      if (!trimmed) {
        // Approached, then released — a presence at the periphery.
        if (cap.text.trim()) recordNegative(cap.text);
        cap.text = "";
        return;
      }

      const texture: ThoughtNode["texture"] = prosody
        ? prosody.trailingOff
          ? "very_rough"
          : prosody.pace > 3
          ? "rough"
          : "smooth"
        : "smooth";

      // How a thought was spoken becomes how it looks. Fast + even speech runs
      // warm and materializes quickly; slow + jerky speech runs cool and rough.
      let inputVelocity: number | undefined;
      let inputAcceleration: number | undefined;
      let colorTemp: number | undefined;
      if (prosody) {
        inputVelocity = prosody.pace;
        let jerk = 0;
        const ps = prosody.pauses;
        if (ps.length > 1) {
          const mean = ps.reduce((a, b) => a + b, 0) / ps.length;
          const variance = ps.reduce((a, b) => a + (b - mean) * (b - mean), 0) / ps.length;
          jerk = Math.min(1, Math.sqrt(variance) / 600);
        }
        inputAcceleration = Math.min(1, jerk + (prosody.trailingOff ? 0.3 : 0));
        const warmth = Math.max(0, Math.min(1, (prosody.pace - 1.5) / 3));
        colorTemp = Math.max(0, Math.min(1, warmth * (1 - 0.6 * inputAcceleration)));
      }

      // Subliminal palimpsest pull: landing on a dense ghost-region of a past
      // session gives the new thought a hair more mass — "starting from texture".
      let massBoost = 0;
      for (const p of palimpsest) {
        if (p.mass > 0.6 && Math.hypot(p.x - cap.target[0], p.y - cap.target[1]) < 60) {
          massBoost = 0.02;
          break;
        }
      }

      const node: ThoughtNode = {
        id: uuid(),
        rawText: trimmed,
        prosody,
        timestamp: Date.now(),
        returnCount: 0,
        position: cap.target,
        velocity: [0, 0, 0],
        mass: 1 + massBoost,
        luminosity: 0.4, // born uncertain — confidence is earned through attention
        texture,
        state: "spore",
        charge: 0,
        isSynthesis: false,
        crystallizing: 0,
        colorTemp,
        inputVelocity,
        inputAcceleration,
        attentionCount: 1,
        lastAttendedAt: Date.now(),
      };
      nodesRef.current.push(node);
      unprocessedRef.current.add(node.id);
      lastActivityRef.current = Date.now();
      cap.text = "";
      // A new thought lands near kin — their presence stirs and brightens.
      attentionNear(node);
      persistThought(node);
      emitFieldEvent("crystallize", { id: node.id });
    }

    function persistThought(node: ThoughtNode) {
      if (!authedRef.current) {
        scheduleGuestSave();
        return;
      }
      fetch("/api/thoughts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: node.id,
          rawText: node.rawText,
          prosody: node.prosody,
          position: node.position,
          texture: node.texture,
          isSynthesis: node.isSynthesis,
          sourceThoughtIds: node.sourceThoughtIds,
          colorTemp: node.colorTemp,
          inputVelocity: node.inputVelocity,
          inputAcceleration: node.inputAcceleration,
          opacity: node.luminosity,
          origin: node.origin,
          parentFragmentId: node.parentFragmentId,
          contentType: node.contentType,
          sketchPath: node.sketchPath,
          sessionId: sessionIdRef.current,
        }),
      }).catch(() => {});
    }

    function edge(
      sourceId: string,
      targetId: string,
      strength: number,
      type: FilamentEdge["type"]
    ): FilamentEdge {
      return normalizeFilament({
        id: uuid(),
        sourceId,
        targetId,
        strength,
        type,
        ageSessions: 0,
        isActive: true,
        traffic: 1,
        growth: 0,
        conductionSpeed: DEFAULT_CONDUCTION_SPEED,
        peakStrength: strength,
      });
    }

    // For guests there is no Claude — kinship is inferred locally from
    // spatial proximity so the playground field still weaves itself together.
    function localLink(id: string) {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node) return;
      node.state = "hypha";
      const others = nodesRef.current
        .filter((n) => n.id !== id)
        .map((n) => ({
          n,
          d: Math.hypot(
            n.position[0] - node.position[0],
            n.position[1] - node.position[1],
            n.position[2] - node.position[2]
          ),
        }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      for (const { n, d } of others) {
        if (d > 260) continue;
        const exists = filamentsRef.current.some(
          (f) =>
            (f.sourceId === id && f.targetId === n.id) ||
            (f.sourceId === n.id && f.targetId === id)
        );
        if (exists) continue;
        filamentsRef.current.push(edge(id, n.id, Math.max(0.18, 0.6 - d / 500), "resonance"));
      }
      scheduleGuestSave();
    }

    // ---- AI layers (authed only): orchestrated on the idle cycle -------
    let lastInterpretAt = 0;
    let lastExpandAt = 0;
    let interpretCount = 0;
    let lastDisturbAt = 0;
    let lastReflectAt = 0;
    let implicitPlaced = false;

    // Surfaced fragments materialize at the periphery (or center, for implicit)
    // — dim, slow, ephemeral until the user chooses to attend to them.
    function createAiFragment(
      text: string,
      origin: ThoughtNode["origin"],
      pos: [number, number, number],
      opacity: number,
      extra?: Partial<ThoughtNode>
    ): ThoughtNode {
      const node: ThoughtNode = {
        id: uuid(),
        rawText: text,
        timestamp: Date.now(),
        returnCount: 0,
        position: pos,
        velocity: [0, 0, 0],
        mass: 0.1,
        luminosity: opacity,
        texture: "smooth",
        state: "spore",
        charge: origin === "ai_disturb" ? -0.4 : 0,
        isSynthesis: false,
        crystallizing: 0,
        attentionCount: 1,
        lastAttendedAt: Date.now(),
        origin,
        contentType: "type",
        noDecay: origin === "ai_implicit",
        ...extra,
      };
      nodesRef.current.push(node);
      if (authedRef.current) {
        fetch("/api/thoughts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: node.id,
            rawText: node.rawText,
            position: node.position,
            isSynthesis: false,
            opacity,
            origin,
            parentFragmentId: node.parentFragmentId,
            sessionId: sessionIdRef.current,
          }),
        }).catch(() => {});
      }
      return node;
    }

    function removeFragment(id: string) {
      nodesRef.current = nodesRef.current.filter((n) => n.id !== id);
      filamentsRef.current = filamentsRef.current.filter(
        (f) => f.sourceId !== id && f.targetId !== id
      );
      if (authedRef.current) fetch(`/api/thoughts/${id}`, { method: "DELETE" }).catch(() => {});
    }

    function ingestServerFilaments(list: unknown) {
      if (!Array.isArray(list)) return;
      for (const raw of list as FilamentEdge[]) {
        if (!filamentsRef.current.find((x) => x.id === raw.id)) {
          filamentsRef.current.push(
            normalizeFilament({
              ...raw,
              ageSessions: raw.ageSessions ?? 0,
              isActive: raw.type !== "candidate",
              traffic: raw.traffic ?? 0,
              growth: raw.growth ?? 0,
            })
          );
        }
      }
    }

    // 9.1 — Interpretation cycle. Applies substrate, then occasionally lets the
    // periphery whisper (9.2), disturb (9.3), or names the center (9.4).
    async function runInterpretation() {
      const pendingBranchIds = nodesRef.current
        .filter((n) => n.origin === "ai_branch" && n.branchPendingGerm && (n.attentionCount ?? 1) <= 1)
        .map((n) => n.id);
      try {
        const res = await fetch("/api/claude/interpret", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionIdRef.current, pendingBranchIds }),
        });
        const data = await res.json();
        ingestServerFilaments(data.filaments);
        if (Array.isArray(data.driftTargets)) {
          for (const d of data.driftTargets) {
            const n = nodesRef.current.find((x) => x.id === d.id);
            if (n) n.driftTargetId = d.towardId;
          }
        }
        if (Array.isArray(data.germinations)) {
          for (const g of data.germinations as { parentId: string; text: string }[]) {
            const parent = nodesRef.current.find((n) => n.id === g.parentId);
            if (!parent || !parent.branchPendingGerm) continue;
            murmurationField.triggerMurmurForMembers([parent.id]);
            await delay(1400);
            parent.branchPendingGerm = false;
            const pos: [number, number, number] = [
              parent.position[0] + 42,
              parent.position[1] + 18,
              parent.position[2],
            ];
            const child = createAiFragment(g.text, "ai_branch", pos, 0.1, {
              parentFragmentId: parent.id,
              branchHue: parent.branchHue,
            });
            const f = edge(parent.id, child.id, 0.18, "branch");
            filamentsRef.current.push(f);
            fireCondPulse(f);
          }
        }
        interpretCount += 1;

        const clusters: string[][] = Array.isArray(data.themeClusters) ? data.themeClusters : [];
        themeClusters.length = 0;
        themeClusters.push(...clusters);
        const big = clusters.find((c) => c.length >= 3);
        if (big && interpretCount % 4 === 0 && Date.now() - lastExpandAt > 90000) {
          lastExpandAt = Date.now();
          maybeExpand(big);
        }

        const tensions: [string, string][] = Array.isArray(data.productiveTensions)
          ? data.productiveTensions
          : [];
        if (tensions.length && Date.now() - lastDisturbAt > 300000) {
          lastDisturbAt = Date.now();
          maybeDisturb(tensions[0]);
        }

        if (data.circlingPersisted && data.circlingRegion && !implicitPlaced) {
          implicitPlaced = true;
          maybeImplicit(data.circlingRegion.ids);
        }
      } catch {
        /* the field continues with last-known substrate */
      }
    }

    function clusterCentroid(ids: string[]): [number, number] {
      let cx = 0;
      let cy = 0;
      let c = 0;
      for (const id of ids) {
        const n = nodesRef.current.find((x) => x.id === id);
        if (n) {
          cx += n.position[0];
          cy += n.position[1];
          c++;
        }
      }
      return c ? [cx / c, cy / c] : [0, 0];
    }

    async function maybeExpand(ids: string[]) {
      const contents = ids
        .map((id) => nodesRef.current.find((n) => n.id === id)?.rawText)
        .filter((t): t is string => Boolean(t));
      if (contents.length < 2) return;
      murmurationField.triggerMurmurForMembers(ids);
      await delay(1400);
      try {
        const res = await fetch("/api/claude/expand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents }),
        });
        const { words } = await res.json();
        if (!Array.isArray(words)) return;
        const [cx, cy] = clusterCentroid(ids);
        const baseAng = Math.atan2(cy, cx); // outward from the field center
        words.slice(0, 3).forEach((w: string, i: number) => {
          const ang = baseAng + (i - 1) * 0.45;
          const r = 300 + Math.hypot(cx, cy) * 0.4 + i * 36;
          createAiFragment(String(w), "ai_expansion", [Math.cos(ang) * r, Math.sin(ang) * r, -10], 0.15);
        });
      } catch {
        /* periphery stays quiet */
      }
    }

    async function maybeDisturb([aId, bId]: [string, string]) {
      const a = nodesRef.current.find((n) => n.id === aId);
      const b = nodesRef.current.find((n) => n.id === bId);
      if (!a || !b) return;
      murmurationField.triggerMurmurForMembers([aId, bId]);
      await delay(1400);
      try {
        const res = await fetch("/api/claude/disturb", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aText: a.rawText, bText: b.rawText }),
        });
        const { question } = await res.json();
        if (!question) return;
        const mid: [number, number, number] = [
          (a.position[0] + b.position[0]) / 2,
          (a.position[1] + b.position[1]) / 2,
          (a.position[2] + b.position[2]) / 2,
        ];
        createAiFragment(String(question), "ai_disturb", mid, 0.15);
      } catch {
        /* tension stays unspoken */
      }
    }

    async function maybeImplicit(ids: string[]) {
      const contents = ids
        .map((id) => nodesRef.current.find((n) => n.id === id)?.rawText)
        .filter((t): t is string => Boolean(t));
      if (contents.length === 0) return;
      try {
        const res = await fetch("/api/claude/implicit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents }),
        });
        const { question } = await res.json();
        if (!question) {
          implicitPlaced = false; // allow a later cycle to try again
          return;
        }
        createAiFragment(String(question), "ai_implicit", [0, 0, 0], 0.1);
      } catch {
        implicitPlaced = false;
      }
    }

    // 9.5 — Reflection: a spatial reorganization of the user's own material.
    async function runReflection() {
      if (!authedRef.current || Date.now() - lastReflectAt < 30000) return;
      lastReflectAt = Date.now();
      try {
        const res = await fetch("/api/claude/reflect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionIdRef.current }),
        });
        const { reflection: r } = await res.json();
        if (!r) return;
        const emphasize = new Set<string>();
        for (const c of r.emphasizeClusters ?? []) for (const id of c) emphasize.add(id);
        for (const pair of r.newConnections ?? []) {
          const [a, b] = pair;
          if (!filamentsRef.current.some((f) => connects(f, a, b))) {
            filamentsRef.current.push(edge(a, b, 0.3, "resonance"));
          }
        }
        reflection = { emphasize, labels: r.clusterLabels ?? [], until: performance.now() + 10000 };
      } catch {
        /* no reflection this time */
      }
    }

    // Sketch fragment: store stroke points relative to their centroid so the
    // stroke rides with the fragment, then auto-connect to the nearest kin.
    function finalizeSketch() {
      if (sketchPts.length < 3) return;
      let cx = 0;
      let cy = 0;
      for (const p of sketchPts) {
        cx += p.x;
        cy += p.y;
      }
      cx /= sketchPts.length;
      cy /= sketchPts.length;
      const rel = sketchPts.map((p) => [
        Math.round((p.x - cx) * 100) / 100,
        Math.round((p.y - cy) * 100) / 100,
        0,
      ]);
      const node: ThoughtNode = {
        id: uuid(),
        rawText: "✎",
        timestamp: Date.now(),
        returnCount: 0,
        position: [cx, cy, 0],
        velocity: [0, 0, 0],
        mass: 0.6,
        luminosity: 0.5,
        texture: "smooth",
        state: "spore",
        charge: 0,
        isSynthesis: false,
        crystallizing: 0,
        attentionCount: 1,
        lastAttendedAt: Date.now(),
        origin: "user",
        contentType: "sketch",
        sketchPath: JSON.stringify(rel),
      };
      nodesRef.current.push(node);
      lastActivityRef.current = Date.now();
      energyRef.current = "turbulence";

      // A stroke drawn near a fragment gets a weak connection to it.
      let near: ThoughtNode | null = null;
      let nearD = Infinity;
      for (const o of nodesRef.current) {
        if (o.id === node.id) continue;
        const d = Math.hypot(o.position[0] - cx, o.position[1] - cy);
        if (d < nearD) {
          nearD = d;
          near = o;
        }
      }
      if (near && nearD < 220) filamentsRef.current.push(edge(node.id, near.id, 0.18, "resonance"));

      if (authedRef.current) {
        fetch("/api/thoughts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: node.id,
            rawText: node.rawText,
            position: node.position,
            isSynthesis: false,
            opacity: node.luminosity,
            contentType: "sketch",
            sketchPath: node.sketchPath,
            sessionId: sessionIdRef.current,
          }),
        }).catch(() => {});
      } else {
        scheduleGuestSave();
      }
      emitFieldEvent("sketch");
    }
    function saveSnapshot() {
      if (!authedRef.current || nodesRef.current.length === 0) return;
      const points = nodesRef.current
        .filter((n) => !n.origin || n.origin === "user")
        .slice(-160)
        .map((n) => ({ x: n.position[0], y: n.position[1], mass: n.mass }));
      try {
        const body = JSON.stringify({ sessionId: sessionIdRef.current, points });
        // Prefer sendBeacon on unload so it survives the page going away.
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/snapshot", new Blob([body], { type: "application/json" }));
        } else {
          fetch("/api/snapshot", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        /* snapshot is best-effort */
      }
    }

    // ---- Voice (engine-agnostic; Deepgram now, whisper.cpp later) ------
    const voice = new Transcriber({
      onPartial: (t) => {
        if (!captureRef.current.active) beginCapture();
        onPartialText(t);
      },
      onFinal: (t, prosody) => crystallize(t, prosody),
      onStateChange: (l) => {
        setListening(l);
        setStatus(l ? "listening — speak your thought" : "");
        if (l) {
          dismissWorkbench();
          emitFieldEvent("voice-start");
        }
      },
      onError: (msg) => {
        setListening(false);
        voiceBlockedRef.current = true;
        setStatus(
          msg === "mic_denied"
            ? "microphone blocked — type instead"
            : "voice unavailable — type instead"
        );
      },
    });
    voiceRef.current = voice;

    // ---- Layer 2 (semantic) on idle, Layer 4 (surfacing) on stillness --
    const idleTimer = setInterval(async () => {
      const idle = Date.now() - lastActivityRef.current;

      if (idle > 4000 && unprocessedRef.current.size > 0) {
        const [id] = unprocessedRef.current;
        unprocessedRef.current.delete(id);
        if (!authedRef.current) {
          // Guest field: weave connections locally, no server, no Claude.
          localLink(id);
        } else {
          try {
            const res = await fetch("/api/claude/semantic", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ thoughtId: id }),
            });
            const data = await res.json();
            if (data.filaments) {
              const node = nodesRef.current.find((n) => n.id === id);
              if (node) {
                node.charge = data.charge ?? node.charge;
                node.embedding = data.embedding;
                node.state = "hypha";
              }
              for (const f of data.filaments) {
                if (!filamentsRef.current.find((x) => x.id === f.id)) {
                  const edge = normalizeFilament({
                    id: f.id,
                    sourceId: f.sourceId,
                    targetId: f.targetId,
                    strength: f.strength,
                    type: f.type,
                    conductionSpeed: f.conductionSpeed,
                    ageSessions: 0,
                    isActive: true,
                    traffic: 1,
                    growth: 0,
                  });
                  filamentsRef.current.push(edge);
                  fireCondPulse(edge);
                }
              }
            }
          } catch {
            /* field continues with last-known parameters */
          }
        }
      }

      // Layer 9.1 — Interpretation runs on a ~25s cadence over the whole field.
      if (
        authedRef.current &&
        nodesRef.current.length >= 3 &&
        unprocessedRef.current.size === 0 &&
        Date.now() - lastInterpretAt > 25000
      ) {
        lastInterpretAt = Date.now();
        runInterpretation();
      }

      if (authedRef.current && idle > 90000 && !pendingAdjustRef.current && unprocessedRef.current.size === 0) {
        lastActivityRef.current = Date.now();
        try {
          const res = await fetch("/api/claude/surface", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: sessionIdRef.current }),
          });
          const data = await res.json();
          if (data.adjustment) {
            pendingAdjustRef.current = { ...data.adjustment, startedAt: Date.now() };
          }
        } catch {
          /* noop */
        }
      }
    }, 1500);

    // ---- Resolve identity, then load the right field -------------------
    (async () => {
      let authed = false;
      if (isSupabaseConfigured) {
        try {
          const sb = createSupabaseBrowserClient();
          const { data } = await sb.auth.getUser();
          if (data.user?.id) {
            authed = true;
            hueRef.current = (hashStr(data.user.id) / 4294967296 - 0.5) * 0.26;
          }
        } catch {
          /* treat as guest */
        }
      }
      authedRef.current = authed;

      try {
        const hr = await fetch("/api/health");
        if (hr.ok) {
          const h = await hr.json();
          if (!h.claude) setStatus("Claude API not configured — AI layers paused");
        }
      } catch {
        /* offline */
      }

      if (!authed) {
        loadGuest();
        return;
      }

      try {
        const r = await fetch("/api/thoughts");
        if (r.status === 401) {
          authedRef.current = false;
          loadGuest();
          return;
        }
        const data = await r.json();
        const accountNodes: ThoughtNode[] = Array.isArray(data.nodes) ? data.nodes : [];
        const guest = readGuest();

        if (
          accountNodes.length === 0 &&
          guest &&
          Array.isArray(guest.nodes) &&
          guest.nodes.length > 0
        ) {
          // First sign-in carrying a guest playground — adopt it into the account.
          nodesRef.current = guest.nodes.map((n) => ({ ...n, crystallizing: 1 }));
          filamentsRef.current = guest.filaments || [];
          for (const n of nodesRef.current) {
            persistThought(n);
            // Let Claude weave the real semantic filaments for migrated thoughts.
            if (!n.isSynthesis) unprocessedRef.current.add(n.id);
          }
          clearGuest();
        } else {
          nodesRef.current = accountNodes.map((n) => ({ ...n, crystallizing: 1 }));
          filamentsRef.current = (data.filaments || []).map((f: FilamentEdge) =>
            normalizeFilament({ ...f, growth: f.growth ?? 1 })
          );
        }
      } catch {
        /* network hiccup — field starts empty and recovers on next interaction */
      }

      try {
        const nr = await fetch("/api/negative-space");
        if (nr.ok) {
          const nd = await nr.json();
          if (Array.isArray(nd.negative)) {
            negativeMarks.push(...nd.negative);
            negDirty = true;
          }
        }
      } catch {
        /* peripheral traces are non-essential */
      }

      try {
        const pr = await fetch(`/api/snapshot?exclude=${encodeURIComponent(sessionIdRef.current)}`);
        if (pr.ok) {
          const pd = await pr.json();
          // Most-recent layer densest; older layers contribute fewer points.
          const layers = Array.isArray(pd.layers) ? pd.layers : [];
          layers.forEach((layer: { points?: { x: number; y: number; mass: number }[] }, i: number) => {
            const pts = layer.points ?? [];
            const stride = 1 + i; // older sessions sparser/fainter
            for (let k = 0; k < pts.length; k += stride) palimpsest.push(pts[k]);
          });
          if (palimpsest.length > 0) rebuildPalimpsest();
        }
      } catch {
        /* the ghost of prior sessions is optional */
      }

      try {
        const cr = await fetch(
          `/api/cosmos?current=${encodeURIComponent(sessionIdRef.current)}`
        );
        if (cr.ok) {
          const cd = await cr.json();
          if (Array.isArray(cd.sessions)) {
            cosmosSessions.length = 0;
            cosmosSessions.push(...(cd.sessions as CosmosSession[]));
          }
          if (Array.isArray(cd.resonances)) {
            cosmosResonances.length = 0;
            cosmosResonances.push(...(cd.resonances as CosmosResonance[]));
          }
        }
      } catch {
        /* cosmos web is optional */
      }

      try {
        const tr = await fetch("/api/tools");
        if (tr.ok) {
          const td = await tr.json();
          if (Array.isArray(td.tools)) {
            userTools.push(...td.tools);
            setTools(td.tools);
          }
        }
      } catch {
        /* workbench tools optional offline */
      }

      try {
        const thr = await fetch(`/api/threads?sessionId=${encodeURIComponent(sessionIdRef.current)}`);
        if (thr.ok) {
          const thd = await thr.json();
          if (Array.isArray(thd.threads)) {
            for (const t of thd.threads as FieldThread[]) {
              fieldThreads.push(t);
              rebuildThreadLine(t);
            }
          }
        }
      } catch {
        /* threads optional */
      }
    })();

    // Persist the field as a palimpsest layer when the session goes away.
    function onVisibility() {
      if (document.visibilityState === "hidden") saveSnapshot();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", saveSnapshot);

    apiRef.current = {
      beginCapture,
      crystallize,
      onPartialText,
    };

    return () => {
      saveSnapshot();
      cancelAnimationFrame(raf);
      clearInterval(idleTimer);
      clearTimeout(guestSaveTimer);
      cancelAnimationFrame(glyphAnimRaf);
      for (const el of selectionEls.values()) el.remove();
      for (const line of threadLines.values()) {
        scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
      voice.stop();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("dblclick", onDblClick);
      renderer.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", saveSnapshot);
      for (const el of reflectEls) el.remove();
      for (const tube of tubes.values()) tube.dispose();
      for (const tube of cosmosTubes.values()) tube.dispose();
      for (const spr of cosmosSprites.values()) (spr.material as THREE.Material).dispose();
      for (const s of birdSprites) (s.material as THREE.Material).dispose();
      for (const line of silhouetteLines.values()) {
        scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
      for (const s of trailSprites) (s.material as THREE.Material).dispose();
      for (const s of settleSprites) (s.material as THREE.Material).dispose();
      negGeom.dispose();
      (negPoints.material as THREE.Material).dispose();
      sketchLiveGeom.dispose();
      (sketchLive.material as THREE.Material).dispose();
      palimGeom.dispose();
      (palimPoints.material as THREE.Material).dispose();
      captureTube.dispose();
      fieldFx.composer.dispose();
      renderer.dispose();
      glowTex.dispose();
      coreTex.dispose();
      haloTex.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function enterTyping() {
    setTyping(true);
    setStatus("type your thought, then press Enter");
    emitFieldEvent("type-start");
    apiRef.current?.beginCapture();
    setTimeout(() => hiddenInputRef.current?.focus(), 0);
  }

  async function onOrbClick() {
    if (listening) {
      voiceRef.current?.stop();
      setStatus("");
      return;
    }
    if (typing) {
      finishTyping();
      return;
    }
    if (voiceBlockedRef.current) {
      enterTyping();
      return;
    }
    setStatus("connecting…");
    const started = await voiceRef.current?.start();
    if (!started) {
      voiceBlockedRef.current = true;
      enterTyping();
    }
  }

  function onTypeInput(e: React.ChangeEvent<HTMLInputElement>) {
    apiRef.current?.onPartialText(e.target.value);
  }

  function onTypeKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") finishTyping();
    if (e.key === "Escape") {
      apiRef.current?.crystallize(""); // released without committing → negative space
      setTyping(false);
      setPartial("");
      if (hiddenInputRef.current) hiddenInputRef.current.value = "";
    }
  }

  function finishTyping() {
    const text = hiddenInputRef.current?.value || partial;
    apiRef.current?.crystallize(text);
    if (hiddenInputRef.current) hiddenInputRef.current.value = "";
    setTyping(false);
    setStatus("");
  }

  return (
    <div className="fixed inset-0">
      <div ref={mountRef} className="absolute inset-0" />
      <div ref={labelLayerRef} className="pointer-events-none absolute inset-0 z-10" />
      <div ref={glyphLayerRef} className="pointer-events-none absolute inset-0 z-20" />

      {/* The opening — utter darkness dissolving into the void */}
      <div
        className="pointer-events-none absolute inset-0 z-50 bg-black transition-opacity duration-[2600ms] ease-out"
        style={{ opacity: revealed ? 0 : 1 }}
      />


      {/* Live partial capture text */}
      {partial && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 max-w-xl -translate-x-1/2 -translate-y-1/2 px-6 text-center text-[15px] font-light italic leading-relaxed text-[rgba(190,210,230,0.5)]">
          {partial}
        </div>
      )}

      {/* Faint state cue */}
      {status && !partial && (
        <div className="pointer-events-none absolute bottom-[5.5rem] left-1/2 z-20 -translate-x-1/2 whitespace-nowrap text-[11px] font-light italic tracking-wide text-[rgba(150,180,210,0.32)]">
          {status}
        </div>
      )}

      {/* The orb — the entire UI chrome */}
      <button
        onClick={onOrbClick}
        aria-label="thought input"
        className="group absolute bottom-10 left-1/2 z-30 -translate-x-1/2 cursor-pointer border-0 bg-transparent p-6"
      >
        <span
          className={`block h-3 w-3 rounded-full bg-[rgba(160,200,235,0.9)] shadow-[0_0_20px_8px_rgba(120,180,230,0.45)] ${
            listening || typing ? "scale-125" : "orb-pulse"
          }`}
          style={
            listening || typing
              ? { boxShadow: "0 0 32px 14px rgba(140,200,240,0.6)", opacity: 0.95 }
              : undefined
          }
        />
      </button>

      {/* Hidden capture input for typed thoughts */}
      <input
        ref={hiddenInputRef}
        onChange={onTypeInput}
        onKeyDown={onTypeKey}
        onBlur={() => typing && finishTyping()}
        className="absolute bottom-24 left-1/2 z-30 w-[min(80vw,32rem)] -translate-x-1/2 border-0 border-b border-[rgba(150,190,220,0.2)] bg-transparent text-center text-base font-light text-[rgba(200,220,240,0.7)] outline-none placeholder:text-[rgba(150,180,210,0.25)]"
        placeholder="type your thought, then press Enter"
        style={{ display: typing ? "block" : "none" }}
        autoComplete="off"
      />

      {/* Expanded thought */}
      {expanded && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(5,6,12,0.7)] backdrop-blur-sm"
          onClick={() => setExpanded(null)}
        >
          <div className="max-w-2xl px-10 text-center text-xl font-light leading-relaxed text-[rgba(210,225,240,0.85)]">
            {expanded.rawText}
            {expanded.returnCount > 0 && (
              <div className="mt-6 text-xs font-light uppercase tracking-[0.2em] text-[rgba(150,180,210,0.35)]">
                returned {expanded.returnCount}×
              </div>
            )}
          </div>
        </div>
      )}

      {pageDraft && (
        <PageView
          draft={pageDraft}
          threadAvgPosition={threadAvgPos}
          sessionId={sessionIdRef.current}
          tools={tools}
          onClose={() => {
            setPageDraft(null);
            emitFieldEvent("page-close");
          }}
          onDraftChange={setPageDraft}
          onReturnedToField={(text, position) => {
            const node: ThoughtNode = {
              id: uuid(),
              rawText: text,
              timestamp: Date.now(),
              returnCount: 0,
              position,
              velocity: [0, 0, 0],
              mass: 0.1,
              luminosity: 0.15,
              texture: "smooth",
              state: "spore",
              charge: 0,
              isSynthesis: false,
              crystallizing: 0,
              origin: "returned_from_draft",
              attentionCount: 1,
              lastAttendedAt: Date.now(),
            };
            nodesRef.current.push(node);
            emitFieldEvent("returned-from-draft", { id: node.id });
            if (authedRef.current) {
              fetch("/api/thoughts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  id: node.id,
                  rawText: node.rawText,
                  position: node.position,
                  opacity: 0.15,
                  origin: "returned_from_draft",
                  sessionId: sessionIdRef.current,
                }),
              }).catch(() => {});
            }
          }}
          onReflect={(selection, fragmentIds) => {
            void fetch("/api/claude/reflect", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: sessionIdRef.current,
                fragmentIds: fragmentIds.length ? fragmentIds : undefined,
                selectionText: selection,
              }),
            });
          }}
        />
      )}
    </div>
  );
}
