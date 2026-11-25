import { getApp, getApps, initializeApp } from "firebase/app";

import firebaseConfig from "../../firebase-applet-config.json";
import {
  detectDevicePlatform,
  normalizePermissionState,
  type PermissionStateValue,
} from "./permissions";

export type NotificationPreferences = {
  pushEnabled: boolean;
  messagePreview: boolean;
  callAlerts: boolean;
  quietHoursEnabled: boolean;
  updatedAt?: string | null;
};

export type PushRegistrationStatus = {
  browserSupported: boolean;
  permission: PermissionStateValue;
  vapidConfigured: boolean;
  fcmServerConfigured: boolean;
  registeredDevices: number;
  activeToken: string | null;
  limitationNote: string | null;
};

const ACTIVE_TOKEN_KEY = "rc_fcm_device_token";

export function getVapidKey(): string | null {
  const raw =
    typeof import.meta !== "undefined" && import.meta.env
      ? (import.meta.env["VITE_FIREBASE_VAPID_KEY"] as string | undefined)
      : undefined;
  const trimmed = raw?.trim();
  if (!trimmed || /^(?:MY_|YOUR_|<|\[|placeholder|unset|none|null)/i.test(trimmed)) {
    return null;
  }
  return /^[A-Za-z0-9_-]{60,}$/.test(trimmed) ? trimmed : null;
}

export async function isWebPushSupported(): Promise<boolean> {
  if (
    typeof window === "undefined" ||
    typeof Notification === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return false;
  }
  try {
    const messagingMod = await import("firebase/messaging");
    return await messagingMod.isSupported();
  } catch {
    return false;
  }
}

export function getNotificationPermissionState(): PermissionStateValue {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  return normalizePermissionState(Notification.permission);
}

export function getLimitationMessage(input: {
  browserSupported: boolean;
  permission: PermissionStateValue;
  vapidConfigured: boolean;
  fcmServerConfigured: boolean;
}): string | null {
  if (!input.browserSupported) {
    const platform = detectDevicePlatform();
    if (platform === "ios") {
      return "Background Web Push requires iOS 16.4+ installed to the Home Screen. In-app instant alerts remain active while open.";
    }
    return "Web Push notifications are not supported in this browser. In-app live message alerts remain active.";
  }
  if (input.permission === "denied") {
    return "Notifications are blocked in browser settings. Enable notifications in site settings to receive background alerts.";
  }
  if (!input.vapidConfigured) {
    return "Set VITE_FIREBASE_VAPID_KEY to enable background FCM device tokens. Live in-app WebSocket alerts still work without it.";
  }
  if (!input.fcmServerConfigured) {
    return "Device alerts are ready; configure server FIREBASE_SERVICE_ACCOUNT for closed-app FCM push dispatch.";
  }
  return null;
}

export async function fetchPushDiagnostics(): Promise<PushRegistrationStatus> {
  const browserSupported = await isWebPushSupported();
  const permission = getNotificationPermissionState();
  const vapidConfigured = Boolean(getVapidKey());

  let fcmServerConfigured = false;
  let registeredDevices = 0;
  try {
    const res = await fetch("/api/notifications/status", { credentials: "include" });
    if (res.ok) {
      const data = (await res.json()) as {
        fcmServerConfigured?: boolean;
        registeredDevices?: number;
      };
      fcmServerConfigured = Boolean(data.fcmServerConfigured);
      registeredDevices = Number(data.registeredDevices ?? 0);
    }
  } catch {
    /* ignore */
  }

  let activeToken: string | null = null;
  try {
    activeToken = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_TOKEN_KEY) : null;
  } catch {
    activeToken = null;
  }

  return {
    browserSupported,
    permission,
    vapidConfigured,
    fcmServerConfigured,
    registeredDevices,
    activeToken,
    limitationNote: getLimitationMessage({
      browserSupported,
      permission,
      vapidConfigured,
      fcmServerConfigured,
    }),
  };
}

export async function registerDevicePushToken(authHeaders: Record<string, string> = {}): Promise<{
  ok: boolean;
  token?: string;
  reason?: string;
}> {
  if (typeof window === "undefined") {
    return { ok: false, reason: "Push registration requires a browser environment." };
  }
  const supported = await isWebPushSupported();
  if (!supported) {
    return {
      ok: false,
      reason: getLimitationMessage({
        browserSupported: false,
        permission: getNotificationPermissionState(),
        vapidConfigured: Boolean(getVapidKey()),
        fcmServerConfigured: false,
      })!,
    };
  }

  let perm = Notification.permission;
  if (perm === "default") {
    perm = await Notification.requestPermission();
  }
  if (perm !== "granted") {
    return {
      ok: false,
      reason: "Notification permission was not granted. In-app message banners remain active.",
    };
  }

  const vapidKey = getVapidKey();
  if (!vapidKey) {
    return {
      ok: false,
      reason: "VITE_FIREBASE_VAPID_KEY is not configured yet for FCM web push tokens.",
    };
  }

  try {
    const registration = await navigator.serviceWorker.register("/reader-sw.js");
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const messagingMod = await import("firebase/messaging");
    const messaging = messagingMod.getMessaging(app);
    const token = await messagingMod.getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) {
      return { ok: false, reason: "Could not obtain a push token from Firebase Messaging." };
    }

    const platform = detectDevicePlatform();
    const res = await fetch("/api/notifications/token", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ token, platform }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, reason: err.error || "Failed to save notification token." };
    }

    try {
      localStorage.setItem(ACTIVE_TOKEN_KEY, token);
    } catch {
      /* ignore storage failure */
    }
    return { ok: true, token };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not enable Web Push notifications.",
    };
  }
}

export async function unregisterDevicePushToken(
  authHeaders: Record<string, string> = {},
): Promise<void> {
  let token: string | null = null;
  try {
    token = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_TOKEN_KEY) : null;
    if (typeof window !== "undefined") {
      localStorage.removeItem(ACTIVE_TOKEN_KEY);
    }
  } catch {
    token = null;
  }

  try {
    await fetch("/api/notifications/token", {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(token ? { token } : {}),
    });
  } catch {
    /* ignore */
  }
}

export async function getNotificationPreferences(
  authHeaders: Record<string, string> = {},
): Promise<NotificationPreferences> {
  try {
    const res = await fetch("/api/notifications/preferences", {
      credentials: "include",
      headers: authHeaders,
    });
    if (res.ok) {
      return (await res.json()) as NotificationPreferences;
    }
  } catch {
    /* ignore */
  }
  return {
    pushEnabled: true,
    messagePreview: true,
    callAlerts: true,
    quietHoursEnabled: false,
    updatedAt: null,
  };
}

export async function updateNotificationPreferences(
  patch: Partial<NotificationPreferences>,
  authHeaders: Record<string, string> = {},
): Promise<NotificationPreferences | null> {
  try {
    const res = await fetch("/api/notifications/preferences", {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    return (await res.json()) as NotificationPreferences;
  } catch {
    return null;
  }
}
