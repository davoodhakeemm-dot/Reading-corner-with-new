export type WaterSoundKind = "droplet" | "pop" | "ripple";

export type WaterDropletParams = {
  startFreqHz: number;
  endFreqHz: number;
  harmonicFreqHz: number;
  durationSec: number;
  peakGain: number;
  filterFreqHz: number;
};

export type WaterRippleGeometry = {
  x: number;
  y: number;
  diameter: number;
};

export function isSoundAllowed(enabled: boolean): boolean {
  return enabled === true;
}

export function computeDropletParams(kind: WaterSoundKind): WaterDropletParams {
  switch (kind) {
    case "pop":
      return {
        startFreqHz: 420,
        endFreqHz: 1120,
        harmonicFreqHz: 1680,
        durationSec: 0.16,
        peakGain: 0.09,
        filterFreqHz: 2400,
      };
    case "ripple":
      return {
        startFreqHz: 540,
        endFreqHz: 1380,
        harmonicFreqHz: 2040,
        durationSec: 0.24,
        peakGain: 0.085,
        filterFreqHz: 2800,
      };
    case "droplet":
    default:
      return {
        startFreqHz: 360,
        endFreqHz: 980,
        harmonicFreqHz: 1470,
        durationSec: 0.19,
        peakGain: 0.1,
        filterFreqHz: 2200,
      };
  }
}

export function computeWaterRippleGeometry(
  rect: { left: number; top: number; width: number; height: number },
  clientX?: number,
  clientY?: number,
): WaterRippleGeometry {
  const width = Math.max(24, rect.width || 0);
  const height = Math.max(24, rect.height || 0);
  const hasPointer =
    typeof clientX === "number" &&
    typeof clientY === "number" &&
    Number.isFinite(clientX) &&
    Number.isFinite(clientY) &&
    (clientX !== 0 || clientY !== 0);

  const x = hasPointer ? Math.min(width, Math.max(0, clientX - rect.left)) : width / 2;
  const y = hasPointer ? Math.min(height, Math.max(0, clientY - rect.top)) : height / 2;
  const maxDistX = Math.max(x, width - x);
  const maxDistY = Math.max(y, height - y);
  const diameter = Math.ceil(Math.hypot(maxDistX, maxDistY) * 2.15);

  return { x, y, diameter };
}

let sharedAudioCtx: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === "suspended") {
    void sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

/**
 * Synthesizes a clean liquid water-droplet / bubble sound with Web Audio API.
 * Uses no external audio files and fails silently if audio is blocked or muted.
 */
export function playWaterSound(kind: WaterSoundKind = "droplet", enabled = true): void {
  if (!isSoundAllowed(enabled) || typeof window === "undefined") return;
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;

    const params = computeDropletParams(kind);
    const now = ctx.currentTime;

    // Low-pass filter gives the tone a rounded underwater resonance
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(params.filterFreqHz, now);
    filter.Q.setValueAtTime(3.2, now);
    filter.connect(ctx.destination);

    // Primary pitch-swept water droplet oscillator
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(params.startFreqHz, now);
    osc.frequency.exponentialRampToValueAtTime(params.endFreqHz, now + params.durationSec * 0.55);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(params.peakGain, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + params.durationSec);

    osc.connect(gain);
    gain.connect(filter);
    osc.start(now);
    osc.stop(now + params.durationSec + 0.02);

    // Secondary bubble shimmer echo
    const bubbleOsc = ctx.createOscillator();
    const bubbleGain = ctx.createGain();
    const bubbleStart = now + 0.032;
    bubbleOsc.type = "sine";
    bubbleOsc.frequency.setValueAtTime(params.endFreqHz * 0.85, bubbleStart);
    bubbleOsc.frequency.exponentialRampToValueAtTime(
      params.harmonicFreqHz,
      bubbleStart + params.durationSec * 0.6,
    );

    bubbleGain.gain.setValueAtTime(0.0001, bubbleStart);
    bubbleGain.gain.linearRampToValueAtTime(params.peakGain * 0.42, bubbleStart + 0.014);
    bubbleGain.gain.exponentialRampToValueAtTime(0.0001, bubbleStart + params.durationSec * 0.72);

    bubbleOsc.connect(bubbleGain);
    bubbleGain.connect(filter);
    bubbleOsc.start(bubbleStart);
    bubbleOsc.stop(bubbleStart + params.durationSec * 0.78);
  } catch {
    /* ignore blocked audio context before gesture */
  }
}
