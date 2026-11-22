export const MESSAGE_VIBRATION_PATTERN: number[] = [160, 80, 160];
export const CALL_RING_VIBRATION_PATTERN: number[] = [500, 220, 500, 750];
const VIBRATION_STORAGE_KEY = "rc_vibration_enabled_v1";

export function isVibrationEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(VIBRATION_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setVibrationEnabled(enabled: boolean): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(VIBRATION_STORAGE_KEY, String(enabled));
    } catch {
      /* ignore storage errors */
    }
  }
  if (!enabled) {
    stopVibration();
  }
}

export function buildIncomingCallAlertPayload(input: {
  senderName: string;
  callType: "audio" | "video";
}) {
  const cleanName = input.senderName.trim() || "Someone";
  const label = input.callType === "video" ? "video call" : "audio call";
  return {
    title: "Reading Corner",
    body: `Incoming ${label} from ${cleanName}. Open the app to receive or decline.`,
    vibratePattern: [...CALL_RING_VIBRATION_PATTERN],
    tag: "rc-incoming-call",
  };
}

export function buildIncomingMessageAlertPayload(input: {
  senderName: string;
  text?: string | null | undefined;
  mediaKind?: string | null | undefined;
}) {
  const cleanName = input.senderName.trim() || "New message";
  const cleanText = input.text?.trim();
  const preview = cleanText
    ? cleanText.slice(0, 120)
    : input.mediaKind
      ? `Sent a ${input.mediaKind}`
      : "Sent a message";
  return {
    title: "Reading Corner",
    body: `New message from ${cleanName}: ${preview}`.slice(0, 160),
    vibratePattern: [...MESSAGE_VIBRATION_PATTERN],
    tag: `rc-msg-${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  };
}

export function triggerVibration(pattern: number | number[]): boolean {
  if (!isVibrationEnabled()) return false;
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return false;
  }
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

export function stopVibration(): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  try {
    navigator.vibrate(0);
  } catch {
    /* ignore unsupported vibrate stop */
  }
}

let ringAudioCtx: AudioContext | null = null;

export function playIncomingRingtone(soundEnabled: boolean): void {
  if (!soundEnabled || typeof window === "undefined") return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    if (!ringAudioCtx || ringAudioCtx.state === "closed") {
      ringAudioCtx = new AudioCtx();
    }
    if (ringAudioCtx.state === "suspended") {
      void ringAudioCtx.resume().catch(() => {});
    }
    const ctx = ringAudioCtx;
    const now = ctx.currentTime;

    const notes = [
      { start: 0, freq: 659.25, dur: 0.22 },
      { start: 0.24, freq: 880, dur: 0.26 },
      { start: 0.56, freq: 659.25, dur: 0.22 },
      { start: 0.8, freq: 880, dur: 0.3 },
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(n.freq, now + n.start);
      gain.gain.setValueAtTime(0.0001, now + n.start);
      gain.gain.linearRampToValueAtTime(0.08, now + n.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.02);
    }
  } catch {
    /* ignore blocked autoplay AudioContext */
  }
}

export function showSystemNotification(input: {
  title: string;
  body: string;
  tag?: string | undefined;
  requireInteraction?: boolean | undefined;
  onClick?: (() => void) | undefined;
}): Notification | null {
  if (
    typeof window === "undefined" ||
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return null;
  }
  try {
    const notification = new Notification(input.title, {
      body: input.body,
      ...(input.tag ? { tag: input.tag } : {}),
      icon: "/reader-180.png",
      badge: "/reader-180.png",
      requireInteraction: Boolean(input.requireInteraction),
    });
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        /* ignore focus restriction */
      }
      notification.close();
      input.onClick?.();
    };
    return notification;
  } catch {
    return null;
  }
}
