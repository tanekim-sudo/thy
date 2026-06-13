import type { Prosody } from "@/lib/types";

/**
 * The transcription abstraction. The entire product sits behind this.
 *
 * Today a network engine (Deepgram) answers; the eventual architecture swaps in
 * whisper.cpp running fully on-device — at which point a spoken thought never
 * touches any server at any point, not even transiently. Nothing else in the
 * codebase changes when that swap happens.
 *
 * Turn boundaries (StartOfTurn / EndOfTurn) are owned by the engine. A thought
 * crystallizes on the engine's EndOfTurn — the natural end of an utterance —
 * not on an arbitrary client timer.
 */
export interface EngineCallbacks {
  onPartial: (turnText: string) => void;
  onTurnStart?: () => void;
  onTurnEnd: (turnText: string, eotConfidence: number) => void;
  onError: (message: string) => void;
  onOpen?: () => void;
}

export interface TranscriptionEngine {
  readonly id: string;
  /** Open the engine (connection / model load). Returns false if unavailable. */
  init(cb: EngineCallbacks): Promise<boolean>;
  /** Feed one frame of 16 kHz mono signed-16-bit PCM. */
  pushAudio(pcm16: Int16Array): void;
  /** Signal end of the audio stream. */
  finish(): void;
  /** Tear down. */
  close(): void;
}

/** What the field consumes. Engine-agnostic. */
export interface TranscriberCallbacks {
  onPartial: (text: string) => void;
  onFinal: (text: string, prosody: Prosody) => void;
  onError?: (message: string) => void;
  onStateChange?: (listening: boolean) => void;
}
