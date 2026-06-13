import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export interface FieldComposer {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  setSize: (w: number, h: number) => void;
  render: () => void;
}

/**
 * Bloom-based glow pipeline. This is what gives filaments and nodes their
 * luminous, "lit-from-within" quality — the single biggest leap toward the
 * real-mycelium look.
 */
export function createFieldComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number
): FieldComposer {
  const composer = new EffectComposer(renderer);
  composer.setSize(width, height);

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    1.15, // strength
    0.72, // radius
    0.0 // threshold — let even faint hyphae bloom a touch
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  return {
    composer,
    bloom,
    setSize: (w, h) => {
      composer.setSize(w, h);
      bloom.setSize(w, h);
    },
    render: () => composer.render(),
  };
}
