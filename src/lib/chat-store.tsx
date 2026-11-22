import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
  type User as FirebaseUser,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { createCallClient } from "./call-client";
import {
  buildIncomingMessageAlertPayload,
  showSystemNotification,
  triggerVibration,
} from "./alerts";
import { isActiveElementTextInput } from "./chat-viewport";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import {
  compressAvatarDataUrl,
  getFirebaseAuth,
  getFirebaseDb,
  googleProvider,
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
} from "@/lib/firebase";
import type { SecretThemeId } from "@/lib/secret-themes";
import {
  filterAndSortUsers,
  makeHandleCandidates,
  normalizeEmail,
  normalizeHandle,
  threadKeyFor,
} from "@/lib/social-logic";

export type MediaKind = "image" | "video" | "audio";

export type MessageReactionGroup = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  userIds: string[];
};

export type ReplyPreview = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  mediaKind: MediaKind | null;
  deleted: boolean;
};

export type PublicAccount = {
  id: string;
  fullName: string;
  displayHandle: string;
  bio: string;
  avatarUrl: string | null;
  theme: SecretThemeId;
  phoneVerified: boolean;
  lastActiveAt: string;
  online: boolean;
  email?: string | null | undefined;
  phoneMasked?: string;
  phoneE164?: string | null;
  blockedByMe?: boolean;
  blockedMe?: boolean;
  followerCount?: number;
  followingCount?: number;
  isFollowing?: boolean;
  followsMe?: boolean;
};

export type ChatMessage = {
  id: string;
  threadKey: string;
  from: string;
  to: string;
  text: string;
  mediaUrl: string | null;
  mediaId: string | null;
  mediaKind: MediaKind | null;
  mediaName: string | null;
  replyToId: string | null;
  replyTo: ReplyPreview | null;
  reactions: MessageReactionGroup[];
  editedAt: string | null;
  deletedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  seenAt: string | null;
};

export type ConversationItem = {
  peer: PublicAccount;
  blockedByMe: boolean;
  blockedMe: boolean;
  pinned: boolean;
  muted: boolean;
  lastMessage: ChatMessage | null;
  unreadCount: number;
};

export type NfcLinkState = {
  revoked: boolean;
  version: number;
  updatedAt: string;
  token: string | null;
  path: string | null;
};

export type GalleryItem = {
  id: string;
  kind: "image" | "video";
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  createdAt: string;
  url: string;
  mine: boolean;
};

export type BlockedUserItem = PublicAccount & {
  blockedAt: string;
};

export type LegacyAccountHint = {
  id: string;
  username: string;
  bio?: string;
  dp?: string;
};

export type IncomingCall = {
  callId: string;
  callType: "audio" | "video";
  from: PublicAccount;
};

export type OutgoingCall = {
  callId: string;
  callType: "audio" | "video";
  target: PublicAccount;
  status: "preparing" | "connecting" | "ringing" | "accepted";
  stream?: MediaStream | null;
};

export type IncomingMessageAlert = {
  id: string;
  peer: PublicAccount;
  preview: string;
  createdAt: string;
};

type ChatClientState = {
  ready: boolean;
  me: PublicAccount | null;
  sessionToken: string | null;
  otpConfigured: boolean;
  conversations: ConversationItem[];
  discoveredUsers: PublicAccount[];
  activePeerId: string | null;
  threads: Record<string, ChatMessage[]>;
  typingByPeer: Record<string, boolean>;
  blockedUsers: BlockedUserItem[];
  nfc: NfcLinkState | null;
  gallery: GalleryItem[];
  soundEnabled: boolean;
  incomingCall: IncomingCall | null;
  outgoingCall: OutgoingCall | null;
  incomingMessageAlert: IncomingMessageAlert | null;
  legacyAccounts: LegacyAccountHint[];
  wsConnected: boolean;
};

type RawPublicUser = {
  uid: string;
  fullName: string;
  displayHandle: string;
  bio: string;
  avatarUrl?: string | null;
  theme: SecretThemeId;
  online: boolean;
  followerCount: number;
  followingCount: number;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  lastActiveAt?: Timestamp | null;
};

type RawFollow = {
  followerId: string;
  followingId: string;
  createdAt?: Timestamp | null;
};

type RawBlock = {
  blockerId: string;
  blockedId: string;
  createdAt?: Timestamp | null;
};

type RawConversation = {
  participantA: string;
  participantB: string;
  lastMessageText: string;
  lastMessageFrom?: string | null;
  lastMessageMediaKind?: MediaKind | null;
  lastMessageDeleted: boolean;
  lastMessageAt?: Timestamp | null;
  lastMessageSeenAt?: Timestamp | null;
  unreadA: number;
  unreadB: number;
  pinnedA: boolean;
  pinnedB: boolean;
  mutedA: boolean;
  mutedB: boolean;
  typingA: boolean;
  typingB: boolean;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
};

type RawMessage = {
  id: string;
  threadKey: string;
  senderId: string;
  recipientId: string;
  text: string;
  mediaUrl?: string | null;
  mediaId?: string | null;
  mediaKind?: MediaKind | null;
  mediaName?: string | null;
  replyToId?: string | null;
  replyTo?: ReplyPreview | null;
  reactionA?: string | null;
  reactionB?: string | null;
  editedAt?: Timestamp | null;
  deletedAt?: Timestamp | null;
  deliveredAt?: Timestamp | null;
  seenAt?: Timestamp | null;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
};

const SOUND_STORAGE_KEY = "reading-corner.chat-sound.v3";

const INITIAL: ChatClientState = {
  ready: false,
  me: null,
  sessionToken: null,
  otpConfigured: false,
  conversations: [],
  discoveredUsers: [],
  activePeerId: null,
  threads: {},
  typingByPeer: {},
  blockedUsers: [],
  nfc: null,
  gallery: [],
  soundEnabled: true,
  incomingCall: null,
  outgoingCall: null,
  incomingMessageAlert: null,
  legacyAccounts: [],
  wsConnected: true,
};

let state: ChatClientState = INITIAL;
const listeners = new Set<() => void>();
let initialized = false;
let currentUid: string | null = null;
let activeListenerUid: string | null = null;
let registrationInProgress = false;
const inFlightProfileInit = new Map<string, Promise<PublicAccount>>();
let profileUnsub: Unsubscribe | null = null;
let privateUnsub: Unsubscribe | null = null;
let usersUnsub: Unsubscribe | null = null;
let followingUnsub: Unsubscribe | null = null;
let followersUnsub: Unsubscribe | null = null;
let blocksByMeUnsub: Unsubscribe | null = null;
let blocksOnMeUnsub: Unsubscribe | null = null;
let convsAUnsub: Unsubscribe | null = null;
let convsBUnsub: Unsubscribe | null = null;
let activeThreadUnsub: Unsubscribe | null = null;
let presenceTimer: number | null = null;

// Raw snapshot caches so derived state recomputes cleanly without extra Firestore reads
let rawPublicUsers = new Map<string, RawPublicUser>();
let myPrivateEmail: string | null = null;
let followingIds = new Set<string>();
let followerIds = new Set<string>();
let blockedByMeMap = new Map<string, string>(); // targetUid -> blockedAt ISO
let blockedMeIds = new Set<string>();
let convDocsMap = new Map<string, RawConversation>(); // threadKey -> RawConversation
const uploadedMediaMeta = new Map<string, { url: string; kind: MediaKind; name: string }>();
const mediaBlobUrlCache = new Map<string, string>();
const inFlightMediaFetches = new Map<string, Promise<string>>();

export function primeMediaObjectUrl(url: string, blob: Blob): string {
  if (!url || typeof window === "undefined") return url;
  const existing = mediaBlobUrlCache.get(url);
  if (existing && existing.startsWith("blob:")) {
    URL.revokeObjectURL(existing);
  }
  const objUrl = URL.createObjectURL(blob);
  mediaBlobUrlCache.set(url, objUrl);
  return objUrl;
}

export function evictMediaObjectUrl(url: string) {
  const existing = mediaBlobUrlCache.get(url);
  if (existing && existing.startsWith("blob:")) {
    URL.revokeObjectURL(existing);
  }
  mediaBlobUrlCache.delete(url);
}

function clearMediaBlobCache() {
  for (const objUrl of mediaBlobUrlCache.values()) {
    if (objUrl.startsWith("blob:")) {
      URL.revokeObjectURL(objUrl);
    }
  }
  mediaBlobUrlCache.clear();
  inFlightMediaFetches.clear();
}

export function getCachedMediaObjectUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith("/api/media/")) return url;
  return mediaBlobUrlCache.get(url) ?? null;
}

export async function resolveAuthorizedMediaUrl(url: string): Promise<string> {
  if (!url || !url.startsWith("/api/media/")) return url;
  const cached = mediaBlobUrlCache.get(url);
  if (cached) return cached;

  const inflight = inFlightMediaFetches.get(url);
  if (inflight) return inflight;

  const promise = (async () => {
    const fbUser = getFirebaseAuth().currentUser;
    const headers: Record<string, string> = {};
    if (fbUser) {
      const idToken = await fbUser.getIdToken();
      headers["Authorization"] = `Bearer ${idToken}`;
    }

    let resp = await fetch(url, { headers, credentials: "include" });
    if (resp.status === 401 && fbUser) {
      const freshToken = await fbUser.getIdToken(true);
      resp = await fetch(url, {
        headers: { Authorization: `Bearer ${freshToken}` },
        credentials: "include",
      });
    }
    if (!resp.ok) {
      throw new Error(`Could not load media (${resp.status})`);
    }
    const blob = await resp.blob();
    return primeMediaObjectUrl(url, blob);
  })().finally(() => {
    inFlightMediaFetches.delete(url);
  });

  inFlightMediaFetches.set(url, promise);
  return promise;
}

export async function downloadProtectedMedia(url: string, filename: string) {
  const resolved = await resolveAuthorizedMediaUrl(url);
  const a = document.createElement("a");
  a.href = resolved;
  a.download = filename || "media";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function emit() {
  listeners.forEach((l) => l());
}

function setState(patch: Partial<ChatClientState>) {
  state = { ...state, ...patch };
  emit();
}

function tsToIso(ts: Timestamp | Date | string | null | undefined): string {
  if (!ts) return new Date().toISOString();
  if (typeof ts === "string") return ts;
  if (ts instanceof Date) return ts.toISOString();
  if (typeof (ts as Timestamp).toDate === "function") {
    return (ts as Timestamp).toDate().toISOString();
  }
  return new Date().toISOString();
}

function tsToIsoOrNull(ts: Timestamp | Date | string | null | undefined): string | null {
  if (!ts) return null;
  return tsToIso(ts);
}

function isUserEffectivelyOnline(raw: RawPublicUser): boolean {
  if (!raw.online) return false;
  const lastMs = Date.parse(tsToIso(raw.lastActiveAt));
  if (Number.isNaN(lastMs)) return raw.online;
  return Date.now() - lastMs < 150_000;
}

function toPublicAccountFromRaw(raw: RawPublicUser, viewerUid: string | null): PublicAccount {
  const isSelf = viewerUid === raw.uid;
  return {
    id: raw.uid,
    fullName: raw.fullName,
    displayHandle: raw.displayHandle,
    bio: raw.bio ?? "",
    avatarUrl: raw.avatarUrl ?? null,
    theme:
      raw.theme === "emerald" || raw.theme === "dark" || raw.theme === "instagram"
        ? raw.theme
        : "instagram",
    phoneVerified: false,
    lastActiveAt: tsToIso(raw.lastActiveAt ?? raw.updatedAt ?? raw.createdAt),
    online: isSelf ? true : isUserEffectivelyOnline(raw),
    ...(isSelf && myPrivateEmail ? { email: myPrivateEmail } : {}),
    blockedByMe: isSelf ? false : blockedByMeMap.has(raw.uid),
    blockedMe: isSelf ? false : blockedMeIds.has(raw.uid),
    followerCount: typeof raw.followerCount === "number" ? raw.followerCount : 0,
    followingCount: typeof raw.followingCount === "number" ? raw.followingCount : 0,
    isFollowing: isSelf ? false : followingIds.has(raw.uid),
    followsMe: isSelf ? false : followerIds.has(raw.uid),
  };
}

function buildReactionGroups(
  reactionA: string | null | undefined,
  reactionB: string | null | undefined,
  participantA: string,
  participantB: string,
  viewerUid: string,
): MessageReactionGroup[] {
  const grouped = new Map<
    string,
    { emoji: string; count: number; reactedByMe: boolean; userIds: string[] }
  >();
  const pairs: [string | null | undefined, string][] = [
    [reactionA, participantA],
    [reactionB, participantB],
  ];
  for (const [emoji, uid] of pairs) {
    if (!emoji) continue;
    const entry = grouped.get(emoji) ?? {
      emoji,
      count: 0,
      reactedByMe: false,
      userIds: [],
    };
    entry.count += 1;
    entry.userIds.push(uid);
    if (uid === viewerUid) entry.reactedByMe = true;
    grouped.set(emoji, entry);
  }
  return Array.from(grouped.values());
}

function serializeFirestoreMessage(
  raw: RawMessage,
  threadKey: string,
  viewerUid: string,
): ChatMessage {
  const [participantA = "", participantB = ""] = threadKey.split("__");
  const isDeleted = Boolean(raw.deletedAt);
  return {
    id: raw.id,
    threadKey: raw.threadKey,
    from: raw.senderId,
    to: raw.recipientId,
    text: isDeleted ? "Message deleted" : raw.text,
    mediaUrl: isDeleted ? null : (raw.mediaUrl ?? null),
    mediaId: isDeleted ? null : (raw.mediaId ?? null),
    mediaKind: isDeleted ? null : (raw.mediaKind ?? null),
    mediaName: isDeleted ? null : (raw.mediaName ?? null),
    replyToId: raw.replyToId ?? null,
    replyTo: raw.replyTo ?? null,
    reactions: isDeleted
      ? []
      : buildReactionGroups(raw.reactionA, raw.reactionB, participantA, participantB, viewerUid),
    editedAt: tsToIsoOrNull(raw.editedAt),
    deletedAt: tsToIsoOrNull(raw.deletedAt),
    deliveredAt: tsToIsoOrNull(raw.deliveredAt),
    createdAt: tsToIso(raw.createdAt),
    seenAt: tsToIsoOrNull(raw.seenAt),
  };
}

function sortConversations(convs: ConversationItem[]) {
  return [...convs].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const aTime = a.lastMessage?.createdAt ?? "";
    const bTime = b.lastMessage?.createdAt ?? "";
    return bTime.localeCompare(aTime);
  });
}

function recomputeDerivedState() {
  if (!currentUid) return;
  const uid = currentUid;

  const myRaw = rawPublicUsers.get(uid);
  const nextMe = myRaw
    ? toPublicAccountFromRaw(myRaw, uid)
    : state.me
      ? { ...state.me, email: myPrivateEmail ?? state.me.email ?? null }
      : null;

  const discovered: PublicAccount[] = [];
  for (const [otherUid, raw] of rawPublicUsers.entries()) {
    if (otherUid === uid) continue;
    if (blockedMeIds.has(otherUid)) continue;
    discovered.push(toPublicAccountFromRaw(raw, uid));
  }
  const sortedDiscovered = filterAndSortUsers(discovered, "", "all");

  const nextBlockedUsers: BlockedUserItem[] = [];
  for (const [blockedId, blockedAt] of blockedByMeMap.entries()) {
    const raw = rawPublicUsers.get(blockedId);
    if (raw) {
      nextBlockedUsers.push({
        ...toPublicAccountFromRaw(raw, uid),
        blockedAt,
      });
    }
  }

  const nextTyping: Record<string, boolean> = {};
  const nextConversations: ConversationItem[] = [];

  for (const [key, conv] of convDocsMap.entries()) {
    const isA = conv.participantA === uid;
    const peerId = isA ? conv.participantB : conv.participantA;
    const peerRaw = rawPublicUsers.get(peerId);
    if (!peerRaw) continue;

    nextTyping[peerId] = isA ? Boolean(conv.typingB) : Boolean(conv.typingA);
    const pinned = isA ? Boolean(conv.pinnedA) : Boolean(conv.pinnedB);
    const muted = isA ? Boolean(conv.mutedA) : Boolean(conv.mutedB);
    const unreadCount = isA ? (conv.unreadA ?? 0) : (conv.unreadB ?? 0);

    let lastMessage: ChatMessage | null = null;
    if (conv.lastMessageAt) {
      const lastFrom = conv.lastMessageFrom ?? peerId;
      const lastTo = lastFrom === uid ? peerId : uid;
      lastMessage = {
        id: `preview_${key}`,
        threadKey: key,
        from: lastFrom,
        to: lastTo,
        text: conv.lastMessageDeleted ? "Message deleted" : conv.lastMessageText,
        mediaUrl: null,
        mediaId: null,
        mediaKind: conv.lastMessageMediaKind ?? null,
        mediaName: null,
        replyToId: null,
        replyTo: null,
        reactions: [],
        editedAt: null,
        deletedAt: conv.lastMessageDeleted ? tsToIso(conv.lastMessageAt) : null,
        deliveredAt: tsToIso(conv.lastMessageAt),
        createdAt: tsToIso(conv.lastMessageAt),
        seenAt: tsToIsoOrNull(conv.lastMessageSeenAt),
      };
    }

    nextConversations.push({
      peer: toPublicAccountFromRaw(peerRaw, uid),
      blockedByMe: blockedByMeMap.has(peerId),
      blockedMe: blockedMeIds.has(peerId),
      pinned,
      muted,
      lastMessage,
      unreadCount,
    });
  }

  setState({
    me: nextMe,
    discoveredUsers: sortedDiscovered,
    blockedUsers: nextBlockedUsers,
    typingByPeer: nextTyping,
    conversations: sortConversations(nextConversations),
  });
}

function playNotificationTone() {
  if (!state.soundEnabled || typeof window === "undefined") return;
  void import("./water-sound")
    .then(({ playWaterSound }) => {
      playWaterSound("ripple", state.soundEnabled);
    })
    .catch(() => {});
}

async function syncServerMediaCookie(fbUser: FirebaseUser) {
  try {
    const idToken = await fbUser.getIdToken();
    await fetch("/api/auth/firebase-cookie", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      credentials: "include",
      body: JSON.stringify({ idToken }),
    });
  } catch {
    /* non-fatal if offline; media upload will refresh token explicitly */
  }
}

function isPermissionDeniedError(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? "";
  const msg = err instanceof Error ? err.message : String(err);
  return (
    code === "permission-denied" ||
    code.endsWith("/permission-denied") ||
    msg.includes("Missing or insufficient permissions")
  );
}

async function tryClaimHandle(uid: string, handle: string): Promise<"claimed" | "taken"> {
  const db = getFirebaseDb();
  const handleKey = handle.slice(1);
  let snap;
  try {
    snap = await getDoc(doc(db, "handles", handleKey));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `handles/${handleKey}`);
  }
  if (snap.exists()) {
    return snap.data()["uid"] === uid ? "claimed" : "taken";
  }
  try {
    await setDoc(doc(db, "handles", handleKey), {
      uid,
      handle,
      createdAt: serverTimestamp(),
    });
    return "claimed";
  } catch (err) {
    // Another account or concurrent call may have created handles/{handleKey} between getDoc and setDoc
    if (isPermissionDeniedError(err)) {
      const recheck = await getDoc(doc(db, "handles", handleKey)).catch(() => null);
      if (recheck?.exists() && recheck.data()["uid"] === uid) {
        return "claimed";
      }
      return "taken";
    }
    handleFirestoreError(err, OperationType.CREATE, `handles/${handleKey}`);
  }
}

async function reserveAvailableHandle(
  uid: string,
  preferredHandle: string | null,
  fullName: string,
  email: string | null,
): Promise<string> {
  if (preferredHandle) {
    const normalized = normalizeHandle(preferredHandle);
    if (!normalized) {
      throw new Error(
        "Username must be at least 2 characters (letters, numbers, dots, underscores).",
      );
    }
    const result = await tryClaimHandle(uid, normalized);
    if (result === "taken") {
      throw new Error("That username is already taken. Please choose another.");
    }
    return normalized;
  }

  const candidates = makeHandleCandidates(fullName, email, uid);
  for (const candidate of candidates) {
    const result = await tryClaimHandle(uid, candidate);
    if (result === "claimed") {
      return candidate;
    }
  }

  const uidTail =
    uid
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(-6) || "user";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rand = Math.random().toString(36).slice(2, 6);
    const fallback = `@reader.${uidTail}.${rand}`.slice(0, 29);
    const result = await tryClaimHandle(uid, fallback);
    if (result === "claimed") {
      return fallback;
    }
  }

  throw new Error("Could not reserve a unique reader username. Please try again.");
}

async function ensureUserProfileDocsInternal(
  fbUser: FirebaseUser,
  overrides?: {
    fullName?: string;
    username?: string;
    bio?: string;
    avatarUrl?: string | null;
  },
): Promise<PublicAccount> {
  const db = getFirebaseDb();
  const uid = fbUser.uid;
  const pubRef = doc(db, "users_public", uid);
  const privRef = doc(db, "users_private", uid);

  let pubSnap;
  try {
    pubSnap = await getDoc(pubRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users_public/${uid}`);
  }

  if (!pubSnap.exists()) {
    const rawName = (
      overrides?.fullName ||
      fbUser.displayName ||
      fbUser.email?.split("@")[0] ||
      "Reader"
    )
      .trim()
      .slice(0, 60);
    const fullName = rawName.length >= 2 ? rawName : `${rawName} Reader`.slice(0, 60);
    const displayHandle = await reserveAvailableHandle(
      uid,
      overrides?.username ?? null,
      fullName,
      fbUser.email ?? null,
    );
    const compressedAvatar =
      overrides?.avatarUrl ?? (fbUser.photoURL ? fbUser.photoURL.slice(0, 300000) : null);
    const bio = (overrides?.bio ?? "").trim().slice(0, 200);

    try {
      await setDoc(pubRef, {
        uid,
        fullName,
        displayHandle,
        bio,
        avatarUrl: compressedAvatar,
        theme: "instagram",
        online: true,
        followerCount: 0,
        followingCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users_public/${uid}`);
    }

    try {
      await setDoc(privRef, {
        uid,
        email: fbUser.email ?? null,
        soundEnabled: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users_private/${uid}`);
    }

    let fresh;
    try {
      fresh = await getDoc(pubRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users_public/${uid}`);
    }
    const raw = fresh.data() as RawPublicUser | undefined;
    if (raw) {
      rawPublicUsers.set(uid, raw);
      myPrivateEmail = fbUser.email ?? null;
      return toPublicAccountFromRaw(raw, uid);
    }
    return {
      id: uid,
      fullName,
      displayHandle,
      bio,
      avatarUrl: compressedAvatar,
      theme: "instagram",
      phoneVerified: false,
      lastActiveAt: new Date().toISOString(),
      online: true,
      email: fbUser.email ?? null,
      followerCount: 0,
      followingCount: 0,
    };
  }

  // Existing user: refresh presence and ensure private doc exists
  try {
    await updateDoc(pubRef, {
      online: true,
      lastActiveAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    /* ignore presence ping error if transient */
  }

  const privSnap = await getDoc(privRef).catch(() => null);
  if (privSnap && !privSnap.exists()) {
    await setDoc(privRef, {
      uid,
      email: fbUser.email ?? null,
      soundEnabled: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  } else if (privSnap?.exists()) {
    myPrivateEmail =
      (privSnap.data()["email"] as string | null | undefined) ?? fbUser.email ?? null;
  }

  const raw = pubSnap.data() as RawPublicUser;
  rawPublicUsers.set(uid, raw);
  return toPublicAccountFromRaw(raw, uid);
}

async function ensureUserProfileDocs(
  fbUser: FirebaseUser,
  overrides?: {
    fullName?: string;
    username?: string;
    bio?: string;
    avatarUrl?: string | null;
  },
): Promise<PublicAccount> {
  const uid = fbUser.uid;
  const existing = inFlightProfileInit.get(uid);
  if (existing) {
    return existing;
  }
  const promise = ensureUserProfileDocsInternal(fbUser, overrides).finally(() => {
    if (inFlightProfileInit.get(uid) === promise) {
      inFlightProfileInit.delete(uid);
    }
  });
  inFlightProfileInit.set(uid, promise);
  return promise;
}

let callClient: ReturnType<typeof createCallClient> | undefined;
function clearFirestoreListeners() {
  callClient?.dispose();
  callClient = undefined;
  activeListenerUid = null;
  profileUnsub?.();
  privateUnsub?.();
  usersUnsub?.();
  followingUnsub?.();
  followersUnsub?.();
  blocksByMeUnsub?.();
  blocksOnMeUnsub?.();
  convsAUnsub?.();
  convsBUnsub?.();
  activeThreadUnsub?.();
  profileUnsub = null;
  privateUnsub = null;
  usersUnsub = null;
  followingUnsub = null;
  followersUnsub = null;
  blocksByMeUnsub = null;
  blocksOnMeUnsub = null;
  convsAUnsub = null;
  convsBUnsub = null;
  activeThreadUnsub = null;

  if (presenceTimer) {
    window.clearInterval(presenceTimer);
    presenceTimer = null;
  }

  rawPublicUsers = new Map();
  myPrivateEmail = null;
  followingIds = new Set();
  followerIds = new Set();
  blockedByMeMap = new Map();
  blockedMeIds = new Set();
  convDocsMap = new Map();
}

function startRealtimeListeners(uid: string) {
  if (activeListenerUid === uid && usersUnsub) {
    return;
  }
  clearFirestoreListeners();
  currentUid = uid;
  activeListenerUid = uid;
  const db = getFirebaseDb();

  callClient = createCallClient(db, uid, fetchUserProfile, setState, (message) => toast(message));

  // 1. My own public profile
  profileUnsub = onSnapshot(
    doc(db, "users_public", uid),
    (snap) => {
      if (snap.exists()) {
        rawPublicUsers.set(uid, snap.data() as RawPublicUser);
        recomputeDerivedState();
      }
    },
    (err) => {
      if (currentUid !== uid) return;
      try {
        handleFirestoreError(err, OperationType.GET, `users_public/${uid}`);
      } catch {
        /* logged via handleFirestoreError */
      }
    },
  );

  // 2. My private settings
  privateUnsub = onSnapshot(
    doc(db, "users_private", uid),
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        myPrivateEmail = (data["email"] as string | null | undefined) ?? null;
        if (typeof data["soundEnabled"] === "boolean") {
          setState({ soundEnabled: data["soundEnabled"] });
        }
        recomputeDerivedState();
      }
    },
    (err) => {
      if (currentUid !== uid) return;
      try {
        handleFirestoreError(err, OperationType.GET, `users_private/${uid}`);
      } catch {
        /* logged via handleFirestoreError */
      }
    },
  );

  // 3. All registered users directory (live)
  usersUnsub = onSnapshot(
    collection(db, "users_public"),
    (snap) => {
      const next = new Map<string, RawPublicUser>();
      for (const d of snap.docs) {
        const data = d.data() as RawPublicUser;
        if (data?.uid) next.set(data.uid, data);
      }
      rawPublicUsers = next;
      recomputeDerivedState();
    },
    (err) => {
      if (currentUid !== uid) return;
      try {
        handleFirestoreError(err, OperationType.LIST, "users_public");
      } catch {
        /* logged via handleFirestoreError */
      }
    },
  );

  // 4. Following & Followers
  followingUnsub = onSnapshot(
    query(collection(db, "follows"), where("followerId", "==", uid)),
    (snap) => {
      const next = new Set<string>();
      for (const d of snap.docs) {
        const data = d.data() as RawFollow;
        if (data.followingId) next.add(data.followingId);
      }
      followingIds = next;
      recomputeDerivedState();
    },
    (err) => console.error("follows(following) error:", err),
  );

  followersUnsub = onSnapshot(
    query(collection(db, "follows"), where("followingId", "==", uid)),
    (snap) => {
      const next = new Set<string>();
      for (const d of snap.docs) {
        const data = d.data() as RawFollow;
        if (data.followerId) next.add(data.followerId);
      }
      followerIds = next;
      recomputeDerivedState();
    },
    (err) => console.error("follows(followers) error:", err),
  );

  // 5. Blocks (both directions)
  blocksByMeUnsub = onSnapshot(
    query(collection(db, "blocks"), where("blockerId", "==", uid)),
    (snap) => {
      const next = new Map<string, string>();
      for (const d of snap.docs) {
        const data = d.data() as RawBlock;
        if (data.blockedId) next.set(data.blockedId, tsToIso(data.createdAt));
      }
      blockedByMeMap = next;
      recomputeDerivedState();
    },
    (err) => console.error("blocks(byMe) error:", err),
  );

  blocksOnMeUnsub = onSnapshot(
    query(collection(db, "blocks"), where("blockedId", "==", uid)),
    (snap) => {
      const next = new Set<string>();
      for (const d of snap.docs) {
        const data = d.data() as RawBlock;
        if (data.blockerId) next.add(data.blockerId);
      }
      blockedMeIds = next;
      recomputeDerivedState();
    },
    (err) => console.error("blocks(onMe) error:", err),
  );

  // 6. Conversations where I am participantA or participantB
  const handleConvSnapshot =
    (slot: "A" | "B") => (snap: { docs: { id: string; data: () => unknown }[] }) => {
      const incomingIds = new Set<string>();
      for (const d of snap.docs) {
        incomingIds.add(d.id);
        const data = d.data() as RawConversation;
        const prev = convDocsMap.get(d.id);
        convDocsMap.set(d.id, data);

        // Alert with vibration, sound, interactive receive banner, and OS notification
        if (prev && data.lastMessageFrom && data.lastMessageFrom !== uid) {
          const prevUnread = slot === "A" ? prev.unreadA : prev.unreadB;
          const nextUnread = slot === "A" ? data.unreadA : data.unreadB;
          const peerId = slot === "A" ? data.participantB : data.participantA;
          const muted = slot === "A" ? data.mutedA : data.mutedB;
          const isPageHidden =
            typeof document !== "undefined" && document.visibilityState === "hidden";
          const isViewingThisThread = state.activePeerId === peerId && !isPageHidden;
          if (nextUnread > prevUnread && !muted && !isViewingThisThread) {
            const peerRaw = rawPublicUsers.get(peerId);
            const peerAccount: PublicAccount = peerRaw
              ? toPublicAccountFromRaw(peerRaw, uid)
              : {
                  id: peerId,
                  fullName: "Reader",
                  displayHandle: "@reader",
                  bio: "",
                  avatarUrl: null,
                  theme: "instagram",
                  phoneVerified: false,
                  lastActiveAt: new Date().toISOString(),
                  online: true,
                };
            const payload = buildIncomingMessageAlertPayload({
              senderName: peerAccount.fullName,
              text: data.lastMessageText,
              mediaKind: data.lastMessageMediaKind ?? null,
            });
            const onChatRoute =
              typeof window !== "undefined" &&
              (window.location.pathname.startsWith("/messages") ||
                window.location.pathname.startsWith("/chat"));
            const isTypingInChat =
              typeof document !== "undefined" &&
              onChatRoute &&
              isActiveElementTextInput(document.activeElement);

            if (!isTypingInChat) {
              triggerVibration(payload.vibratePattern);
            }
            playNotificationTone();

            if (state.activePeerId !== peerId) {
              setState({
                incomingMessageAlert: {
                  id: `${peerId}-${Date.now()}`,
                  peer: peerAccount,
                  preview: payload.body,
                  createdAt: new Date().toISOString(),
                },
              });
            }

            if (isPageHidden || !onChatRoute || state.activePeerId !== peerId) {
              showSystemNotification({
                title: payload.title,
                body: payload.body,
                tag: payload.tag,
                onClick: () => {
                  void openThread(peerId);
                  if (
                    typeof window !== "undefined" &&
                    !window.location.pathname.startsWith("/messages") &&
                    !window.location.pathname.startsWith("/chat")
                  ) {
                    window.location.assign(`/messages?peer=${encodeURIComponent(peerId)}`);
                  }
                },
              });
            }
          }
        }
      }

      // Remove stale convs belonging to this slot if deleted/disappeared
      for (const [key, conv] of Array.from(convDocsMap.entries())) {
        const belongs = slot === "A" ? conv.participantA === uid : conv.participantB === uid;
        if (belongs && !incomingIds.has(key)) {
          convDocsMap.delete(key);
        }
      }
      recomputeDerivedState();
    };

  convsAUnsub = onSnapshot(
    query(collection(db, "conversations"), where("participantA", "==", uid)),
    handleConvSnapshot("A"),
    (err) => console.error("conversations(A) error:", err),
  );

  convsBUnsub = onSnapshot(
    query(collection(db, "conversations"), where("participantB", "==", uid)),
    handleConvSnapshot("B"),
    (err) => console.error("conversations(B) error:", err),
  );

  // 7. Presence heartbeat every 45s while page is visible
  const pingPresence = () => {
    if (document.visibilityState === "hidden") return;
    void updateDoc(doc(db, "users_public", uid), {
      online: true,
      lastActiveAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  };
  presenceTimer = window.setInterval(pingPresence, 45_000);
}

function bootstrap() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const savedSound = localStorage.getItem(SOUND_STORAGE_KEY);
  if (savedSound === "false") {
    setState({ soundEnabled: false });
  }

  void testFirestoreConnection();

  const auth = getFirebaseAuth();
  onAuthStateChanged(auth, (fbUser) => {
    if (!fbUser) {
      currentUid = null;
      clearFirestoreListeners();
      setState({
        ready: true,
        me: null,
        sessionToken: null,
        conversations: [],
        discoveredUsers: [],
        activePeerId: null,
        threads: {},
        typingByPeer: {},
        blockedUsers: [],
        gallery: [],
        incomingMessageAlert: null,
      });
      return;
    }

    if (registrationInProgress) {
      return;
    }

    void (async () => {
      try {
        await syncServerMediaCookie(fbUser);
        const profile = await ensureUserProfileDocs(fbUser);
        startRealtimeListeners(fbUser.uid);
        setState({
          ready: true,
          me: profile,
          sessionToken: fbUser.uid,
        });
        void fetchGallery();
      } catch (err) {
        console.error("Failed to initialize authenticated session:", err);
        setState({ ready: true });
      }
    })();
  });

  window.addEventListener("beforeunload", () => {
    const uid = getFirebaseAuth().currentUser?.uid;
    if (uid) {
      void updateDoc(doc(getFirebaseDb(), "users_public", uid), {
        online: false,
        lastActiveAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }
  });
}

function subscribe(listener: () => void) {
  bootstrap();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useChat() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL,
  );
}

function mapFirebaseAuthError(err: unknown): Error & { needsProviderConfig?: boolean } {
  const code = (err as { code?: string })?.code ?? "";
  if (code === "auth/email-already-in-use") {
    return new Error("An account is already registered with this email. Please sign in instead.");
  }
  if (code === "auth/invalid-email") {
    return new Error("Enter a valid email address.");
  }
  if (code === "auth/weak-password") {
    return new Error("Password must be at least 6 characters.");
  }
  if (
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/user-not-found"
  ) {
    return new Error("Invalid email or password.");
  }
  if (code === "auth/too-many-requests") {
    return new Error("Too many attempts. Please wait a moment and try again.");
  }
  if (code === "auth/operation-not-allowed") {
    const e = new Error(
      "Email/Password sign-in is not yet enabled in Firebase Console (Authentication → Sign-in method). You can enable it in 10 seconds or use Continue with Google immediately.",
    ) as Error & { needsProviderConfig?: boolean };
    e.needsProviderConfig = true;
    return e;
  }
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return new Error("Google sign-in was canceled.");
  }
  if (code === "auth/popup-blocked") {
    return new Error(
      "Browser blocked the Google sign-in popup. Please allow popups and try again.",
    );
  }
  return err instanceof Error ? err : new Error("Authentication failed.");
}

export async function signInWithGoogle(): Promise<PublicAccount> {
  const auth = getFirebaseAuth();
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    await syncServerMediaCookie(cred.user);
    const profile = await ensureUserProfileDocs(cred.user);
    startRealtimeListeners(cred.user.uid);
    setState({ ready: true, me: profile, sessionToken: cred.user.uid });
    void fetchGallery();
    return profile;
  } catch (err) {
    throw mapFirebaseAuthError(err);
  }
}

export async function registerAccount(input: {
  email?: string;
  username?: string;
  fullName: string;
  phone?: string;
  countryCode?: string;
  password: string;
  bio?: string;
  otpCode?: string;
  avatarDataUrl?: string | null;
}): Promise<PublicAccount> {
  const cleanEmail = normalizeEmail(input.email ?? "");
  if (!cleanEmail) {
    throw new Error("Enter a valid email address.");
  }
  const cleanName = input.fullName.trim();
  if (cleanName.length < 2 || cleanName.length > 60) {
    throw new Error("Full name is required (2–60 characters).");
  }
  if (input.password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const auth = getFirebaseAuth();
  registrationInProgress = true;
  try {
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, cleanEmail, input.password);
    } catch (err) {
      throw mapFirebaseAuthError(err);
    }

    await updateProfile(cred.user, { displayName: cleanName }).catch(() => {});
    const compressedAvatar = input.avatarDataUrl
      ? await compressAvatarDataUrl(input.avatarDataUrl)
      : null;

    await syncServerMediaCookie(cred.user);
    const profile = await ensureUserProfileDocs(cred.user, {
      fullName: cleanName,
      ...(input.username ? { username: input.username } : {}),
      ...(input.bio ? { bio: input.bio } : {}),
      avatarUrl: compressedAvatar,
    });
    startRealtimeListeners(cred.user.uid);
    setState({ ready: true, me: profile, sessionToken: cred.user.uid });
    void fetchGallery();
    return profile;
  } finally {
    registrationInProgress = false;
  }
}

export const registerWithPhone = registerAccount;

export async function loginAccount(input: {
  identifier?: string;
  email?: string;
  phone?: string;
  countryCode?: string;
  password: string;
}): Promise<PublicAccount> {
  const rawId = (input.email ?? input.identifier ?? "").trim();
  const cleanEmail = normalizeEmail(rawId);
  if (!cleanEmail) {
    throw new Error(
      "Please enter the email address for your account (or use Continue with Google).",
    );
  }
  const auth = getFirebaseAuth();
  try {
    const cred = await signInWithEmailAndPassword(auth, cleanEmail, input.password);
    await syncServerMediaCookie(cred.user);
    const profile = await ensureUserProfileDocs(cred.user);
    startRealtimeListeners(cred.user.uid);
    setState({ ready: true, me: profile, sessionToken: cred.user.uid });
    void fetchGallery();
    return profile;
  } catch (err) {
    throw mapFirebaseAuthError(err);
  }
}

export const loginWithPhone = loginAccount;

export async function sendPasswordReset(email: string): Promise<void> {
  const clean = normalizeEmail(email);
  if (!clean) throw new Error("Enter a valid email address.");
  try {
    await sendPasswordResetEmail(getFirebaseAuth(), clean);
  } catch (err) {
    throw mapFirebaseAuthError(err);
  }
}

export async function logout() {
  const auth = getFirebaseAuth();
  const uid = auth.currentUser?.uid;
  if (uid) {
    await updateDoc(doc(getFirebaseDb(), "users_public", uid), {
      online: false,
      lastActiveAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
  clearMediaBlobCache();
  clearFirestoreListeners();
  currentUid = null;
  await signOut(auth).catch(() => {});
  setState({
    me: null,
    sessionToken: null,
    conversations: [],
    discoveredUsers: [],
    activePeerId: null,
    threads: {},
    typingByPeer: {},
    blockedUsers: [],
    nfc: null,
    gallery: [],
    incomingCall: null,
    outgoingCall: null,
    incomingMessageAlert: null,
  });
}

// Legacy OTP stubs kept for compatibility with profile/NFC components without breaking imports
export async function sendOtp(_input: {
  phone: string;
  countryCode: string;
  purpose: "reset_password" | "verify_phone" | "register";
}) {
  throw new Error("SMS OTP is disabled. Use email password reset or Google sign-in.");
}

export async function resetPasswordWithOtp(_input: {
  phone: string;
  countryCode: string;
  code: string;
  newPassword: string;
}) {
  throw new Error("SMS OTP is disabled.");
}

export async function verifyMyPhoneOtp(_code: string) {
  return { ok: false, phoneVerified: false };
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const user = getFirebaseAuth().currentUser;
  if (!user || !user.email) {
    throw new Error("Password change is only available for email/password accounts.");
  }
  if (newPassword.length < 8) {
    throw new Error("New password must be at least 8 characters.");
  }
  try {
    const cred = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, cred);
    await updatePassword(user, newPassword);
    return { ok: true };
  } catch (err) {
    throw mapFirebaseAuthError(err);
  }
}

export async function updateMyProfile(patch: {
  fullName?: string;
  bio?: string;
  displayHandle?: string;
}): Promise<PublicAccount> {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser || !state.me) throw new Error("Authentication required.");

  const db = getFirebaseDb();
  const uid = fbUser.uid;
  const nextName = patch.fullName !== undefined ? patch.fullName.trim() : state.me.fullName;
  if (nextName.length < 2 || nextName.length > 60) {
    throw new Error("Full name must be 2–60 characters.");
  }
  const nextBio = patch.bio !== undefined ? patch.bio.trim().slice(0, 200) : state.me.bio;

  let nextHandle = state.me.displayHandle;
  if (patch.displayHandle !== undefined) {
    const normalized = normalizeHandle(patch.displayHandle);
    if (!normalized) {
      throw new Error("Username must be at least 2 characters.");
    }
    if (normalized !== state.me.displayHandle) {
      await reserveAvailableHandle(uid, normalized, nextName, fbUser.email ?? null);
      const oldKey = state.me.displayHandle.replace(/^@+/, "").toLowerCase();
      if (oldKey && oldKey !== normalized.slice(1)) {
        await deleteDoc(doc(db, "handles", oldKey)).catch(() => {});
      }
      nextHandle = normalized;
    }
  }

  try {
    await updateDoc(doc(db, "users_public", uid), {
      fullName: nextName,
      displayHandle: nextHandle,
      bio: nextBio,
      lastActiveAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users_public/${uid}`);
  }

  const updated: PublicAccount = {
    ...state.me,
    fullName: nextName,
    displayHandle: nextHandle,
    bio: nextBio,
  };
  setState({ me: updated });
  return updated;
}

export async function uploadAvatar(file: File): Promise<PublicAccount> {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser || !state.me) throw new Error("Authentication required.");
  if (!file.type.startsWith("image/")) {
    throw new Error("Avatar must be an image file.");
  }
  const compressed = await compressAvatarDataUrl(file);
  if (!compressed) {
    throw new Error("Could not process avatar image.");
  }
  const db = getFirebaseDb();
  try {
    await updateDoc(doc(db, "users_public", fbUser.uid), {
      avatarUrl: compressed,
      lastActiveAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users_public/${fbUser.uid}`);
  }
  const updated = { ...state.me, avatarUrl: compressed };
  setState({ me: updated });
  return updated;
}

export async function setSecretTheme(theme: SecretThemeId) {
  const fbUser = getFirebaseAuth().currentUser;
  if (state.me) {
    setState({ me: { ...state.me, theme } });
  }
  if (!fbUser) return;
  try {
    await updateDoc(doc(getFirebaseDb(), "users_public", fbUser.uid), {
      theme,
      lastActiveAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users_public/${fbUser.uid}`);
  }
}

export async function fetchNfcLink() {
  const fallback: NfcLinkState = {
    revoked: false,
    version: 1,
    updatedAt: new Date().toISOString(),
    token: null,
    path: null,
  };
  return fallback;
}

export async function regenerateNfcLink() {
  return fetchNfcLink();
}

export async function revokeNfcLink() {
  return {
    revoked: true,
    version: 1,
    updatedAt: new Date().toISOString(),
    token: null,
    path: null,
  };
}

export async function resolveNfcToken(
  _token: string,
): Promise<
  | { status: "authorized"; owner?: PublicAccount }
  | { status: "login_required"; ownerHint?: string; signedInAsDifferentAccount?: boolean }
> {
  return { status: "login_required", ownerHint: "R***" };
}

export async function discoverUsers(
  q = "",
  filter: "all" | "following" | "followers" = "all",
): Promise<PublicAccount[]> {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) return [];
  const db = getFirebaseDb();

  if (rawPublicUsers.size <= 1) {
    try {
      const snap = await getDocs(collection(db, "users_public"));
      const next = new Map<string, RawPublicUser>();
      for (const d of snap.docs) {
        const data = d.data() as RawPublicUser;
        if (data?.uid) next.set(data.uid, data);
      }
      rawPublicUsers = next;
      recomputeDerivedState();
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, "users_public");
    }
  }

  return filterAndSortUsers(state.discoveredUsers, q, filter);
}

export async function searchUsers(q: string): Promise<PublicAccount[]> {
  return discoverUsers(q, "all");
}

export async function fetchUserProfile(userId: string): Promise<PublicAccount> {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) throw new Error("Authentication required.");
  const db = getFirebaseDb();
  let snap;
  try {
    snap = await getDoc(doc(db, "users_public", userId));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users_public/${userId}`);
  }
  if (!snap.exists()) {
    throw new Error("User not found.");
  }
  const raw = snap.data() as RawPublicUser;
  rawPublicUsers.set(userId, raw);
  return toPublicAccountFromRaw(raw, fbUser.uid);
}

export async function followUser(userId: string) {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) throw new Error("Authentication required.");
  const uid = fbUser.uid;
  if (!userId || userId === uid) throw new Error("Cannot follow yourself.");
  if (blockedByMeMap.has(userId) || blockedMeIds.has(userId)) {
    throw new Error("Cannot follow a blocked user.");
  }

  const db = getFirebaseDb();
  const followId = `${uid}__${userId}`;
  const followRef = doc(db, "follows", followId);
  let existingFollow;
  try {
    existingFollow = await getDoc(followRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `follows/${followId}`);
  }

  if (!existingFollow.exists()) {
    const batch = writeBatch(db);
    batch.set(followRef, {
      followerId: uid,
      followingId: userId,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, "users_public", uid), {
      followingCount: increment(1),
    });
    batch.update(doc(db, "users_public", userId), {
      followerCount: increment(1),
    });
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `follows/${followId}`);
    }
  }

  const targetFollowerCount =
    (rawPublicUsers.get(userId)?.followerCount ?? 0) + (existingFollow.exists() ? 0 : 1);
  const targetFollowingCount = rawPublicUsers.get(userId)?.followingCount ?? 0;
  const myFollowingCount = (state.me?.followingCount ?? 0) + (existingFollow.exists() ? 0 : 1);

  return {
    ok: true,
    isFollowing: true,
    followerCount: targetFollowerCount,
    followingCount: targetFollowingCount,
    myFollowingCount,
  };
}

export async function unfollowUser(userId: string) {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) throw new Error("Authentication required.");
  const uid = fbUser.uid;
  const db = getFirebaseDb();
  const followId = `${uid}__${userId}`;
  const followRef = doc(db, "follows", followId);
  let existingFollow;
  try {
    existingFollow = await getDoc(followRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `follows/${followId}`);
  }

  if (existingFollow.exists()) {
    const batch = writeBatch(db);
    batch.delete(followRef);
    batch.update(doc(db, "users_public", uid), {
      followingCount: increment(-1),
    });
    batch.update(doc(db, "users_public", userId), {
      followerCount: increment(-1),
    });
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `follows/${followId}`);
    }
  }

  const targetFollowerCount = Math.max(
    0,
    (rawPublicUsers.get(userId)?.followerCount ?? 1) - (existingFollow.exists() ? 1 : 0),
  );
  const targetFollowingCount = rawPublicUsers.get(userId)?.followingCount ?? 0;
  const myFollowingCount = Math.max(
    0,
    (state.me?.followingCount ?? 1) - (existingFollow.exists() ? 1 : 0),
  );

  return {
    ok: true,
    isFollowing: false,
    followerCount: targetFollowerCount,
    followingCount: targetFollowingCount,
    myFollowingCount,
  };
}

async function ensureConversationDoc(myUid: string, peerId: string): Promise<string> {
  const key = threadKeyFor(myUid, peerId);
  if (convDocsMap.has(key)) return key;
  const db = getFirebaseDb();
  const convRef = doc(db, "conversations", key);
  let snap;
  try {
    snap = await getDoc(convRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `conversations/${key}`);
  }
  if (!snap.exists()) {
    const [participantA, participantB] = [myUid, peerId].sort();
    try {
      await setDoc(convRef, {
        participantA,
        participantB,
        lastMessageText: "",
        lastMessageFrom: null,
        lastMessageMediaKind: null,
        lastMessageDeleted: false,
        lastMessageAt: null,
        lastMessageSeenAt: null,
        unreadA: 0,
        unreadB: 0,
        pinnedA: false,
        pinnedB: false,
        mutedA: false,
        mutedB: false,
        typingA: false,
        typingB: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `conversations/${key}`);
    }
  }
  return key;
}

export async function loadConversations(): Promise<ConversationItem[]> {
  return state.conversations;
}

export function dismissIncomingMessageAlert() {
  if (state.incomingMessageAlert) {
    setState({ incomingMessageAlert: null });
  }
}

export async function openThread(peerId: string | null) {
  activeThreadUnsub?.();
  activeThreadUnsub = null;
  setState({
    activePeerId: peerId,
    ...(peerId && state.incomingMessageAlert?.peer.id === peerId
      ? { incomingMessageAlert: null }
      : {}),
  });
  if (!peerId) return;

  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) return;
  const uid = fbUser.uid;
  const db = getFirebaseDb();

  // Ensure peer exists in cache
  if (!rawPublicUsers.has(peerId)) {
    await fetchUserProfile(peerId).catch(() => null);
  }

  const key = await ensureConversationDoc(uid, peerId);
  const msgsRef = collection(db, "conversations", key, "messages");

  activeThreadUnsub = onSnapshot(
    query(msgsRef, orderBy("createdAt", "asc")),
    (snap) => {
      const list = snap.docs.map((d) =>
        serializeFirestoreMessage(d.data() as RawMessage, key, uid),
      );
      setState({
        threads: { ...state.threads, [peerId]: list },
      });

      // Automatically mark incoming unread messages as delivered + seen
      const unseenIncoming = snap.docs.filter((d) => {
        const data = d.data() as RawMessage;
        return data.recipientId === uid && !data.seenAt;
      });
      if (unseenIncoming.length > 0) {
        const batch = writeBatch(db);
        for (const d of unseenIncoming) {
          const data = d.data() as RawMessage;
          batch.update(d.ref, {
            deliveredAt: data.deliveredAt ?? serverTimestamp(),
            seenAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        const [participantA] = key.split("__");
        const isA = participantA === uid;
        batch.update(doc(db, "conversations", key), {
          ...(isA ? { unreadA: 0 } : { unreadB: 0 }),
          lastMessageSeenAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        void batch.commit().catch(() => {});
      }
    },
    (err) => {
      console.error("Thread listener error:", err);
    },
  );

  await markThreadSeen(peerId);
}

export async function searchThreadMessages(peerId: string, q: string): Promise<ChatMessage[]> {
  const existing = state.threads[peerId] ?? [];
  const clean = q.trim().toLowerCase();
  if (!clean) return existing;
  return existing.filter((m) => !m.deletedAt && m.text.toLowerCase().includes(clean));
}

export async function markThreadSeen(peerId: string) {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) return;
  const uid = fbUser.uid;
  const key = threadKeyFor(uid, peerId);
  const [participantA] = key.split("__");
  const isA = participantA === uid;
  const db = getFirebaseDb();
  const convRef = doc(db, "conversations", key);
  const snap = await getDoc(convRef).catch(() => null);
  if (!snap?.exists()) return;

  const currentUnread = isA ? snap.data()["unreadA"] : snap.data()["unreadB"];
  if (currentUnread > 0) {
    await updateDoc(convRef, {
      ...(isA ? { unreadA: 0 } : { unreadB: 0 }),
      lastMessageSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }
}

export async function uploadChatMedia(file: File, recipientId?: string) {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) throw new Error("Authentication required.");
  const idToken = await fbUser.getIdToken();
  const form = new FormData();
  form.append("file", file);
  if (recipientId) form.append("recipientId", recipientId);

  const resp = await fetch("/api/media", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
    credentials: "include",
    body: form,
  });
  const data = (await resp.json().catch(() => ({}))) as {
    id: string;
    kind: MediaKind;
    mimeType: string;
    originalName: string;
    sizeBytes?: number;
    createdAt?: string;
    url: string;
    mine?: boolean;
    error?: string;
  };
  if (!resp.ok) {
    throw new Error(data.error || "Could not upload media.");
  }
  const safeName = data.originalName || file.name;
  primeMediaObjectUrl(data.url, file);
  uploadedMediaMeta.set(data.id, {
    url: data.url,
    kind: data.kind,
    name: safeName,
  });
  if (data.kind === "image" || data.kind === "video") {
    const newItem: GalleryItem = {
      id: data.id,
      kind: data.kind,
      mimeType: data.mimeType || file.type,
      originalName: safeName,
      sizeBytes: data.sizeBytes ?? file.size,
      createdAt: data.createdAt ?? new Date().toISOString(),
      url: data.url,
      mine: true,
    };
    setState({
      gallery: [newItem, ...state.gallery.filter((g) => g.id !== data.id)],
    });
  }
  return data;
}

export async function sendChatMessage(
  peerId: string,
  text: string,
  mediaId?: string | null,
  replyToId?: string | null,
): Promise<ChatMessage> {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser || !state.me) throw new Error("Authentication required.");
  const uid = fbUser.uid;
  if (blockedByMeMap.has(peerId) || blockedMeIds.has(peerId)) {
    throw new Error("Messaging is blocked between you and this user.");
  }

  const key = await ensureConversationDoc(uid, peerId);
  const db = getFirebaseDb();
  const mediaMeta = mediaId ? (uploadedMediaMeta.get(mediaId) ?? null) : null;
  if (mediaId && mediaId.startsWith("fbm_")) {
    const idToken = await fbUser.getIdToken();
    await fetch(`/api/media/${encodeURIComponent(mediaId)}/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      credentials: "include",
      body: JSON.stringify({ recipientId: peerId }),
    }).catch(() => {});
  }
  const cleanText = text.trim().slice(0, 4000);
  const displayText =
    cleanText ||
    (mediaMeta?.kind === "video"
      ? "Sent a video"
      : mediaMeta?.kind === "audio"
        ? "Voice note"
        : mediaMeta?.kind === "image"
          ? "Sent a photo"
          : "");

  if (!displayText && !mediaMeta) {
    throw new Error("Message text or media is required.");
  }

  let replyTo: ReplyPreview | null = null;
  if (replyToId) {
    const parent = (state.threads[peerId] ?? []).find((m) => m.id === replyToId);
    if (parent) {
      const senderName =
        parent.from === uid
          ? state.me.fullName
          : (rawPublicUsers.get(parent.from)?.fullName ?? "Reader");
      replyTo = {
        id: parent.id,
        senderId: parent.from,
        senderName: senderName.slice(0, 60),
        text: (parent.deletedAt ? "Message deleted" : parent.text).slice(0, 400),
        mediaKind: parent.deletedAt ? null : parent.mediaKind,
        deleted: Boolean(parent.deletedAt),
      };
    }
  }

  const msgId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
  const msgRef = doc(db, "conversations", key, "messages", msgId);
  const [participantA] = key.split("__");
  const isMeA = participantA === uid;

  try {
    await setDoc(msgRef, {
      id: msgId,
      threadKey: key,
      senderId: uid,
      recipientId: peerId,
      text: displayText,
      mediaUrl: mediaMeta?.url ?? null,
      mediaId: mediaId ?? null,
      mediaKind: mediaMeta?.kind ?? null,
      mediaName: mediaMeta?.name ? mediaMeta.name.slice(0, 255) : null,
      replyToId: replyTo?.id ?? null,
      replyTo,
      reactionA: null,
      reactionB: null,
      editedAt: null,
      deletedAt: null,
      deliveredAt: null,
      seenAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `conversations/${key}/messages/${msgId}`);
  }

  try {
    await updateDoc(doc(db, "conversations", key), {
      lastMessageText: displayText,
      lastMessageFrom: uid,
      lastMessageMediaKind: mediaMeta?.kind ?? null,
      lastMessageDeleted: false,
      lastMessageAt: serverTimestamp(),
      lastMessageSeenAt: null,
      ...(isMeA
        ? { unreadB: increment(1), typingA: false }
        : { unreadA: increment(1), typingB: false }),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `conversations/${key}`);
  }

  if (mediaId) void fetchGallery();

  return {
    id: msgId,
    threadKey: key,
    from: uid,
    to: peerId,
    text: displayText,
    mediaUrl: mediaMeta?.url ?? null,
    mediaId: mediaId ?? null,
    mediaKind: mediaMeta?.kind ?? null,
    mediaName: mediaMeta?.name ?? null,
    replyToId: replyTo?.id ?? null,
    replyTo,
    reactions: [],
    editedAt: null,
    deletedAt: null,
    deliveredAt: null,
    createdAt: new Date().toISOString(),
    seenAt: null,
  };
}

function findMessageContext(messageId: string): { peerId: string; msg: ChatMessage } | null {
  for (const [peerId, msgs] of Object.entries(state.threads)) {
    const found = msgs.find((m) => m.id === messageId);
    if (found) return { peerId, msg: found };
  }
  return null;
}

export async function editChatMessage(messageId: string, text: string): Promise<ChatMessage> {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) throw new Error("Authentication required.");
  const ctx = findMessageContext(messageId);
  if (!ctx) throw new Error("Message not found.");

  const cleanText = text.trim().slice(0, 4000);
  if (!cleanText) throw new Error("Message text cannot be empty.");

  const db = getFirebaseDb();
  const msgRef = doc(db, "conversations", ctx.msg.threadKey, "messages", messageId);
  try {
    await updateDoc(msgRef, {
      text: cleanText,
      editedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `conversations/${ctx.msg.threadKey}/messages/${messageId}`,
    );
  }

  // Update conversation preview if this was the latest message
  const threadMsgs = state.threads[ctx.peerId] ?? [];
  if (threadMsgs[threadMsgs.length - 1]?.id === messageId) {
    await updateDoc(doc(db, "conversations", ctx.msg.threadKey), {
      lastMessageText: cleanText,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }

  return {
    ...ctx.msg,
    text: cleanText,
    editedAt: new Date().toISOString(),
  };
}

export async function deleteChatMessage(messageId: string): Promise<ChatMessage> {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) throw new Error("Authentication required.");
  const ctx = findMessageContext(messageId);
  if (!ctx) throw new Error("Message not found.");

  const db = getFirebaseDb();
  const msgRef = doc(db, "conversations", ctx.msg.threadKey, "messages", messageId);
  try {
    await updateDoc(msgRef, {
      text: "",
      mediaUrl: null,
      mediaId: null,
      mediaKind: null,
      mediaName: null,
      deletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `conversations/${ctx.msg.threadKey}/messages/${messageId}`,
    );
  }

  const threadMsgs = state.threads[ctx.peerId] ?? [];
  if (threadMsgs[threadMsgs.length - 1]?.id === messageId) {
    await updateDoc(doc(db, "conversations", ctx.msg.threadKey), {
      lastMessageText: "Message deleted",
      lastMessageDeleted: true,
      lastMessageMediaKind: null,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }

  return {
    ...ctx.msg,
    text: "Message deleted",
    mediaUrl: null,
    mediaId: null,
    mediaKind: null,
    mediaName: null,
    deletedAt: new Date().toISOString(),
  };
}

export async function reactToMessage(
  messageId: string,
  emoji: string,
): Promise<MessageReactionGroup[]> {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) throw new Error("Authentication required.");
  const uid = fbUser.uid;
  const ctx = findMessageContext(messageId);
  if (!ctx) throw new Error("Message not found.");

  const [participantA = "", participantB = ""] = ctx.msg.threadKey.split("__");
  const isMeA = participantA === uid;
  const cleanEmoji = emoji.trim().slice(0, 12);

  const alreadyReactedSame = ctx.msg.reactions.some((g) => g.emoji === cleanEmoji && g.reactedByMe);
  const nextVal = !cleanEmoji || alreadyReactedSame ? null : cleanEmoji;

  const db = getFirebaseDb();
  const msgRef = doc(db, "conversations", ctx.msg.threadKey, "messages", messageId);
  try {
    await updateDoc(msgRef, {
      ...(isMeA ? { reactionA: nextVal } : { reactionB: nextVal }),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `conversations/${ctx.msg.threadKey}/messages/${messageId}`,
    );
  }

  const otherGroup = ctx.msg.reactions.find((g) =>
    g.userIds.includes(isMeA ? participantB : participantA),
  );
  return buildReactionGroups(
    isMeA ? nextVal : (otherGroup?.emoji ?? null),
    isMeA ? (otherGroup?.emoji ?? null) : nextVal,
    participantA,
    participantB,
    uid,
  );
}

export async function updateConversationSettings(
  peerId: string,
  patch: { pinned?: boolean; muted?: boolean },
) {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) throw new Error("Authentication required.");
  const uid = fbUser.uid;
  const key = await ensureConversationDoc(uid, peerId);
  const [participantA] = key.split("__");
  const isMeA = participantA === uid;
  const existing = convDocsMap.get(key);
  const pinned =
    patch.pinned !== undefined
      ? patch.pinned
      : Boolean(isMeA ? existing?.pinnedA : existing?.pinnedB);
  const muted =
    patch.muted !== undefined ? patch.muted : Boolean(isMeA ? existing?.mutedA : existing?.mutedB);

  const db = getFirebaseDb();
  try {
    await updateDoc(doc(db, "conversations", key), {
      ...(isMeA ? { pinnedA: pinned, mutedA: muted } : { pinnedB: pinned, mutedB: muted }),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `conversations/${key}`);
  }

  return { ok: true, pinned, muted };
}

export function sendTyping(peerId: string, active: boolean) {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser || !peerId) return;
  const uid = fbUser.uid;
  const key = threadKeyFor(uid, peerId);
  if (!convDocsMap.has(key)) return;
  const [participantA] = key.split("__");
  const isMeA = participantA === uid;
  void updateDoc(doc(getFirebaseDb(), "conversations", key), {
    ...(isMeA ? { typingA: active } : { typingB: active }),
    updatedAt: serverTimestamp(),
  }).catch(() => {});
}

export async function fetchGallery(): Promise<GalleryItem[]> {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) return [];
  try {
    const idToken = await fbUser.getIdToken();
    const resp = await fetch("/api/gallery", {
      headers: { Authorization: `Bearer ${idToken}` },
      credentials: "include",
    });
    if (!resp.ok) return state.gallery;
    const data = (await resp.json()) as { items?: GalleryItem[] };
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      uploadedMediaMeta.set(item.id, {
        url: item.url,
        kind: item.kind,
        name: item.originalName,
      });
    }
    setState({ gallery: items });
    return items;
  } catch {
    return state.gallery;
  }
}

export async function deleteGalleryMedia(mediaId: string): Promise<void> {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) throw new Error("Authentication required.");
  const idToken = await fbUser.getIdToken();
  const resp = await fetch(`/api/media/${encodeURIComponent(mediaId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${idToken}` },
    credentials: "include",
  });
  const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!resp.ok) {
    throw new Error(data.error || "Could not delete media.");
  }
  uploadedMediaMeta.delete(mediaId);
  evictMediaObjectUrl(`/api/media/${mediaId}`);
  setState({
    gallery: state.gallery.filter((item) => item.id !== mediaId),
  });
}

export async function loadBlocks() {
  return state.blockedUsers;
}

export async function blockUser(targetUserId: string) {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) throw new Error("Authentication required.");
  const uid = fbUser.uid;
  const blockId = `${uid}__${targetUserId}`;
  const db = getFirebaseDb();
  try {
    await setDoc(doc(db, "blocks", blockId), {
      blockerId: uid,
      blockedId: targetUserId,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `blocks/${blockId}`);
  }
}

export async function unblockUser(targetUserId: string) {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) throw new Error("Authentication required.");
  const uid = fbUser.uid;
  const blockId = `${uid}__${targetUserId}`;
  const db = getFirebaseDb();
  try {
    await deleteDoc(doc(db, "blocks", blockId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `blocks/${blockId}`);
  }
}

export async function reportUser(reportedUserId: string, reason: string, details = "") {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) throw new Error("Authentication required.");
  const cleanReason = reason.trim().slice(0, 120);
  if (cleanReason.length < 2) throw new Error("Please select a reason for this report.");
  const reportId = `rep_${crypto.randomUUID().replace(/-/g, "")}`;
  const db = getFirebaseDb();
  try {
    await setDoc(doc(db, "reports", reportId), {
      reporterId: fbUser.uid,
      reportedUserId,
      reason: cleanReason,
      details: details.trim().slice(0, 500),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `reports/${reportId}`);
  }
  return { ok: true, reportId };
}

export async function initiateCall(target: PublicAccount, kind: "audio" | "video") {
  if (!callClient) throw new Error("Sign in to place a call.");
  if (blockedByMeMap.has(target.id) || blockedMeIds.has(target.id))
    throw new Error("Calling is blocked.");
  await callClient.dial(target, kind);
}

export function respondToCall(
  id: string,
  _targetId: string,
  action: "accepted" | "declined" | "ended",
) {
  void callClient?.respond(id, action);
}

export function setSoundEnabled(enabled: boolean) {
  if (typeof window !== "undefined") {
    localStorage.setItem(SOUND_STORAGE_KEY, String(enabled));
  }
  setState({ soundEnabled: enabled });
  const fbUser = getFirebaseAuth().currentUser;
  if (fbUser) {
    void updateDoc(doc(getFirebaseDb(), "users_private", fbUser.uid), {
      soundEnabled: enabled,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }
}

export function initialsOf(name: string) {
  const parts = name
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

export function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export async function fetchReadingState(): Promise<{
  state: Record<string, unknown> | null;
  updatedAt: string | null;
}> {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) return { state: null, updatedAt: null };
  const db = getFirebaseDb();
  let snap;
  try {
    snap = await getDoc(doc(db, "reading_state", fbUser.uid));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `reading_state/${fbUser.uid}`);
  }
  if (!snap.exists()) return { state: null, updatedAt: null };
  const data = snap.data() as Record<string, unknown>;
  return {
    state: data,
    updatedAt: tsToIsoOrNull(data["updatedAt"] as Timestamp | undefined),
  };
}

export async function saveReadingState(readingState: Record<string, unknown>) {
  const fbUser = getFirebaseAuth().currentUser;
  if (!fbUser) throw new Error("Authentication required.");
  const db = getFirebaseDb();
  const uid = fbUser.uid;
  const rawProfile =
    typeof readingState["profile"] === "object" && readingState["profile"] !== null
      ? (readingState["profile"] as Record<string, unknown>)
      : {};

  const sanitized = {
    uid,
    onboarded: Boolean(readingState["onboarded"]),
    languages: Array.isArray(readingState["languages"])
      ? readingState["languages"].slice(0, 20)
      : [],
    categories: Array.isArray(readingState["categories"])
      ? readingState["categories"].slice(0, 30)
      : [],
    appTheme:
      readingState["appTheme"] === "light" ||
      readingState["appTheme"] === "dark" ||
      readingState["appTheme"] === "system"
        ? readingState["appTheme"]
        : "system",
    reader:
      typeof readingState["reader"] === "object" && readingState["reader"] !== null
        ? readingState["reader"]
        : {},
    notifications:
      typeof readingState["notifications"] === "object" && readingState["notifications"] !== null
        ? readingState["notifications"]
        : { reminders: true, newBooks: true },
    profile: {
      name: String(rawProfile["name"] ?? state.me?.fullName ?? "Reader").slice(0, 80),
      email: String(rawProfile["email"] ?? fbUser.email ?? "reader@readingcorner.app").slice(
        0,
        254,
      ),
    },
    progress:
      typeof readingState["progress"] === "object" && readingState["progress"] !== null
        ? readingState["progress"]
        : {},
    favorites: Array.isArray(readingState["favorites"])
      ? readingState["favorites"].slice(0, 500)
      : [],
    bookmarks: Array.isArray(readingState["bookmarks"])
      ? readingState["bookmarks"].slice(0, 500)
      : [],
    completed: Array.isArray(readingState["completed"])
      ? readingState["completed"].slice(0, 500)
      : [],
    history: Array.isArray(readingState["history"]) ? readingState["history"].slice(0, 100) : [],
    streak:
      typeof readingState["streak"] === "number" && Number.isInteger(readingState["streak"])
        ? Math.max(0, readingState["streak"])
        : 1,
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, "reading_state", uid), sanitized);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `reading_state/${uid}`);
  }
  return { ok: true, updatedAt: new Date().toISOString() };
}
