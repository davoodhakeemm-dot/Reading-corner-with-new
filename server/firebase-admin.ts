import fs from "node:fs";
import path from "node:path";
import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

import { readConfiguredEnv } from "./db";

let cachedApp: App | null = null;
let serviceAccountConfigured = false;

function loadServiceAccountFromEnv(): Record<string, unknown> | null {
  const raw = readConfiguredEnv("FIREBASE_SERVICE_ACCOUNT");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed["project_id"] === "string" &&
      typeof parsed["client_email"] === "string" &&
      typeof parsed["private_key"] === "string"
    ) {
      return parsed;
    }
  } catch {
    /* invalid JSON in FIREBASE_SERVICE_ACCOUNT */
  }
  return null;
}

function readConfiguredProjectId(): string {
  try {
    const cfgPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as { projectId?: string };
    if (cfg.projectId) return cfg.projectId;
  } catch {
    /* ignore missing file */
  }
  return (
    readConfiguredEnv("GOOGLE_CLOUD_PROJECT") || readConfiguredEnv("FIREBASE_PROJECT_ID") || ""
  );
}

export function getFirebaseAdminApp(): App {
  if (cachedApp) return cachedApp;
  if (getApps().length > 0) {
    cachedApp = getApp();
    serviceAccountConfigured = Boolean(
      loadServiceAccountFromEnv() || readConfiguredEnv("GOOGLE_APPLICATION_CREDENTIALS"),
    );
    return cachedApp;
  }

  const serviceAccount = loadServiceAccountFromEnv();
  const projectId =
    (typeof serviceAccount?.["project_id"] === "string" ? serviceAccount["project_id"] : "") ||
    readConfiguredProjectId();

  if (serviceAccount) {
    serviceAccountConfigured = true;
    cachedApp = initializeApp({
      credential: cert(serviceAccount as Parameters<typeof cert>[0]),
      ...(projectId ? { projectId } : {}),
    });
  } else {
    serviceAccountConfigured = Boolean(readConfiguredEnv("GOOGLE_APPLICATION_CREDENTIALS"));
    cachedApp = initializeApp(projectId ? { projectId } : undefined);
  }
  return cachedApp;
}

export function getFirebaseAdminAuth(): Auth {
  return getAuth(getFirebaseAdminApp());
}

export function isFcmServerPushConfigured(): boolean {
  getFirebaseAdminApp();
  return serviceAccountConfigured;
}

export function getFirebaseAdminMessaging(): Messaging | null {
  if (!isFcmServerPushConfigured()) return null;
  try {
    return getMessaging(getFirebaseAdminApp());
  } catch {
    return null;
  }
}
