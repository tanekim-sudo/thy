import type { EngineCallbacks, TranscriptionEngine } from "./types";

/**
 * Deepgram v2 "flux" engine. Flux performs server-side turn detection and
 * reports StartOfTurn / EndOfTurn with an end-of-turn confidence — a natural
 * fit for crystallization (a thought lands when the utterance ends).
 *
 * Audio is sent as raw 16 kHz mono linear16 PCM. The browser cannot set
 * Authorization headers on a WebSocket, so the key is passed via the
 * Sec-WebSocket-Protocol "token" sub-protocol, served from /api/deepgram/token.
 *
 * This is a network engine and exists only until whisper.cpp is fast enough
 * on-device. It lives entirely behind the TranscriptionEngine interface.
 */
const FLUX_URL =
  "wss://api.deepgram.com/v2/listen" +
  "?model=flux-general-en&encoding=linear16&sample_rate=16000" +
  "&eot_threshold=0.7&eot_timeout_ms=5000";

export class DeepgramEngine implements TranscriptionEngine {
  readonly id = "deepgram";
  private ws: WebSocket | null = null;
  private cb: EngineCallbacks | null = null;
  private currentText = "";

  async init(cb: EngineCallbacks): Promise<boolean> {
    this.cb = cb;

    let key: string | undefined;
    try {
      const res = await fetch("/api/deepgram/token");
      const data = await res.json();
      if (!data.available || !data.key) return false;
      key = data.key as string;
    } catch {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      try {
        const ws = new WebSocket(FLUX_URL, ["token", key!]);
        ws.binaryType = "arraybuffer";
        this.ws = ws;
        const timeout = setTimeout(() => resolve(false), 6000);
        ws.onopen = () => {
          clearTimeout(timeout);
          cb.onOpen?.();
          resolve(true);
        };
        ws.onmessage = (e) => this.handle(e);
        ws.onerror = () => cb.onError("voice_socket_error");
        ws.onclose = () => {};
      } catch {
        resolve(false);
      }
    });
  }

  private handle(e: MessageEvent) {
    if (typeof e.data !== "string") return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }

    const event = (msg.event as string) || (msg.type as string) || "";
    const transcript = typeof msg.transcript === "string" ? (msg.transcript as string) : "";

    if (event === "StartOfTurn") {
      this.currentText = "";
      this.cb?.onTurnStart?.();
    }

    if (transcript) {
      this.currentText = transcript;
      this.cb?.onPartial(transcript);
    }

    if (event === "EndOfTurn") {
      const text = transcript || this.currentText;
      const eot =
        typeof msg.end_of_turn_confidence === "number"
          ? (msg.end_of_turn_confidence as number)
          : 0;
      this.cb?.onTurnEnd(text, eot);
      this.currentText = "";
    }
  }

  pushAudio(pcm16: Int16Array) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        pcm16.buffer.slice(pcm16.byteOffset, pcm16.byteOffset + pcm16.byteLength)
      );
    }
  }

  finish() {
    try {
      this.ws?.send(JSON.stringify({ type: "CloseStream" }));
    } catch {
      /* noop */
    }
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* noop */
    }
    this.ws = null;
    this.cb = null;
  }
}
