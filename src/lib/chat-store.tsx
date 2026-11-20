import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import type { SecretThemeId } from "@/lib/secret-themes";

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
  email?: string | null;
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
  status: "ringing" | "accepted" | "declined" | "ended";
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
  legacyAccounts: LegacyAccountHint[];
  wsConnected: boolean;
};

const TOKEN_STORAGE_KEY = "reading-corner.session-token.v3";
const SOUND_STORAGE_KEY = "reading-corner.chat-sound.v3";
const LEGACY_CHAT_KEY = "reading-corner.chat.v2";

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
  legacyAccounts: [],
  wsConnected: false,
};

let state: ChatClientState = INITIAL;
const listeners = new Set<() => void>();
let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let heartbeatTimer: number | null = null;
let initialized = false;

function emit() {
  listeners.forEach((l) => l());
}

function setState(patch: Partial<ChatClientState>) {
  state = { ...state, ...patch };
  emit();
}

function sortConversations(convs: ConversationItem[]) {
  return [...convs].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.lastMessage?.createdAt ?? "").localeCompare(a.lastMessage?.createdAt ?? "");
  });
}

function playNotificationTone() {
  if (!state.soundEnabled || typeof window === "undefined") return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.19);
  } catch {
    /* audio context blocked before user gesture */
  }
}

async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (state.sessionToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${state.sessionToken}`);
  }
  if (!(init.body instanceof FormData) && init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const resp = await fetch(url, {
    ...init,
    headers,
    credentials: "include",
  });
  const data = (await resp.json().catch(() => ({}))) as T & {
    error?: string;
    needsConfig?: boolean;
  };
  if (!resp.ok) {
    const err = new Error(data.error || `Request failed (${resp.status})`) as Error & {
      status?: number;
      needsConfig?: boolean;
    };
    err.status = resp.status;
    if (data.needsConfig) err.needsConfig = true;
    throw err;
  }
  return data;
}

function disconnectWs() {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (heartbeatTimer) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  setState({ wsConnected: false });
}

function connectWs(token: string) {
  if (typeof window === "undefined") return;
  disconnectWs();

  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
  const socket = new WebSocket(url);
  ws = socket;

  socket.onopen = () => {
    setState({ wsConnected: true });
    heartbeatTimer = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ event: "ping" }));
      }
    }, 25_000);
  };

  socket.onmessage = (ev) => {
    try {
      const frame = JSON.parse(String(ev.data)) as {
        event: string;
        payload: Record<string, unknown>;
      };
      handleWsEvent(frame.event, frame.payload);
    } catch {
      /* ignore */
    }
  };

  socket.onclose = () => {
    setState({ wsConnected: false });
    if (heartbeatTimer) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (state.sessionToken && state.me) {
      reconnectTimer = window.setTimeout(() => {
        if (state.sessionToken) connectWs(state.sessionToken);
      }, 2500);
    }
  };
}

function updateMessageInThreads(msgId: string, updater: (msg: ChatMessage) => ChatMessage) {
  const nextThreads: Record<string, ChatMessage[]> = {};
  let changed = false;
  for (const [peerId, list] of Object.entries(state.threads)) {
    let listChanged = false;
    const updatedList = list.map((m) => {
      if (m.id === msgId) {
        listChanged = true;
        return updater(m);
      }
      return m;
    });
    if (listChanged) changed = true;
    nextThreads[peerId] = updatedList;
  }

  const nextConvs = state.conversations.map((c) =>
    c.lastMessage?.id === msgId ? { ...c, lastMessage: updater(c.lastMessage) } : c,
  );

  if (changed) {
    setState({ threads: nextThreads, conversations: nextConvs });
  } else {
    setState({ conversations: nextConvs });
  }
}

function handleWsEvent(event: string, payload: Record<string, unknown>) {
  if (event === "message:new") {
    const msg = payload["message"] as ChatMessage | undefined;
    const sender = payload["sender"] as PublicAccount | undefined;
    if (!msg || !state.me) return;

    const peerId = msg.from === state.me.id ? msg.to : msg.from;
    const existing = state.threads[peerId] ?? [];
    if (!existing.some((m) => m.id === msg.id)) {
      setState({
        threads: { ...state.threads, [peerId]: [...existing, msg] },
      });
    }

    const existingConv = state.conversations.find((c) => c.peer.id === peerId);
    if (existingConv) {
      const updatedConvs = sortConversations(
        state.conversations.map((c) => {
          if (c.peer.id !== peerId) return c;
          const isIncoming = msg.from !== state.me?.id;
          const isViewing = state.activePeerId === peerId;
          return {
            ...c,
            lastMessage: msg,
            unreadCount: isIncoming && !isViewing ? c.unreadCount + 1 : 0,
          };
        }),
      );
      setState({ conversations: updatedConvs });
    } else {
      void loadConversations();
    }

    if (msg.from !== state.me.id) {
      if (state.activePeerId === peerId) {
        void markThreadSeen(peerId);
      } else if (!existingConv?.muted) {
        playNotificationTone();
        toast(sender?.fullName ?? "New message", {
          description: msg.text,
          action: {
            label: "Open",
            onClick: () => {
              void openThread(peerId);
            },
          },
        });
      }
    }
    return;
  }

  if (event === "message:updated" || event === "message:deleted") {
    const msg = payload["message"] as ChatMessage | undefined;
    if (!msg) return;
    updateMessageInThreads(msg.id, () => msg);
    return;
  }

  if (event === "message:reaction") {
    const messageId = String(payload["messageId"] ?? "");
    const reactions = (payload["reactions"] as MessageReactionGroup[] | undefined) ?? [];
    if (!messageId) return;
    updateMessageInThreads(messageId, (m) => ({ ...m, reactions }));
    return;
  }

  if (event === "messages:delivered") {
    const byUserId = String(payload["byUserId"] ?? "");
    const deliveredAt = String(payload["deliveredAt"] ?? new Date().toISOString());
    if (!state.me || !byUserId) return;
    const peerId = byUserId === state.me.id ? String(payload["peerId"] ?? "") : byUserId;
    if (!peerId) return;

    const thread = state.threads[peerId];
    if (thread) {
      setState({
        threads: {
          ...state.threads,
          [peerId]: thread.map((m) =>
            m.to === byUserId && !m.deliveredAt ? { ...m, deliveredAt } : m,
          ),
        },
      });
    }
    setState({
      conversations: state.conversations.map((c) =>
        c.peer.id === peerId &&
        c.lastMessage &&
        c.lastMessage.to === byUserId &&
        !c.lastMessage.deliveredAt
          ? { ...c, lastMessage: { ...c.lastMessage, deliveredAt } }
          : c,
      ),
    });
    return;
  }

  if (event === "messages:seen") {
    const byUserId = String(payload["byUserId"] ?? "");
    const seenAt = String(payload["seenAt"] ?? new Date().toISOString());
    if (!state.me) return;
    const peerId = byUserId === state.me.id ? String(payload["peerId"] ?? "") : byUserId;
    if (!peerId) return;

    const thread = state.threads[peerId];
    if (thread) {
      setState({
        threads: {
          ...state.threads,
          [peerId]: thread.map((m) =>
            m.to === byUserId && !m.seenAt
              ? { ...m, seenAt, deliveredAt: m.deliveredAt ?? seenAt }
              : m,
          ),
        },
      });
    }
    setState({
      conversations: state.conversations.map((c) =>
        c.peer.id === peerId && c.lastMessage && c.lastMessage.to === byUserId
          ? {
              ...c,
              lastMessage: {
                ...c.lastMessage,
                seenAt,
                deliveredAt: c.lastMessage.deliveredAt ?? seenAt,
              },
            }
          : c,
      ),
    });
    return;
  }

  if (event === "typing") {
    const fromUserId = String(payload["fromUserId"] ?? "");
    const active = Boolean(payload["active"]);
    if (!fromUserId) return;
    setState({
      typingByPeer: { ...state.typingByPeer, [fromUserId]: active },
    });
    return;
  }

  if (event === "presence:update") {
    const userId = String(payload["userId"] ?? "");
    const online = Boolean(payload["online"]);
    const lastActiveAt = String(payload["lastActiveAt"] ?? new Date().toISOString());
    setState({
      conversations: state.conversations.map((c) =>
        c.peer.id === userId ? { ...c, peer: { ...c.peer, online, lastActiveAt } } : c,
      ),
      discoveredUsers: state.discoveredUsers.map((u) =>
        u.id === userId ? { ...u, online, lastActiveAt } : u,
      ),
    });
    return;
  }

  if (event === "follow:updated") {
    const followerId = String(payload["followerId"] ?? "");
    const followingId = String(payload["followingId"] ?? "");
    const isFollowing = Boolean(payload["isFollowing"]);
    const targetFollowerCount =
      typeof payload["targetFollowerCount"] === "number"
        ? payload["targetFollowerCount"]
        : undefined;
    const myFollowingCount =
      typeof payload["myFollowingCount"] === "number" ? payload["myFollowingCount"] : undefined;

    if (state.me) {
      if (followingId === state.me.id && targetFollowerCount !== undefined) {
        setState({ me: { ...state.me, followerCount: targetFollowerCount } });
      } else if (followerId === state.me.id && myFollowingCount !== undefined) {
        setState({ me: { ...state.me, followingCount: myFollowingCount } });
      }
    }

    setState({
      discoveredUsers: state.discoveredUsers.map((u) => {
        if (u.id === followingId) {
          return {
            ...u,
            ...(targetFollowerCount !== undefined ? { followerCount: targetFollowerCount } : {}),
            ...(state.me && followerId === state.me.id ? { isFollowing } : {}),
          };
        }
        if (u.id === followerId && state.me && followingId === state.me.id) {
          return { ...u, followsMe: isFollowing };
        }
        return u;
      }),
    });
    return;
  }

  if (event === "block:updated") {
    void loadConversations();
    void loadBlocks();
    return;
  }

  if (event === "call:incoming") {
    const callId = String(payload["callId"] ?? "");
    const callType = payload["callType"] === "video" ? "video" : "audio";
    const from = payload["from"] as PublicAccount | undefined;
    if (!callId || !from) return;
    playNotificationTone();
    setState({ incomingCall: { callId, callType, from } });
    return;
  }

  if (event === "call:error") {
    const error = String(payload["error"] ?? "Call blocked.");
    toast.error(error);
    setState({ outgoingCall: null });
    return;
  }

  if (event === "call:signal") {
    const action = String(payload["action"] ?? "");
    if (state.outgoingCall && payload["callId"] === state.outgoingCall.callId) {
      if (action === "accepted") {
        setState({ outgoingCall: { ...state.outgoingCall, status: "accepted" } });
      } else if (action === "declined" || action === "ended") {
        setState({ outgoingCall: null });
        toast(action === "declined" ? "Call declined" : "Call ended");
      }
    }
    if (state.incomingCall && payload["callId"] === state.incomingCall.callId) {
      if (action === "ended") {
        setState({ incomingCall: null });
      }
    }
  }
}

function readLegacyHints(): LegacyAccountHint[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LEGACY_CHAT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { accounts?: LegacyAccountHint[] };
    return Array.isArray(parsed.accounts) ? parsed.accounts : [];
  } catch {
    return [];
  }
}

async function bootstrap() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const savedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
  const savedSound = localStorage.getItem(SOUND_STORAGE_KEY);
  const legacyAccounts = readLegacyHints();

  if (savedSound === "false") {
    setState({ soundEnabled: false });
  }
  if (legacyAccounts.length > 0) {
    setState({ legacyAccounts });
  }
  if (savedToken) {
    setState({ sessionToken: savedToken });
  }

  try {
    const otpStatus = await apiFetch<{ configured: boolean }>("/api/auth/otp-status");
    setState({ otpConfigured: otpStatus.configured });
  } catch {
    /* ignore */
  }

  try {
    const meRes = await apiFetch<{ authenticated: boolean; user: PublicAccount | null }>(
      "/api/auth/session",
    );
    if (!meRes.authenticated || !meRes.user) {
      if (savedToken) localStorage.removeItem(TOKEN_STORAGE_KEY);
      setState({ me: null, sessionToken: null, ready: true });
      return;
    }
    setState({ me: meRes.user, ready: true });
    if (state.sessionToken) connectWs(state.sessionToken);
    void Promise.all([loadConversations(), loadBlocks(), fetchNfcLink(), fetchGallery()]);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    // Only clear stored session token when server confirms it is invalid/expired (401).
    if (status === 401) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      setState({ me: null, sessionToken: null, ready: true });
    } else {
      setState({ me: null, ready: true });
    }
  }
}

function subscribe(listener: () => void) {
  void bootstrap();
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
}) {
  const res = await apiFetch<{ token: string; user: PublicAccount }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
  localStorage.setItem(TOKEN_STORAGE_KEY, res.token);
  setState({ sessionToken: res.token, me: res.user, ready: true });
  connectWs(res.token);
  void Promise.all([loadConversations(), loadBlocks(), fetchNfcLink(), fetchGallery()]);
  return res.user;
}

export const registerWithPhone = registerAccount;

export async function loginAccount(input: {
  identifier?: string;
  email?: string;
  phone?: string;
  countryCode?: string;
  password: string;
}) {
  const res = await apiFetch<{ token: string; user: PublicAccount }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
  localStorage.setItem(TOKEN_STORAGE_KEY, res.token);
  setState({ sessionToken: res.token, me: res.user, ready: true });
  connectWs(res.token);
  void Promise.all([loadConversations(), loadBlocks(), fetchNfcLink(), fetchGallery()]);
  return res.user;
}

export const loginWithPhone = loginAccount;

export async function logout() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  disconnectWs();
  setState({
    me: null,
    sessionToken: null,
    conversations: [],
    discoveredUsers: [],
    activePeerId: null,
    threads: {},
    blockedUsers: [],
    nfc: null,
    gallery: [],
    incomingCall: null,
    outgoingCall: null,
  });
}

export async function sendOtp(input: {
  phone: string;
  countryCode: string;
  purpose: "reset_password" | "verify_phone" | "register";
}) {
  return apiFetch<{ ok: boolean; phoneMasked: string }>("/api/auth/otp/send", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function resetPasswordWithOtp(input: {
  phone: string;
  countryCode: string;
  code: string;
  newPassword: string;
}) {
  return apiFetch<{ ok: boolean }>("/api/auth/otp/reset-password", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function verifyMyPhoneOtp(code: string) {
  const res = await apiFetch<{ ok: boolean; phoneVerified: boolean }>(
    "/api/auth/otp/verify-phone",
    {
      method: "POST",
      body: JSON.stringify({ code }),
    },
  );
  if (state.me) {
    setState({ me: { ...state.me, phoneVerified: true } });
  }
  return res;
}

export async function changePassword(currentPassword: string, newPassword: string) {
  return apiFetch<{ ok: boolean }>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function updateMyProfile(patch: {
  fullName?: string;
  bio?: string;
  displayHandle?: string;
}) {
  const res = await apiFetch<{ user: PublicAccount }>("/api/profile", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  setState({ me: res.user });
  return res.user;
}

export async function uploadAvatar(file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await apiFetch<{ user: PublicAccount }>("/api/profile/avatar", {
    method: "POST",
    body: form,
  });
  setState({ me: res.user });
  return res.user;
}

export async function setSecretTheme(theme: SecretThemeId) {
  if (state.me) {
    setState({ me: { ...state.me, theme } });
  }
  await apiFetch<{ ok: boolean; theme: SecretThemeId }>("/api/profile/theme", {
    method: "PATCH",
    body: JSON.stringify({ theme }),
  });
}

export async function fetchNfcLink() {
  const res = await apiFetch<NfcLinkState>("/api/nfc");
  setState({ nfc: res });
  return res;
}

export async function regenerateNfcLink() {
  const res = await apiFetch<NfcLinkState>("/api/nfc/regenerate", { method: "POST" });
  setState({ nfc: res });
  return res;
}

export async function revokeNfcLink() {
  const res = await apiFetch<NfcLinkState>("/api/nfc/revoke", { method: "POST" });
  setState({ nfc: res });
  return res;
}

export async function resolveNfcToken(token: string) {
  return apiFetch<{
    status: "authorized" | "login_required";
    owner?: { id: string; fullName: string; displayHandle: string };
    signedInAsDifferentAccount?: boolean;
    ownerHint?: string;
  }>(`/api/nfc/resolve?token=${encodeURIComponent(token)}`);
}

export async function discoverUsers(q = "", filter: "all" | "following" | "followers" = "all") {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (filter !== "all") params.set("filter", filter);
  const res = await apiFetch<{ users: PublicAccount[] }>(`/api/users?${params.toString()}`);
  if (!q.trim() && filter === "all") {
    setState({ discoveredUsers: res.users });
  }
  return res.users;
}

export async function searchUsers(q: string) {
  const res = await apiFetch<{ users: PublicAccount[] }>(
    `/api/users/search?q=${encodeURIComponent(q)}`,
  );
  return res.users;
}

export async function fetchUserProfile(userId: string) {
  const res = await apiFetch<{ user: PublicAccount }>(`/api/users/${encodeURIComponent(userId)}`);
  return res.user;
}

export async function followUser(userId: string) {
  const res = await apiFetch<{
    ok: boolean;
    isFollowing: boolean;
    followerCount: number;
    followingCount: number;
    myFollowingCount: number;
  }>(`/api/users/${encodeURIComponent(userId)}/follow`, { method: "POST" });

  setState({
    me: state.me ? { ...state.me, followingCount: res.myFollowingCount } : state.me,
    discoveredUsers: state.discoveredUsers.map((u) =>
      u.id === userId ? { ...u, isFollowing: true, followerCount: res.followerCount } : u,
    ),
    conversations: state.conversations.map((c) =>
      c.peer.id === userId
        ? { ...c, peer: { ...c.peer, isFollowing: true, followerCount: res.followerCount } }
        : c,
    ),
  });
  return res;
}

export async function unfollowUser(userId: string) {
  const res = await apiFetch<{
    ok: boolean;
    isFollowing: boolean;
    followerCount: number;
    followingCount: number;
    myFollowingCount: number;
  }>(`/api/users/${encodeURIComponent(userId)}/follow`, { method: "DELETE" });

  setState({
    me: state.me ? { ...state.me, followingCount: res.myFollowingCount } : state.me,
    discoveredUsers: state.discoveredUsers.map((u) =>
      u.id === userId ? { ...u, isFollowing: false, followerCount: res.followerCount } : u,
    ),
    conversations: state.conversations.map((c) =>
      c.peer.id === userId
        ? { ...c, peer: { ...c.peer, isFollowing: false, followerCount: res.followerCount } }
        : c,
    ),
  });
  return res;
}

export async function loadConversations() {
  const res = await apiFetch<{ conversations: ConversationItem[] }>("/api/conversations");
  setState({ conversations: sortConversations(res.conversations) });
  return res.conversations;
}

export async function openThread(peerId: string | null) {
  setState({ activePeerId: peerId });
  if (!peerId) return;
  const res = await apiFetch<{
    peer: PublicAccount;
    blockedByMe: boolean;
    blockedMe: boolean;
    pinned: boolean;
    muted: boolean;
    messages: ChatMessage[];
  }>(`/api/messages/${encodeURIComponent(peerId)}`);

  const hasConv = state.conversations.some((c) => c.peer.id === peerId);
  const nextConvs = sortConversations(
    hasConv
      ? state.conversations.map((c) =>
          c.peer.id === peerId
            ? {
                ...c,
                peer: res.peer,
                blockedByMe: res.blockedByMe,
                blockedMe: res.blockedMe,
                pinned: res.pinned,
                muted: res.muted,
                unreadCount: 0,
              }
            : c,
        )
      : [
          {
            peer: res.peer,
            blockedByMe: res.blockedByMe,
            blockedMe: res.blockedMe,
            pinned: res.pinned,
            muted: res.muted,
            lastMessage: res.messages[res.messages.length - 1] ?? null,
            unreadCount: 0,
          },
          ...state.conversations,
        ],
  );

  setState({
    threads: { ...state.threads, [peerId]: res.messages },
    conversations: nextConvs,
  });

  await markThreadSeen(peerId);
}

export async function searchThreadMessages(peerId: string, q: string) {
  const res = await apiFetch<{ messages: ChatMessage[] }>(
    `/api/messages/${encodeURIComponent(peerId)}?q=${encodeURIComponent(q)}`,
  );
  return res.messages;
}

export async function markThreadSeen(peerId: string) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: "messages:seen", payload: { peerId } }));
  }
  await apiFetch("/api/messages/" + encodeURIComponent(peerId) + "/seen", { method: "POST" });
  setState({
    conversations: state.conversations.map((c) =>
      c.peer.id === peerId ? { ...c, unreadCount: 0 } : c,
    ),
  });
}

export async function uploadChatMedia(file: File, recipientId?: string) {
  const form = new FormData();
  form.append("file", file);
  if (recipientId) form.append("recipientId", recipientId);
  return apiFetch<{
    id: string;
    kind: MediaKind;
    mimeType: string;
    originalName: string;
    url: string;
  }>("/api/media", {
    method: "POST",
    body: form,
  });
}

export async function sendChatMessage(
  peerId: string,
  text: string,
  mediaId?: string | null,
  replyToId?: string | null,
) {
  const res = await apiFetch<{ message: ChatMessage; sender: PublicAccount }>("/api/messages", {
    method: "POST",
    body: JSON.stringify({
      peerId,
      text,
      mediaId: mediaId ?? null,
      replyToId: replyToId ?? null,
    }),
  });

  const existing = state.threads[peerId] ?? [];
  if (!existing.some((m) => m.id === res.message.id)) {
    setState({
      threads: { ...state.threads, [peerId]: [...existing, res.message] },
    });
  }
  void loadConversations();
  if (mediaId) void fetchGallery();
  return res.message;
}

export async function editChatMessage(messageId: string, text: string) {
  const res = await apiFetch<{ message: ChatMessage }>(
    `/api/messages/${encodeURIComponent(messageId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ text }),
    },
  );
  updateMessageInThreads(messageId, () => res.message);
  return res.message;
}

export async function deleteChatMessage(messageId: string) {
  const res = await apiFetch<{ ok: boolean; message: ChatMessage }>(
    `/api/messages/${encodeURIComponent(messageId)}`,
    {
      method: "DELETE",
    },
  );
  updateMessageInThreads(messageId, () => res.message);
  return res.message;
}

export async function reactToMessage(messageId: string, emoji: string) {
  const res = await apiFetch<{ ok: boolean; reactions: MessageReactionGroup[] }>(
    `/api/messages/${encodeURIComponent(messageId)}/reactions`,
    {
      method: "POST",
      body: JSON.stringify({ emoji }),
    },
  );
  updateMessageInThreads(messageId, (m) => ({ ...m, reactions: res.reactions }));
  return res.reactions;
}

export async function updateConversationSettings(
  peerId: string,
  patch: { pinned?: boolean; muted?: boolean },
) {
  const res = await apiFetch<{ ok: boolean; pinned: boolean; muted: boolean }>(
    `/api/conversations/${encodeURIComponent(peerId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
  );
  setState({
    conversations: sortConversations(
      state.conversations.map((c) =>
        c.peer.id === peerId ? { ...c, pinned: res.pinned, muted: res.muted } : c,
      ),
    ),
  });
  return res;
}

export function sendTyping(peerId: string, active: boolean) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: "typing", payload: { peerId, active } }));
  }
}

export async function fetchGallery() {
  const res = await apiFetch<{ items: GalleryItem[] }>("/api/gallery");
  setState({ gallery: res.items });
  return res.items;
}

export async function loadBlocks() {
  const res = await apiFetch<{ blockedUsers: BlockedUserItem[] }>("/api/blocks");
  setState({ blockedUsers: res.blockedUsers });
  return res.blockedUsers;
}

export async function blockUser(targetUserId: string) {
  await apiFetch("/api/blocks", {
    method: "POST",
    body: JSON.stringify({ targetUserId }),
  });
  await Promise.all([loadBlocks(), loadConversations()]);
  if (state.activePeerId === targetUserId) {
    await openThread(targetUserId);
  }
}

export async function unblockUser(targetUserId: string) {
  await apiFetch(`/api/blocks/${encodeURIComponent(targetUserId)}`, {
    method: "DELETE",
  });
  await Promise.all([loadBlocks(), loadConversations()]);
  if (state.activePeerId === targetUserId) {
    await openThread(targetUserId);
  }
}

export async function reportUser(reportedUserId: string, reason: string, details = "") {
  return apiFetch<{ ok: boolean; reportId: string }>("/api/reports", {
    method: "POST",
    body: JSON.stringify({ reportedUserId, reason, details }),
  });
}

export async function initiateCall(target: PublicAccount, callType: "audio" | "video") {
  const res = await apiFetch<{ ok: boolean; callId: string }>("/api/calls/initiate", {
    method: "POST",
    body: JSON.stringify({ targetUserId: target.id, callType }),
  });
  setState({
    outgoingCall: { callId: res.callId, callType, target, status: "ringing" },
  });
  return res.callId;
}

export function respondToCall(
  callId: string,
  targetId: string,
  action: "accepted" | "declined" | "ended",
) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: "call:signal", payload: { callId, targetId, action } }));
  }
  if (action === "declined" || action === "ended") {
    setState({ incomingCall: null, outgoingCall: null });
  }
}

export function setSoundEnabled(enabled: boolean) {
  localStorage.setItem(SOUND_STORAGE_KEY, String(enabled));
  setState({ soundEnabled: enabled });
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

export async function fetchReadingState() {
  return apiFetch<{ state: Record<string, unknown> | null; updatedAt: string | null }>(
    "/api/reading-state",
  );
}

export async function saveReadingState(readingState: Record<string, unknown>) {
  return apiFetch<{ ok: boolean; updatedAt: string }>("/api/reading-state", {
    method: "PUT",
    body: JSON.stringify({ state: readingState }),
  });
}
