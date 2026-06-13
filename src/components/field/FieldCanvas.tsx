"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  stepPhysics,
  computeSemanticPosition,
  applyAdjustment,
} from "@/lib/physics";
import { makeGlowTexture, nodeColor, filamentColor } from "@/lib/glow";
import { Transcriber } from "@/lib/transcription";
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
    const camera = new THREE.PerspectiveCamera(50, width / height, 1, 4000);
    camera.position.set(0, 0, 340);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x0a0a0f, 1);
    mount.appendChild(renderer.domElement);

    const glowTex = makeGlowTexture();

    // Scene-graph object registries keyed by domain id.
    const sprites = new Map<string, THREE.Sprite>();
    const haloSprites = new Map<string, THREE.Sprite>();
    const lines = new Map<string, THREE.Line>();
    const labelEls = new Map<string, HTMLDivElement>();

    // The breathing center — Alexander's void, faintly marked.
    const voidGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(0.1, 0.14, 0.22),
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    voidGlow.scale.set(120, 120, 1);
    scene.add(voidGlow);

    // The tracing thread — ink entering water.
    const threadGeom = new THREE.BufferGeometry();
    const threadPositions = new Float32Array(64 * 3);
    threadGeom.setAttribute("position", new THREE.BufferAttribute(threadPositions, 3));
    const threadMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(0.7, 0.85, 1.0),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const thread = new THREE.Line(threadGeom, threadMat);
    thread.frustumCulled = false;
    scene.add(thread);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    function screenToWorld(clientX: number, clientY: number): THREE.Vector3 {
      pointer.x = (clientX / window.innerWidth) * 2 - 1;
      pointer.y = -(clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const target = new THREE.Vector3();
      raycaster.ray.intersectPlane(groundPlane, target);
      return target ?? new THREE.Vector3();
    }

    // ---- Sync three objects to data refs -------------------------------
    function syncScene() {
      const nodes = nodesRef.current;
      const seen = new Set<string>();

      for (const node of nodes) {
        seen.add(node.id);
        let sprite = sprites.get(node.id);
        if (!sprite) {
          sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: glowTex,
              transparent: true,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            })
          );
          scene.add(sprite);
          sprites.set(node.id, sprite);

          const halo = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: glowTex,
              transparent: true,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              opacity: 0.15,
            })
          );
          scene.add(halo);
          haloSprites.set(node.id, halo);

          const el = document.createElement("div");
          el.className = "node-label";
          labelLayerRef.current?.appendChild(el);
          labelEls.set(node.id, el);
        }

        const cryst = node.crystallizing ?? 1;
        const color = nodeColor(node.charge, node.isSynthesis);
        const baseSize = 6 + node.mass * 2.4 + node.returnCount * 1.2;
        const lum = node.luminosity * cryst;

        sprite.position.set(node.position[0], node.position[1], node.position[2]);
        sprite.scale.setScalar(baseSize * (0.6 + cryst * 0.4));
        const mat = sprite.material as THREE.SpriteMaterial;
        mat.color = color;
        mat.opacity = Math.min(1, 0.35 + lum * 0.65);

        const halo = haloSprites.get(node.id)!;
        halo.position.copy(sprite.position);
        halo.scale.setScalar(baseSize * 3.2);
        const hmat = halo.material as THREE.SpriteMaterial;
        hmat.color = color;
        hmat.opacity = 0.06 + lum * 0.14;

        // Label overlay — only legible thoughts show text.
        const el = labelEls.get(node.id)!;
        if (lum > 0.32 && cryst > 0.6) {
          const v = sprite.position.clone().project(camera);
          const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
          const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
          el.textContent =
            node.rawText.length > 42 ? node.rawText.slice(0, 42) + "…" : node.rawText;
          el.style.transform = `translate(-50%, 0) translate(${sx}px, ${sy + baseSize + 6}px)`;
          el.style.opacity = String(Math.min(0.55, 0.12 + lum * 0.5));
          el.style.display = v.z < 1 ? "block" : "none";
        } else {
          el.style.opacity = "0";
        }
      }

      for (const [id, sprite] of sprites) {
        if (!seen.has(id)) {
          scene.remove(sprite);
          sprites.delete(id);
          const halo = haloSprites.get(id);
          if (halo) {
            scene.remove(halo);
            haloSprites.delete(id);
          }
          const el = labelEls.get(id);
          el?.remove();
          labelEls.delete(id);
        }
      }

      // Filaments
      const nodeById = new Map(nodes.map((n) => [n.id, n]));
      const seenF = new Set<string>();
      for (const f of filamentsRef.current) {
        const a = nodeById.get(f.sourceId);
        const b = nodeById.get(f.targetId);
        if (!a || !b) continue;
        seenF.add(f.id);
        let line = lines.get(f.id);
        if (!line) {
          const geom = new THREE.BufferGeometry();
          geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
          line = new THREE.Line(
            geom,
            new THREE.LineBasicMaterial({
              transparent: true,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            })
          );
          scene.add(line);
          lines.set(f.id, line);
        }
        const pos = line.geometry.attributes.position as THREE.BufferAttribute;
        const g = Math.min(1, f.growth);
        pos.setXYZ(0, a.position[0], a.position[1], a.position[2]);
        pos.setXYZ(
          1,
          a.position[0] + (b.position[0] - a.position[0]) * g,
          a.position[1] + (b.position[1] - a.position[1]) * g,
          a.position[2] + (b.position[2] - a.position[2]) * g
        );
        pos.needsUpdate = true;
        const lmat = line.material as THREE.LineBasicMaterial;
        lmat.color = filamentColor(f.type);
        lmat.opacity = (f.isActive ? 0.08 : 0.03) + f.strength * 0.4;
      }
      for (const [id, line] of lines) {
        if (!seenF.has(id)) {
          scene.remove(line);
          lines.delete(id);
        }
      }
    }

    // ---- Capture thread visual ----------------------------------------
    function updateThread(now: number) {
      const cap = captureRef.current;
      const orb = screenToWorld(window.innerWidth / 2, window.innerHeight - 60);
      if (!cap.active && threadMat.opacity <= 0.001) {
        threadMat.opacity = 0;
        return;
      }
      const target = new THREE.Vector3(cap.target[0], cap.target[1], cap.target[2]);
      const reach = cap.active ? Math.min(1, cap.progress) : 0;
      const steps = 32;
      for (let i = 0; i < steps; i++) {
        const t = (i / (steps - 1)) * reach;
        const x = orb.x + (target.x - orb.x) * t;
        const y = orb.y + (target.y - orb.y) * t;
        const z = orb.z + (target.z - orb.z) * t;
        // ink wavers as it flows
        const w = Math.sin(t * Math.PI * 3 + now * 0.004) * (1 - t) * 8;
        threadPositions[i * 3] = x + w;
        threadPositions[i * 3 + 1] = y + Math.cos(t * Math.PI * 2 + now * 0.003) * (1 - t) * 6;
        threadPositions[i * 3 + 2] = z;
      }
      threadGeom.setDrawRange(0, steps);
      (threadGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      const targetOpacity = cap.active ? 0.5 + reach * 0.3 : 0;
      threadMat.opacity += (targetOpacity - threadMat.opacity) * 0.1;
    }

    // ---- Main loop -----------------------------------------------------
    let raf = 0;
    let last = performance.now();
    function loop(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000) * 60;
      last = now;

      // Capture thread extends as text arrives
      const cap = captureRef.current;
      if (cap.active && cap.progress < 1) cap.progress = Math.min(1, cap.progress + dt * 0.04);

      // Crystallizing nodes settle logarithmically
      for (const node of nodesRef.current) {
        if (node.crystallizing !== undefined && node.crystallizing < 1) {
          node.crystallizing = Math.min(1, node.crystallizing + dt * 0.045);
        }
      }

      // Field physics never stops
      const stepped = stepPhysics(nodesRef.current, filamentsRef.current, energyRef.current, dt);
      // copy positions/velocities/luminosity back (preserve object identity for refs)
      for (let i = 0; i < stepped.length; i++) {
        nodesRef.current[i].position = stepped[i].position;
        nodesRef.current[i].velocity = stepped[i].velocity;
        nodesRef.current[i].luminosity = stepped[i].luminosity;
      }

      // Surfacing adjustment applied gradually
      const adj = pendingAdjustRef.current;
      if (adj) {
        const p = (Date.now() - adj.startedAt) / adj.durationMs;
        applyAdjustment(nodesRef.current, filamentsRef.current, adj, p);
        if (p >= 1) pendingAdjustRef.current = null;
      }

      // Energy relaxes back to drift over time
      if (energyRef.current === "turbulence" && Date.now() - lastActivityRef.current > 2500) {
        energyRef.current = "drift";
      }

      voidGlow.material.opacity = 0.2 + Math.sin(now * 0.0006) * 0.06;
      updateThread(now);
      syncScene();
      renderer.render(scene, camera);
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

    function onPointerUp(e: PointerEvent) {
      const node = dragId ? nodesRef.current.find((x) => x.id === dragId) : null;
      if (node && moved) {
        // Fuse if released onto another node → synthesis.
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
        1400
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
      // reinforce its filaments
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

      // Process unprocessed thoughts ~4s after activity settles.
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

      // Surfacing: 90s of stillness, one call per window.
      if (idle > 90000 && !pendingAdjustRef.current && unprocessedRef.current.size === 0) {
        lastActivityRef.current = Date.now(); // throttle to one call per window
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
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.nodes)) {
          nodesRef.current = data.nodes.map((n: ThoughtNode) => ({ ...n, crystallizing: 1 }));
          filamentsRef.current = data.filaments || [];
        }
      })
      .catch(() => {});

    // expose capture starters to React handlers
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
      renderer.dispose();
      glowTex.dispose();
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

  // Orb click: toggle voice if available, otherwise open typed capture.
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
    // Once voice has failed (no mic / no access), go straight to typing.
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

      {/* Faint state cue — legible without breaking the stillness */}
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
