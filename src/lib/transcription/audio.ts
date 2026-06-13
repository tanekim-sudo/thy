/**
 * Microphone capture → 16 kHz mono PCM16, plus the raw float frames for local
 * prosody analysis. The same audio feeds both the prosody analyzer and the
 * transcription engine; with whisper.cpp on-device, this audio never leaves the
 * machine at all.
 *
 * Uses ScriptProcessorNode for broad compatibility. (Migration note: move to an
 * AudioWorklet for off-main-thread processing when convenient.)
 */

export interface AudioTap {
  sampleRate: number;
  stop(): void;
}

export type FrameHandler = (
  float32: Float32Array,
  srcRate: number,
  pcm16_16k: Int16Array
) => void;

export async function startMicTap(onFrame: FrameHandler): Promise<AudioTap> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });

  const Ctx: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  await ctx.resume();

  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  source.connect(processor);
  processor.connect(ctx.destination);

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input); // input buffer is reused — copy it
    const pcm = downsampleTo16k(copy, ctx.sampleRate);
    onFrame(copy, ctx.sampleRate, pcm);
  };

  return {
    sampleRate: ctx.sampleRate,
    stop() {
      try {
        processor.onaudioprocess = null;
        processor.disconnect();
        source.disconnect();
      } catch {
        /* noop */
      }
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    },
  };
}

function downsampleTo16k(input: Float32Array, inRate: number): Int16Array {
  if (inRate === 16000) return floatToInt16(input);
  const ratio = inRate / 16000;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const frac = idx - i0;
    const s = input[i0] * (1 - frac) + (input[i0 + 1] ?? input[i0]) * frac;
    out[i] = clamp16(s);
  }
  return out;
}

function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = clamp16(input[i]);
  return out;
}

function clamp16(s: number): number {
  const v = Math.max(-1, Math.min(1, s));
  return v < 0 ? v * 0x8000 : v * 0x7fff;
}
