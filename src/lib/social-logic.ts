export type SecretThemeId = "instagram" | "emerald" | "dark";

export function threadKeyFor(userA: string, userB: string): string {
  return [userA, userB].sort().join("__");
}

export function normalizeHandle(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 28)
    .toLowerCase();
  if (cleaned.length < 2) return null;
  return `@${cleaned}`;
}

export function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) return null;
  return trimmed;
}

export function makeHandleCandidates(
  fullName: string,
  email: string | null,
  uid: string,
): string[] {
  const emailPrefix = email ? (email.split("@")[0] ?? "") : "";
  const slugFromName = fullName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 18);
  const slugFromEmail = emailPrefix
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "")
    .slice(0, 18);
  const base =
    slugFromName.length >= 2 ? slugFromName : slugFromEmail.length >= 2 ? slugFromEmail : "reader";
  const uidTail =
    uid
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(-4) || "01";
  const candidates = [
    `@${base}`,
    `@${base}.${uidTail}`,
    `@${base}.${uid
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 6)}`,
  ];
  return Array.from(new Set(candidates)).map((c) => c.slice(0, 29));
}

export function resolveLandingDestination(input: {
  chatReady: boolean;
  libraryReady: boolean;
  isSignedIn: boolean;
  onboarded: boolean;
}): "/home" | null {
  if (!input.chatReady || !input.libraryReady) return null;
  if (input.isSignedIn || input.onboarded) return "/home";
  return null;
}

export type MinimalPublicUser = {
  id: string;
  fullName: string;
  displayHandle: string;
  bio: string;
  online: boolean;
  lastActiveAt: string;
  isFollowing?: boolean;
  followsMe?: boolean;
};

export function filterAndSortUsers<T extends MinimalPublicUser>(
  users: T[],
  query: string,
  filter: "all" | "following" | "followers" = "all",
): T[] {
  const q = query.trim().toLowerCase();
  let list = users;
  if (q) {
    list = list.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        u.displayHandle.toLowerCase().includes(q) ||
        u.bio.toLowerCase().includes(q),
    );
  }
  if (filter === "following") {
    list = list.filter((u) => Boolean(u.isFollowing));
  } else if (filter === "followers") {
    list = list.filter((u) => Boolean(u.followsMe));
  }
  return [...list].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return b.lastActiveAt.localeCompare(a.lastActiveAt);
  });
}

export function splitChatSidebarUsers<T extends MinimalPublicUser>(
  discoveredUsers: T[],
  conversationPeerIds: Set<string>,
): T[] {
  return discoveredUsers.filter((u) => !conversationPeerIds.has(u.id));
}

export type MinimalConversation = {
  unreadCount: number;
};

export function filterConversationsByTab<T extends MinimalConversation>(
  conversations: T[],
  tab: "all" | "unread",
): T[] {
  if (tab === "unread") {
    return conversations.filter((c) => c.unreadCount > 0);
  }
  return conversations;
}

export function isDynamicImportError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return (
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed") ||
    msg.includes("error loading dynamically imported module") ||
    msg.includes("ChunkLoadError")
  );
}

export function isFirebaseOfflineError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const msg = error instanceof Error ? error.message : String(error ?? "");
  const lower = msg.toLowerCase();
  return (
    code === "unavailable" ||
    code === "auth/network-request-failed" ||
    lower.includes("the client is offline") ||
    lower.includes("because the client is offline") ||
    lower.includes("network-request-failed") ||
    lower.includes("could not reach cloud firestore backend")
  );
}

export type ChatEscapeAction =
  | "closeLightbox"
  | "closeProfileModal"
  | "closeGalleryPicker"
  | "closeMenu"
  | "closeReactionPicker"
  | "closeEmoji"
  | "closeThreadSearch"
  | "cancelReplyOrEdit"
  | "closeThread"
  | null;

export function resolveChatEscapeAction(input: {
  lightboxOpen: boolean;
  profileModalOpen: boolean;
  galleryPickerOpen: boolean;
  menuOpen: boolean;
  reactionPickerOpen: boolean;
  emojiOpen: boolean;
  threadSearchOpen: boolean;
  replyOrEditOpen: boolean;
  hasActivePeer: boolean;
}): ChatEscapeAction {
  if (input.lightboxOpen) return "closeLightbox";
  if (input.profileModalOpen) return "closeProfileModal";
  if (input.galleryPickerOpen) return "closeGalleryPicker";
  if (input.menuOpen) return "closeMenu";
  if (input.reactionPickerOpen) return "closeReactionPicker";
  if (input.emojiOpen) return "closeEmoji";
  if (input.threadSearchOpen) return "closeThreadSearch";
  if (input.replyOrEditOpen) return "cancelReplyOrEdit";
  if (input.hasActivePeer) return "closeThread";
  return null;
}

export function isControlSearchTrigger(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "control" || normalized === "(control)";
}

export function dedupeByKey<T>(items: readonly T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function dedupeUsersById<T extends { id: string }>(
  users: readonly T[],
  excludeUserId?: string | null,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const user of users) {
    if (!user?.id) continue;
    if (excludeUserId && user.id === excludeUserId) continue;
    if (seen.has(user.id)) continue;
    seen.add(user.id);
    out.push(user);
  }
  return out;
}

export function dedupeConversationsByPeerId<T extends { peer: { id: string } }>(
  conversations: readonly T[],
  excludePeerId?: string | null,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const conv of conversations) {
    const peerId = conv?.peer?.id;
    if (!peerId) continue;
    if (excludePeerId && peerId === excludePeerId) continue;
    if (seen.has(peerId)) continue;
    seen.add(peerId);
    out.push(conv);
  }
  return out;
}

export function dedupeMessagesById<T extends { id: string }>(messages: readonly T[]): T[] {
  return dedupeByKey(messages, (m) => m.id);
}
