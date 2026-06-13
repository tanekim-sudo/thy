import type { Prosody } from "@/lib/types";
import { ProsodyAnalyzer } from "./prosody";
import { startMicTap, type AudioTap } from "./audio";
import { DeepgramEngine } from "./deepgram";
import { WhisperCppEngine } from "./whisper";
import type { TranscriptionEngine, TranscriberCallbacks } from "./types";

export type { TranscriberCallbacks } from "./types";

export type EngineId = "deepgram" | "whisper";

/**
 * The single switch for the whisper.cpp migration. Flip this (or set
 * NEXT_PUBLIC_TRANSCRIPTION_ENGINE=whisper) and nothing else in the codebase
 * needs to change — the field consumes the same Transcriber either way.
 */
export const ACTIVE_ENGINE: EngineId =
  (process.env.NEXT_PUBLIC_TRANSCRIPTION_ENGINE as EngineId) || "deepgram";

export function createEngine(id: EngineId = ACTIVE_ENGINE): TranscriptionEngine {
  switch (id) {
    case "whisper":
      return new WhisperCppEngine();
    default:
      return new DeepgramEngine();
  }
}

/**
 * transcribe(audioStream) — the abstraction the whole product sits behind.
 *
 * Owns the local pieces (mic capture, waveform prosody) and delegates only the
 * speech-to-text step to a swappable engine. Prosody is ALWAYS computed locally
 * from the raw waveform, independent of which engine transcribes: how a thought
 * was spoken is captured even though, eventually, what was said never leaves the
 * device.
 */
export class Transcriber {
  private engine: TranscriptionEngine | null = null;
  private tap: AudioTap | null = null;
  private prosody = new ProsodyAnalyzer();
  private active = false;
  private turnOpen = false;

  constructor(private cb: TranscriberCallbacks) {}

  get listening() {
    return this.active;
  }

  get engineId(): EngineId {
    return ACTIVE_ENGINE;
  }

  async start(): Promise<boolean> {
    const engine = createEngine();
    const ready = await engine.init({
      onTurnStart: () => {
        this.turnOpen = true;
        this.prosody.beginTurn();
      },
      onPartial: (t) => {
        if (!this.turnOpen) {
          this.turnOpen = true;
          this.prosody.beginTurn();
        }
        this.cb.onPartial(t);
      },
      onTurnEnd: (t, eot) => this.finalizeTurn(t, eot),
      onError: (m) => this.cb.onError?.(m),
    });

    if (!ready) {
      engine.close();
      return false;
    }
    this.engine = engine;

    try {
      this.tap = await startMicTap((float32, _rate, pcm16) => {
        this.prosody.push(float32);
        this.engine?.pushAudio(pcm16);
      });
    } catch {
      this.cb.onError?.("mic_denied");
      engine.close();
      this.engine = null;
      return false;
    }

    this.active = true;
    this.prosody.beginTurn();
    this.cb.onStateChange?.(true);
    return true;
  }

  private finalizeTurn(text: string, eot: number) {
    const snap = this.prosody.endTurn();
    this.turnOpen = false;
    this.prosody.beginTurn();

    const trimmed = text.trim();
    if (!trimmed) return;

    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    const prosody: Prosody = {
      pace: Number((wordCount / snap.durationSec).toFixed(2)),
      pauses: snap.pauses,
      confidence: Number(Math.max(0, Math.min(1, eot || snap.voicedRatio)).toFixed(3)),
      trailingOff: snap.trailingOff,
    };

    this.cb.onFinal(trimmed, prosody);
  }

  stop() {
    this.engine?.finish();
    this.tap?.stop();
    this.engine?.close();
    this.tap = null;
    this.engine = null;
    this.active = false;
    this.turnOpen = false;
    this.cb.onStateChange?.(false);
  }
}
