import assert from "node:assert/strict";
import test from "node:test";

import {
  filterAndSortUsers,
  filterConversationsByTab,
  makeHandleCandidates,
  normalizeEmail,
  normalizeHandle,
  resolveLandingDestination,
  splitChatSidebarUsers,
  threadKeyFor,
  type MinimalPublicUser,
} from "./social-logic";

test("threadKeyFor orders participant IDs deterministically", () => {
  assert.equal(threadKeyFor("uid_b", "uid_a"), "uid_a__uid_b");
  assert.equal(threadKeyFor("uid_a", "uid_b"), "uid_a__uid_b");
});

test("normalizeHandle enforces @ prefix, allowed chars, and min length", () => {
  assert.equal(normalizeHandle("Aanya.Reads!"), "@aanya.reads");
  assert.equal(normalizeHandle("@Reader_1"), "@reader_1");
  assert.equal(normalizeHandle("a"), null);
  assert.equal(normalizeHandle("ab"), "@ab");
});

test("normalizeEmail rejects invalid emails and normalizes case", () => {
  assert.equal(normalizeEmail("  Reader@Example.COM "), "reader@example.com");
  assert.equal(normalizeEmail("not-an-email"), null);
});

test("makeHandleCandidates builds valid @handles", () => {
  const candidates = makeHandleCandidates("Mufeedha Rahman", "mufeedha@example.com", "uid12345");
  assert.ok(candidates.length >= 2);
  assert.ok(candidates.every((c) => /^@[a-z0-9._-]+$/.test(c)));
});

test("resolveLandingDestination skips welcome/onboarding once signed in or onboarded", () => {
  assert.equal(
    resolveLandingDestination({
      chatReady: false,
      libraryReady: true,
      isSignedIn: true,
      onboarded: false,
    }),
    null,
  );
  assert.equal(
    resolveLandingDestination({
      chatReady: true,
      libraryReady: true,
      isSignedIn: true,
      onboarded: false,
    }),
    "/home",
  );
  assert.equal(
    resolveLandingDestination({
      chatReady: true,
      libraryReady: true,
      isSignedIn: false,
      onboarded: true,
    }),
    "/home",
  );
  assert.equal(
    resolveLandingDestination({
      chatReady: true,
      libraryReady: true,
      isSignedIn: false,
      onboarded: false,
    }),
    null,
  );
});

test("filterAndSortUsers sorts online first and filters by query and follow tab", () => {
  const users: MinimalPublicUser[] = [
    {
      id: "u1",
      fullName: "Aanya Nair",
      displayHandle: "@aanya",
      bio: "Fiction lover",
      online: false,
      lastActiveAt: "2026-11-20T10:00:00.000Z",
      isFollowing: true,
      followsMe: false,
    },
    {
      id: "u2",
      fullName: "Zayd Ali",
      displayHandle: "@zayd.reads",
      bio: "Sci-fi and coffee",
      online: true,
      lastActiveAt: "2026-11-20T09:00:00.000Z",
      isFollowing: false,
      followsMe: true,
    },
  ];

  const all = filterAndSortUsers(users, "", "all");
  assert.equal(all[0]?.id, "u2");

  const search = filterAndSortUsers(users, "aanya", "all");
  assert.equal(search.length, 1);
  assert.equal(search[0]?.id, "u1");

  const followers = filterAndSortUsers(users, "", "followers");
  assert.equal(followers.length, 1);
  assert.equal(followers[0]?.id, "u2");
});

test("splitChatSidebarUsers returns registered users not yet in active conversations", () => {
  const allUsers: MinimalPublicUser[] = [
    {
      id: "u1",
      fullName: "User One",
      displayHandle: "@one",
      bio: "",
      online: true,
      lastActiveAt: "2026-11-20T10:00:00.000Z",
    },
    {
      id: "u2",
      fullName: "User Two",
      displayHandle: "@two",
      bio: "",
      online: false,
      lastActiveAt: "2026-11-20T09:00:00.000Z",
    },
  ];

  const rest = splitChatSidebarUsers(allUsers, new Set(["u1"]));
  assert.equal(rest.length, 1);
  assert.equal(rest[0]?.id, "u2");

  const whenNoConversations = splitChatSidebarUsers(allUsers, new Set());
  assert.equal(whenNoConversations.length, 2);
});

test("filterConversationsByTab filters unread conversations cleanly", () => {
  const convs = [
    { id: "c1", unreadCount: 0 },
    { id: "c2", unreadCount: 3 },
    { id: "c3", unreadCount: 1 },
  ];
  assert.equal(filterConversationsByTab(convs, "all").length, 3);
  const unread = filterConversationsByTab(convs, "unread");
  assert.deepEqual(
    unread.map((c) => c.id),
    ["c2", "c3"],
  );
});

test("isDynamicImportError and isFirebaseOfflineError classify transient network failures", async () => {
  const { isDynamicImportError, isFirebaseOfflineError } = await import("./social-logic");
  assert.equal(
    isDynamicImportError(
      new TypeError(
        "Failed to fetch dynamically imported module: https://app/src/routes/index.tsx",
      ),
    ),
    true,
  );
  assert.equal(isDynamicImportError(new Error("Unexpected render bug")), false);

  assert.equal(
    isFirebaseOfflineError(new Error("Failed to get document because the client is offline.")),
    true,
  );
  assert.equal(
    isFirebaseOfflineError(
      Object.assign(new Error("net"), { code: "auth/network-request-failed" }),
    ),
    true,
  );
  assert.equal(isFirebaseOfflineError(new Error("Missing or insufficient permissions.")), false);
});

test("resolveChatEscapeAction prioritizes topmost overlay before backing out of thread", async () => {
  const { resolveChatEscapeAction } = await import("./social-logic");
  const base = {
    lightboxOpen: false,
    profileModalOpen: false,
    galleryPickerOpen: false,
    menuOpen: false,
    reactionPickerOpen: false,
    emojiOpen: false,
    threadSearchOpen: false,
    replyOrEditOpen: false,
    hasActivePeer: true,
  };

  assert.equal(
    resolveChatEscapeAction({ ...base, lightboxOpen: true, menuOpen: true }),
    "closeLightbox",
  );
  assert.equal(
    resolveChatEscapeAction({ ...base, profileModalOpen: true, menuOpen: true }),
    "closeProfileModal",
  );
  assert.equal(resolveChatEscapeAction({ ...base, menuOpen: true }), "closeMenu");
  assert.equal(
    resolveChatEscapeAction({ ...base, reactionPickerOpen: true }),
    "closeReactionPicker",
  );
  assert.equal(resolveChatEscapeAction({ ...base, emojiOpen: true }), "closeEmoji");
  assert.equal(resolveChatEscapeAction({ ...base, threadSearchOpen: true }), "closeThreadSearch");
  assert.equal(resolveChatEscapeAction({ ...base, replyOrEditOpen: true }), "cancelReplyOrEdit");
  assert.equal(resolveChatEscapeAction(base), "closeThread");
  assert.equal(resolveChatEscapeAction({ ...base, hasActivePeer: false }), null);
});

test("isControlSearchTrigger matches control and (control) case-insensitively", async () => {
  const { isControlSearchTrigger } = await import("./social-logic");
  assert.equal(isControlSearchTrigger("control"), true);
  assert.equal(isControlSearchTrigger("  (Control)  "), true);
  assert.equal(isControlSearchTrigger("CONTROL"), true);
  assert.equal(isControlSearchTrigger("controllers"), false);
  assert.equal(isControlSearchTrigger("the alchemist"), false);
});
