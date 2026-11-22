export type AppPermissionKind = "microphone" | "camera" | "notifications";

export type AppPermissionState = "granted" | "denied" | "prompt" | "unsupported";

export type PermissionSnapshot = Record<AppPermissionKind, AppPermissionState>;

export const APP_PERMISSION_ITEMS: ReadonlyArray<{
  kind: AppPermissionKind;
  title: string;
  description: string;
}> = [
  {
    kind: "microphone",
    title: "Microphone",
    description: "Required for voice notes, audio calls, and video calls in chat.",
  },
  {
    kind: "camera",
    title: "Camera",
    description: "Required for live video calls and capturing photos or videos.",
  },
  {
    kind: "notifications",
    title: "Notifications",
    description: "Alerts you for incoming calls and real-time direct messages.",
  },
];

const STARTUP_PROMPTED_KEY = "rc_permissions_prompted_v1";

export function normalizePermissionState(raw: string | null | undefined): AppPermissionState {
  if (raw === "granted") return "granted";
  if (raw === "denied") return "denied";
  if (raw === "prompt" || raw === "default") return "prompt";
  return "unsupported";
}

export function shouldShowStartupPermissions(
  snapshot: PermissionSnapshot,
  alreadyPrompted: boolean,
): boolean {
  if (alreadyPrompted) return false;
  return (
    snapshot.microphone === "prompt" ||
    snapshot.camera === "prompt" ||
    snapshot.notifications === "prompt"
  );
}

export function countGrantedPermissions(snapshot: PermissionSnapshot): number {
  return APP_PERMISSION_ITEMS.reduce(
    (count, item) => count + (snapshot[item.kind] === "granted" ? 1 : 0),
    0,
  );
}

export function hasPromptedStartupPermissions(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STARTUP_PROMPTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markStartupPermissionsPrompted(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STARTUP_PROMPTED_KEY, "1");
  } catch {
    /* ignore storage failures */
  }
}

async function queryBrowserMediaPermission(
  name: "microphone" | "camera",
): Promise<AppPermissionState> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "unsupported";
  }
  if (!navigator.permissions?.query) {
    return "prompt";
  }
  try {
    const status = await navigator.permissions.query({ name: name as PermissionName });
    return normalizePermissionState(status.state);
  } catch {
    return "prompt";
  }
}

function queryNotificationPermission(): AppPermissionState {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  return normalizePermissionState(Notification.permission);
}

export async function queryAllAppPermissions(): Promise<PermissionSnapshot> {
  const [microphone, camera] = await Promise.all([
    queryBrowserMediaPermission("microphone"),
    queryBrowserMediaPermission("camera"),
  ]);
  const notifications = queryNotificationPermission();
  return { microphone, camera, notifications };
}

function stopMediaStream(stream: MediaStream | null | undefined) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* ignore track stop failures */
    }
  }
}

export async function requestSingleAppPermission(
  kind: AppPermissionKind,
): Promise<AppPermissionState> {
  if (kind === "notifications") {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      return "unsupported";
    }
    try {
      const result = await Notification.requestPermission();
      return normalizePermissionState(result);
    } catch {
      return queryNotificationPermission();
    }
  }

  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "unsupported";
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia(
      kind === "microphone" ? { audio: true } : { video: true },
    );
    stopMediaStream(stream);
    return "granted";
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return "denied";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "unsupported";
    }
    return queryBrowserMediaPermission(kind);
  }
}

export async function requestAllAppPermissions(): Promise<PermissionSnapshot> {
  let microphone: AppPermissionState = "unsupported";
  let camera: AppPermissionState = "unsupported";

  if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
    try {
      const combined = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stopMediaStream(combined);
      microphone = "granted";
      camera = "granted";
    } catch {
      // Request audio and video separately so one missing or denied device doesn't block the other.
      microphone = await requestSingleAppPermission("microphone");
      camera = await requestSingleAppPermission("camera");
    }
  }

  const notifications = await requestSingleAppPermission("notifications");
  return { microphone, camera, notifications };
}
