import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-api-test-"));
process.env["DATA_DIR"] = testDataDir;

const { createApiRouter } = await import("./api");

let server: http.Server;
let baseUrl = "";

test.before(async () => {
  const app = express();
  app.use("/api", createApiRouter());
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${addr.port}/api`;
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

async function api<T>(
  pathname: string,
  opts: { method?: string; body?: unknown; token?: string | null } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const resp = await fetch(`${baseUrl}${pathname}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await resp.json().catch(() => ({}))) as T & { error?: string };
  return { status: resp.status, data };
}

test("Account registration, duplicate prevention, session persistence, discovery privacy, follow & Instagram DM lifecycle", async () => {
  // 1. Register User A
  const regA = await api<{ token: string; user: Record<string, unknown> }>("/auth/register", {
    method: "POST",
    body: {
      fullName: "Alice Reader",
      username: "alice_reader",
      email: "Alice@Example.com",
      password: "Password123!",
      bio: "Sci-fi and poetry enthusiast",
    },
  });
  assert.equal(regA.status, 201);
  assert.ok(regA.data.token);
  assert.equal(regA.data.user["email"], "alice@example.com");
  assert.equal(regA.data.user["displayHandle"], "@alice_reader");
  assert.equal(regA.data.user["password_hash"], undefined);

  // 2. Duplicate email must fail (case-insensitive)
  const dupEmail = await api("/auth/register", {
    method: "POST",
    body: {
      fullName: "Another Alice",
      username: "alice_two",
      email: "ALICE@example.com",
      password: "Password123!",
    },
  });
  assert.equal(dupEmail.status, 409);

  // 3. Session restore via /auth/me works
  const meA = await api<{ user: Record<string, unknown> }>("/auth/me", {
    token: regA.data.token,
  });
  assert.equal(meA.status, 200);
  assert.equal(meA.data.user["id"], regA.data.user["id"]);

  // 4. Logout & re-login via email and via username
  await api("/auth/logout", { method: "POST", token: regA.data.token });
  const afterLogout = await api("/auth/me", { token: regA.data.token });
  assert.equal(afterLogout.status, 401);

  const loginEmail = await api<{ token: string; user: Record<string, unknown> }>("/auth/login", {
    method: "POST",
    body: { identifier: "alice@example.com", password: "Password123!" },
  });
  assert.equal(loginEmail.status, 200);
  const tokenA = loginEmail.data.token;

  const loginUsername = await api<{ token: string }>("/auth/login", {
    method: "POST",
    body: { identifier: "@alice_reader", password: "Password123!" },
  });
  assert.equal(loginUsername.status, 200);

  // 5. Register User B
  const regB = await api<{ token: string; user: Record<string, unknown> }>("/auth/register", {
    method: "POST",
    body: {
      fullName: "Bob Writer",
      username: "bob_writer",
      email: "bob.private@example.com",
      password: "BobPassword123!",
      phone: "9876543210",
      countryCode: "+91",
    },
  });
  assert.equal(regB.status, 201);
  const tokenB = regB.data.token;
  const userBId = String(regB.data.user["id"]);
  const userAId = String(regA.data.user["id"]);

  // 6. User Discovery returns User B WITHOUT leaking private info
  const discoverRes = await api<{ users: Record<string, unknown>[] }>("/users?q=bob", {
    token: tokenA,
  });
  assert.equal(discoverRes.status, 200);
  assert.equal(discoverRes.data.users.length, 1);
  const publicBob = discoverRes.data.users[0]!;
  assert.equal(publicBob["id"], userBId);
  assert.equal(publicBob["displayHandle"], "@bob_writer");
  assert.equal(publicBob["email"], undefined);
  assert.equal(publicBob["phoneE164"], undefined);
  assert.equal(publicBob["phoneMasked"], undefined);
  assert.equal(publicBob["password_hash"], undefined);

  // 7. Follow / Unfollow updates followerCount & followingCount
  const followRes = await api<{
    isFollowing: boolean;
    followerCount: number;
    myFollowingCount: number;
  }>(`/users/${userBId}/follow`, { method: "POST", token: tokenA });
  assert.equal(followRes.status, 200);
  assert.equal(followRes.data.isFollowing, true);
  assert.equal(followRes.data.followerCount, 1);
  assert.equal(followRes.data.myFollowingCount, 1);

  const bobProfile = await api<{ user: Record<string, unknown> }>(`/users/${userBId}`, {
    token: tokenA,
  });
  assert.equal(bobProfile.data.user["followerCount"], 1);
  assert.equal(bobProfile.data.user["isFollowing"], true);

  // 8. Messaging: Send, Reply, React, Edit, Search, Pin/Mute, Delete, Report & Block
  const send1 = await api<{ message: { id: string; text: string } }>("/messages", {
    method: "POST",
    token: tokenA,
    body: { peerId: userBId, text: "Hello Bob! Excited to read Dune." },
  });
  assert.equal(send1.status, 201);
  const msg1Id = send1.data.message.id;

  const reply2 = await api<{
    message: { id: string; replyTo: { id: string; text: string } | null };
  }>("/messages", {
    method: "POST",
    token: tokenB,
    body: { peerId: userAId, text: "Hi Alice! Great choice.", replyToId: msg1Id },
  });
  assert.equal(reply2.status, 201);
  assert.equal(reply2.data.message.replyTo?.id, msg1Id);
  const msg2Id = reply2.data.message.id;

  // React to Bob's message
  const reactRes = await api<{ reactions: { emoji: string; count: number }[] }>(
    `/messages/${msg2Id}/reactions`,
    {
      method: "POST",
      token: tokenA,
      body: { emoji: "❤️" },
    },
  );
  assert.equal(reactRes.status, 200);
  assert.equal(reactRes.data.reactions[0]?.emoji, "❤️");
  assert.equal(reactRes.data.reactions[0]?.count, 1);

  // Edit own message
  const editRes = await api<{ message: { text: string; editedAt: string | null } }>(
    `/messages/${msg1Id}`,
    {
      method: "PATCH",
      token: tokenA,
      body: { text: "Hello Bob! Excited to read Dune Part 1." },
    },
  );
  assert.equal(editRes.status, 200);
  assert.ok(editRes.data.message.editedAt);

  // In-thread search
  const searchMsgRes = await api<{ messages: { id: string }[] }>(`/messages/${userBId}?q=Dune`, {
    token: tokenA,
  });
  assert.equal(searchMsgRes.status, 200);
  assert.equal(searchMsgRes.data.messages.length, 1);

  // Pin & Mute conversation
  const pinRes = await api<{ pinned: boolean; muted: boolean }>(`/conversations/${userBId}`, {
    method: "PATCH",
    token: tokenA,
    body: { pinned: true, muted: true },
  });
  assert.equal(pinRes.status, 200);
  assert.equal(pinRes.data.pinned, true);
  assert.equal(pinRes.data.muted, true);

  // Delete own message
  const delRes = await api<{ ok: boolean; message: { deletedAt: string | null } }>(
    `/messages/${msg1Id}`,
    { method: "DELETE", token: tokenA },
  );
  assert.equal(delRes.status, 200);
  assert.ok(delRes.data.message.deletedAt);

  // Report user
  const reportRes = await api<{ ok: boolean; reportId: string }>("/reports", {
    method: "POST",
    token: tokenA,
    body: { reportedUserId: userBId, reason: "Spam", details: "Test report" },
  });
  assert.equal(reportRes.status, 201);
  assert.ok(reportRes.data.reportId);

  // Block prevents sending messages
  await api("/blocks", {
    method: "POST",
    token: tokenA,
    body: { targetUserId: userBId },
  });
  const blockedSend = await api("/messages", {
    method: "POST",
    token: tokenB,
    body: { peerId: userAId, text: "Should fail" },
  });
  assert.equal(blockedSend.status, 403);
});

test("Gallery real image upload, binary retrieval, and owner-only delete", async () => {
  const regOwner = await api<{ token: string; user: { id: string } }>("/auth/register", {
    method: "POST",
    body: {
      fullName: "Gallery Owner",
      username: "gallery_owner",
      email: "gallery.owner@example.com",
      password: "Password123!",
    },
  });
  assert.equal(regOwner.status, 201);
  const ownerToken = regOwner.data.token;

  const regOther = await api<{ token: string; user: { id: string } }>("/auth/register", {
    method: "POST",
    body: {
      fullName: "Gallery Other",
      username: "gallery_other",
      email: "gallery.other@example.com",
      password: "Password123!",
    },
  });
  assert.equal(regOther.status, 201);
  const otherToken = regOther.data.token;

  // Minimal valid 1x1 PNG binary
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const form = new FormData();
  form.append("file", new Blob([pngBytes], { type: "image/png" }), "cover-photo.png");

  const uploadResp = await fetch(`${baseUrl}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: form,
  });
  assert.equal(uploadResp.status, 201);
  const uploaded = (await uploadResp.json()) as {
    id: string;
    kind: string;
    mimeType: string;
    originalName: string;
    sizeBytes: number;
    url: string;
    mine: boolean;
  };
  assert.equal(uploaded.kind, "image");
  assert.equal(uploaded.mimeType, "image/png");
  assert.equal(uploaded.originalName, "cover-photo.png");
  assert.equal(uploaded.sizeBytes, pngBytes.length);
  assert.equal(uploaded.mine, true);

  // Listed in /api/gallery
  const galleryRes = await api<{ items: { id: string; url: string; mine: boolean }[] }>(
    "/gallery",
    { token: ownerToken },
  );
  assert.equal(galleryRes.status, 200);
  assert.equal(galleryRes.data.items.length, 1);
  assert.equal(galleryRes.data.items[0]?.id, uploaded.id);
  assert.equal(galleryRes.data.items[0]?.mine, true);

  // Real binary image served with image/png content-type
  const mediaResp = await fetch(`${baseUrl}/media/${uploaded.id}`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(mediaResp.status, 200);
  assert.equal(mediaResp.headers.get("content-type"), "image/png");
  const downloadedBytes = Buffer.from(await mediaResp.arrayBuffer());
  assert.deepEqual(downloadedBytes, pngBytes);

  // Another user cannot delete it
  const forbiddenDel = await api(`/media/${uploaded.id}`, {
    method: "DELETE",
    token: otherToken,
  });
  assert.equal(forbiddenDel.status, 403);

  // Owner can delete it
  const ownerDel = await api<{ ok: boolean; id: string }>(`/media/${uploaded.id}`, {
    method: "DELETE",
    token: ownerToken,
  });
  assert.equal(ownerDel.status, 200);
  assert.equal(ownerDel.data.ok, true);
  assert.equal(ownerDel.data.id, uploaded.id);

  // No longer in gallery or accessible on disk
  const afterGallery = await api<{ items: unknown[] }>("/gallery", { token: ownerToken });
  assert.equal(afterGallery.status, 200);
  assert.equal(afterGallery.data.items.length, 0);

  const afterMedia = await fetch(`${baseUrl}/media/${uploaded.id}`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(afterMedia.status, 404);
});
