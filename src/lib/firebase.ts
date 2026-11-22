import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  type Auth,
} from "firebase/auth";
import { doc, getDocFromServer, getFirestore, type Firestore } from "firebase/firestore";

import firebaseConfig from "../../firebase-applet-config.json";
import { isFirebaseOfflineError } from "./social-logic";

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

function getFirebaseApp(): FirebaseApp {
  if (!appInstance) {
    appInstance = getApps().length ? getApp() : initializeApp(firebaseConfig);
  }
  return appInstance;
}

export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    const app = getFirebaseApp();
    authInstance = getAuth(app);
    if (typeof window !== "undefined") {
      void setPersistence(authInstance, browserLocalPersistence).catch(() => {});
    }
  }
  return authInstance;
}

export function getFirebaseDb(): Firestore {
  if (!dbInstance) {
    const app = getFirebaseApp();
    dbInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
  return dbInstance;
}

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const currentUser = typeof window !== "undefined" ? getFirebaseAuth().currentUser : null;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) ?? [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error:", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

let testedConnection = false;
export async function testFirestoreConnection(): Promise<void> {
  if (testedConnection || typeof window === "undefined") return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    window.addEventListener(
      "online",
      () => {
        void testFirestoreConnection();
      },
      { once: true },
    );
    return;
  }
  testedConnection = true;
  try {
    const db = getFirebaseDb();
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (isFirebaseOfflineError(error)) {
      testedConnection = false;
      window.addEventListener(
        "online",
        () => {
          void testFirestoreConnection();
        },
        { once: true },
      );
      return;
    }
  }
}

export async function compressAvatarDataUrl(
  source: File | string,
  maxSide = 256,
): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const rawUrl =
      typeof source === "string"
        ? source
        : await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("Could not read image."));
            reader.readAsDataURL(source);
          });

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Invalid image."));
      el.src = rawUrl;
    });

    const scale = Math.min(1, maxSide / Math.max(img.width || maxSide, img.height || maxSide));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return rawUrl.slice(0, 280000);
    ctx.drawImage(img, 0, 0, width, height);
    let output = canvas.toDataURL("image/jpeg", 0.78);
    if (output.length > 260000) {
      output = canvas.toDataURL("image/jpeg", 0.55);
    }
    return output;
  } catch {
    return null;
  }
}
