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
  nodeColor,
  filamentColor,
  hueShift,
} from "@/lib/glow";
import { FilamentTube, generateHyphae, hashStr } from "@/lib/field/mycelium";
import { createFieldComposer } from "@/lib/field/postfx";
import { Transcriber } from "@/lib/transcription";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { ThoughtNode, FilamentEdge, Prosody } from "@/lib/types";

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
  hyphae: THREE.LineSegments;
  spin: number;
  axis: THREE.Vector3;
}

export function FieldCanvas() {
  const mountRef = useRef<HTMLDivElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  const [partial, setPartial] = useState("");
  const [listening, setListening] = useState(false);
  const [typing, setTyping] = useState(false);
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState<ThoughtNode | null>(null);
  const voiceBlockedRef = useRef(false);

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

  // Live capture thread.
  const captureRef = useRef<{
    active: boolean;
    target: [number, number, number];
    progress: number;
    text: string;
  }>({ active: false, target: [0, 0, 0], progress: 0, text: "" });

  // Derive this mind's hue signature from its user id.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    try {
      const supabase = createSupabaseBrowserClient();
      supabase.auth.getUser().then(({ data }) => {
        if (data.user?.id) {
          hueRef.current = (hashStr(data.user.id) / 4294967296 - 0.5) * 0.26;
        }
      });
    } catch {
      /* not configured — neutral hue */
    }
  }, []);

  useEffect(() => {
    const mount = mountRef.current!;
    const width = window.innerWidth;
    const height = window.innerHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x04050a, 0.0013);

    const camera = new THREE.PerspectiveCamera(52, width / height, 1, 6000);
    camera.position.set(0, 0, 340);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x04050a, 1);
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
        cInner: { value: new THREE.Color(0.035, 0.05, 0.10) },
        cOuter: { value: new THREE.Color(0.006, 0.008, 0.018) },
        uTime: { value: 0 },
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
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y * 0.5 + 0.5;
          float rad = smoothstep(0.0, 1.0, 1.0 - length(d.xy) * 0.5);
          vec3 col = mix(cOuter, cInner, smoothstep(0.0, 1.0, h) * 0.6 + rad * 0.4);
          // a breathing tide deep in the dark
          col += cInner * 0.15 * (0.5 + 0.5 * sin(uTime * 0.0003 + d.x * 2.0));
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

    // ---- The tracing thread — a hypha growing from the orb -------------
    const captureTube = new FilamentTube(99173, new THREE.Color(2.2, 2.6, 3.2), 30, 7);
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

    // Scene-graph registries keyed by domain id.
    const nodeVis = new Map<string, NodeVisual>();
    const tubes = new Map<string, FilamentTube>();
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

    // ---- Sync three objects to data refs -------------------------------
    function syncScene(now: number) {
      const nodes = nodesRef.current;
      const tint = hueRef.current;
      const seen = new Set<string>();

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

          // The hyphal mat radiating from this thought.
          const seed = hashStr(node.id);
          const hyGeom = generateHyphae(seed, {
            roots: 6 + Math.floor(Math.min(6, node.mass)),
            baseLength: 22 + node.mass * 4,
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

          const r = (seed % 1000) / 1000;
          vis = {
            core,
            glow,
            halo,
            hyphae,
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
        const color = hueShift(nodeColor(node.charge, node.isSynthesis), tint);
        const baseSize = 5.5 + node.mass * 2.2 + node.returnCount * 1.1;
        const breath = 1 + Math.sin(now * 0.0011 + hashStr(node.id)) * 0.06;
        const lum = node.luminosity * cryst;
        const [px, py, pz] = node.position;

        // Core — bright, HDR, blooms hard
        vis.core.position.set(px, py, pz);
        vis.core.scale.setScalar(baseSize * 0.9 * (0.5 + cryst * 0.5) * breath);
        const cMat = vis.core.material as THREE.SpriteMaterial;
        cMat.color.copy(color).multiplyScalar(1.5 + lum * 1.4);
        cMat.opacity = Math.min(1, 0.4 + lum * 0.6) * cryst;

        // Glow — the soft body
        vis.glow.position.set(px, py, pz);
        vis.glow.scale.setScalar(baseSize * 2.4 * breath);
        const gMat = vis.glow.material as THREE.SpriteMaterial;
        gMat.color.copy(color);
        gMat.opacity = (0.12 + lum * 0.4) * cryst;

        // Halo — atmospheric aura
        vis.halo.position.set(px, py, pz);
        vis.halo.scale.setScalar(baseSize * 6.5 * breath);
        const hMat = vis.halo.material as THREE.SpriteMaterial;
        hMat.color.copy(color);
        hMat.opacity = (0.04 + lum * 0.12) * cryst;

        // Hyphae — drifting, breathing tendrils
        vis.hyphae.position.set(px, py, pz);
        vis.hyphae.quaternion.setFromAxisAngle(vis.axis, now * vis.spin);
        const hyScale = (0.4 + cryst * 0.6) * (0.85 + node.mass * 0.05);
        vis.hyphae.scale.setScalar(hyScale);
        const hyMat = vis.hyphae.material as THREE.LineBasicMaterial;
        hyMat.color.copy(color).multiplyScalar(0.7 + lum * 0.5);
        hyMat.opacity = (0.18 + lum * 0.42) * cryst;

        // Label overlay — only legible thoughts show text.
        const el = labelEls.get(node.id)!;
        if (lum > 0.34 && cryst > 0.6) {
          tmpA.set(px, py, pz).project(camera);
          const sx = (tmpA.x * 0.5 + 0.5) * window.innerWidth;
          const sy = (-tmpA.y * 0.5 + 0.5) * window.innerHeight;
          el.textContent =
            node.rawText.length > 42 ? node.rawText.slice(0, 42) + "…" : node.rawText;
          el.style.transform = `translate(-50%, 0) translate(${sx}px, ${sy + baseSize + 8}px)`;
          el.style.opacity = String(Math.min(0.6, 0.14 + lum * 0.5));
          el.style.display = tmpA.z < 1 ? "block" : "none";
        } else {
          el.style.opacity = "0";
        }
      }

      // Retire visuals for removed nodes.
      for (const [id, vis] of nodeVis) {
        if (!seen.has(id)) {
          scene.remove(vis.core, vis.glow, vis.halo, vis.hyphae);
          (vis.core.material as THREE.Material).dispose();
          (vis.glow.material as THREE.Material).dispose();
          (vis.halo.material as THREE.Material).dispose();
          vis.hyphae.geometry.dispose();
          (vis.hyphae.material as THREE.Material).dispose();
          nodeVis.delete(id);
          labelEls.get(id)?.remove();
          labelEls.delete(id);
        }
      }

      // ---- Filaments as living tapered tubes ---------------------------
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
          tube = new FilamentTube(hashStr(f.id), new THREE.Color(1, 1, 1));
          scene.add(tube.mesh);
          tubes.set(f.id, tube);
        }

        const g = Math.min(1, f.growth);
        tmpA.set(a.position[0], a.position[1], a.position[2]);
        tmpB.set(
          a.position[0] + (b.position[0] - a.position[0]) * g,
          a.position[1] + (b.position[1] - a.position[1]) * g,
          a.position[2] + (b.position[2] - a.position[2]) * g
        );
        const energyAmp = energyRef.current === "turbulence" ? 16 : 9;
        const radius = 0.5 + f.strength * 2.6 + (f.isActive ? 0.4 : 0);
        tube.update(tmpA, tmpB, now, radius, energyAmp);

        const fMat = tube.mesh.material as THREE.MeshBasicMaterial;
        fMat.color
          .copy(hueShift(filamentColor(f.type), tint))
          .multiplyScalar(0.6 + f.strength * 1.1 + (f.isActive ? 0.3 : 0));
        fMat.opacity = ((f.isActive ? 0.32 : 0.12) + f.strength * 0.5) * g;

        // Pulses ride the strong, living filaments.
        if (f.isActive && f.strength > 0.28 && g > 0.6) {
          const count = Math.min(3, 1 + Math.floor(f.strength * 2 + f.traffic * 0.1));
          for (let k = 0; k < count && pulseIdx < PULSE_COUNT; k++) {
            const sp = pulses[pulseIdx++];
            const speed = 0.00006 + f.strength * 0.00012;
            let t = ((now * speed + k / count + (hashStr(f.id) % 100) / 100) % 1);
            tube.sample(t, tmpC);
            sp.visible = true;
            sp.position.copy(tmpC);
            const fade = Math.sin(Math.PI * t);
            const pMat = sp.material as THREE.SpriteMaterial;
            pMat.color.copy(fMat.color).multiplyScalar(1.6);
            pMat.opacity = fade * (0.5 + f.strength * 0.5);
            sp.scale.setScalar((2.2 + f.strength * 3) * (0.6 + fade * 0.6));
          }
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
          node.crystallizing = Math.min(1, node.crystallizing + dt * 0.045);
        }
      }

      const stepped = stepPhysics(nodesRef.current, filamentsRef.current, energyRef.current, dt);
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

      voidGlow.material.opacity = 0.18 + Math.sin(now * 0.0006) * 0.06;
      skyMat.uniforms.uTime.value = now;
      updateThread(now);
      syncScene(now);
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

    function onPointerDown(e: PointerEvent) {
      const n = nearestNode(e.clientX, e.clientY);
      downPos = { x: e.clientX, y: e.clientY };
      downAt = performance.now();
      moved = false;
      dragId = n ? n.id : null;
    }

    function onPointerMove(e: PointerEvent) {
      // gentle parallax follows the pointer
      parallax.tx = ((e.clientX / window.innerWidth) * 2 - 1) * 14;
      parallax.ty = -((e.clientY / window.innerHeight) * 2 - 1) * 10;

      if (!dragId) return;
      if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) moved = true;
      if (!moved) return;
      const node = nodesRef.current.find((x) => x.id === dragId);
      if (!node) return;
      const w = screenToWorld(e.clientX, e.clientY);
      node.position = [w.x, w.y, node.position[2]];
      node.velocity = [0, 0, 0];
      energyRef.current = "turbulence";
      lastActivityRef.current = Date.now();
    }

    function onPointerUp() {
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
        registerReturn(node);
      }
      dragId = null;
    }

    function onDblClick(e: MouseEvent) {
      const n = nearestNode(e.clientX, e.clientY, 44);
      if (n) setExpanded(n);
    }

    function onWheel(e: WheelEvent) {
      camera.position.z = THREE.MathUtils.clamp(
        camera.position.z + e.deltaY * 0.5,
        120,
        1800
      );
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

    // ---- Behaviors -----------------------------------------------------
    function patchPosition(node: ThoughtNode) {
      fetch(`/api/thoughts/${node.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: node.position }),
      }).catch(() => {});
    }

    function registerReturn(node: ThoughtNode) {
      node.returnCount += 1;
      node.mass += 0.5;
      node.luminosity = Math.min(1, node.luminosity + 0.2);
      energyRef.current = "turbulence";
      lastActivityRef.current = Date.now();
      for (const f of filamentsRef.current) {
        if (f.sourceId === node.id || f.targetId === node.id) {
          f.strength = Math.min(1, f.strength + 0.08);
          f.isActive = true;
        }
      }
      fetch(`/api/thoughts/${node.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incrementReturn: true }),
      }).catch(() => {});
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
        mass: 2,
        luminosity: 0.9,
        texture: "smooth",
        state: "spore",
        charge: (a.charge + b.charge) / 2,
        isSynthesis: true,
        sourceThoughtIds: [a.id, b.id],
        crystallizing: 0,
      };
      nodesRef.current.push(node);
      filamentsRef.current.push(
        edge(a.id, id, 0.6, "resonance"),
        edge(b.id, id, 0.6, "resonance")
      );
      energyRef.current = "turbulence";
      lastActivityRef.current = Date.now();
      persistThought(node);
    }

    // ---- Capture orchestration ----------------------------------------
    function beginCapture() {
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
      if (!trimmed) return;

      const texture: ThoughtNode["texture"] = prosody
        ? prosody.trailingOff
          ? "very_rough"
          : prosody.pace > 3
          ? "rough"
          : "smooth"
        : "smooth";

      const node: ThoughtNode = {
        id: uuid(),
        rawText: trimmed,
        prosody,
        timestamp: Date.now(),
        returnCount: 0,
        position: cap.target,
        velocity: [0, 0, 0],
        mass: 1,
        luminosity: 0.95,
        texture,
        state: "spore",
        charge: 0,
        isSynthesis: false,
        crystallizing: 0,
      };
      nodesRef.current.push(node);
      unprocessedRef.current.add(node.id);
      lastActivityRef.current = Date.now();
      persistThought(node);
    }

    function persistThought(node: ThoughtNode) {
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
      return {
        id: uuid(),
        sourceId,
        targetId,
        strength,
        type,
        ageSessions: 0,
        isActive: true,
        traffic: 1,
        growth: 0,
      };
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
                filamentsRef.current.push({
                  id: f.id,
                  sourceId: f.sourceId,
                  targetId: f.targetId,
                  strength: f.strength,
                  type: f.type,
                  ageSessions: 0,
                  isActive: true,
                  traffic: 1,
                  growth: 0,
                });
              }
            }
          }
        } catch {
          /* field continues with last-known parameters */
        }
      }

      if (idle > 90000 && !pendingAdjustRef.current && unprocessedRef.current.size === 0) {
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

    // ---- Load existing field ------------------------------------------
    fetch("/api/thoughts")
      .then((r) => {
        if (r.status === 401) {
          window.location.href = "/login";
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data && Array.isArray(data.nodes)) {
          nodesRef.current = data.nodes.map((n: ThoughtNode) => ({ ...n, crystallizing: 1 }));
          filamentsRef.current = data.filaments || [];
        }
      })
      .catch(() => {});

    apiRef.current = {
      beginCapture,
      crystallize,
      onPartialText,
    };

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(idleTimer);
      voice.stop();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("dblclick", onDblClick);
      renderer.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
      for (const tube of tubes.values()) tube.dispose();
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
    </div>
  );
}
