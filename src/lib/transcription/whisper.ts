import type { EngineCallbacks, TranscriptionEngine } from "./types";

/**
 * The eventual architecture: whisper.cpp running entirely on-device.
 *
 * When this engine is active, a spoken thought never touches any server at any
 * point — not even transiently. The rawest, most unguarded version of someone's
 * thinking stays on their machine. That is the only setup consistent with what
 * this product asks people to trust it with.
 *
 * Implementation plan (swap-in, no other code changes):
 *   - Web build: load a whisper.cpp WASM module (streaming-capable build),
 *     feed the same 16 kHz PCM16 frames into a ring buffer, run inference.
 *   - Native build (Tauri / Capacitor): bind to the native whisper.cpp binary
 *     and stream frames over the bridge.
 *   - Turn detection moves client-side: local voice-activity detection emits
 *     StartOfTurn / EndOfTurn, mirroring the events this interface expects.
 *
 * Prosody is already computed locally and independently (see prosody.ts), so it
 * needs no change when this engine goes live.
 */
export class WhisperCppEngine implements TranscriptionEngine {
  readonly id = "whisper";

  async init(_cb: EngineCallbacks): Promise<boolean> {
    console.info(
      "[transcription] on-device whisper.cpp engine is not wired yet — falling back."
    );
    return false;
  }

  pushAudio(_pcm16: Int16Array): void {
    /* buffered for inference once the model is wired */
  }

  finish(): void {}

  close(): void {}
}
