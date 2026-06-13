/**
 * Local prosody analysis — computed from the raw audio waveform, before and
 * independently of transcription. How a thought was spoken is part of what the
 * thought is. This layer never depends on which engine does the transcribing,
 * so it survives the eventual whisper.cpp migration unchanged.
 *
 * Everything here is derived from signal energy over time:
 *   pace        — articulation speed (words/sec, filled by the facade)
 *   pauses      — silence gaps within an utterance
 *   trailingOff — the utterance fading out rather than landing
 *   voicedRatio — how much of the turn carried voice
 */

export interface ProsodySnapshot {
  pauses: number[];
  trailingOff: boolean;
  voicedRatio: number;
  durationSec: number;
  peakRms: number;
}

const SILENCE_RMS = 0.012;
const MIN_PAUSE_MS = 220;
const TAIL_WINDOW_MS = 450;

export class ProsodyAnalyzer {
  private envelope: { t: number; rms: number }[] = [];
  private turnStart = 0;
  private silenceStart = 0;

  beginTurn(now = performance.now()) {
    this.turnStart = now;
    this.silenceStart = 0;
    this.envelope = [];
  }

  /** Push one frame of mono float samples (any sample rate). */
  push(frame: Float32Array, now = performance.now()) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / Math.max(1, frame.length));

    this.envelope.push({ t: now, rms });
    if (this.envelope.length > 6000) this.envelope.shift();

    if (rms >= SILENCE_RMS) {
      if (this.silenceStart) {
        const gap = now - this.silenceStart;
        if (gap >= MIN_PAUSE_MS) this.pauses.push(Math.round(gap));
        this.silenceStart = 0;
      }
    } else if (!this.silenceStart) {
      this.silenceStart = now;
    }
  }

  private pauses: number[] = [];

  endTurn(now = performance.now()): ProsodySnapshot {
    const durationSec = Math.max(0.001, (now - this.turnStart) / 1000);
    const peakRms = this.envelope.reduce((m, e) => Math.max(m, e.rms), 0) || 1;
    const voicedFrames = this.envelope.filter((e) => e.rms >= SILENCE_RMS).length;
    const voicedRatio = this.envelope.length ? voicedFrames / this.envelope.length : 0;

    // Trailing-off: the final window is quiet relative to the peak and falling.
    const tail = this.envelope.filter((e) => e.t >= now - TAIL_WINDOW_MS);
    let trailingOff = false;
    if (tail.length >= 3) {
      const first = tail[0].rms;
      const last = tail[tail.length - 1].rms;
      const tailMean = tail.reduce((s, e) => s + e.rms, 0) / tail.length;
      trailingOff = last < first && tailMean < peakRms * 0.45;
    }

    const snapshot: ProsodySnapshot = {
      pauses: this.pauses.slice(),
      trailingOff,
      voicedRatio: Number(voicedRatio.toFixed(2)),
      durationSec: Number(durationSec.toFixed(2)),
      peakRms: Number(peakRms.toFixed(4)),
    };
    this.pauses = [];
    return snapshot;
  }
}
