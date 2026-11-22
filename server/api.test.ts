import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { WebSocket } from "ws";

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-api-test-"));
process.env["DATA_DIR"] = testDataDir;

const { createApiRouter } = await import("./api");
const { attachWebSocketServer } = await import("./ws");

let server: http.Server;
let baseUrl = "";
let wsBaseUrl = "";

test.before(async () => {
  const app = express();
  app.use("/api", createApiRouter());
  server = http.createServer(app);
  attachWebSocketServer(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${addr.port}/api`;
  wsBaseUrl = `ws://127.0.0.1:${addr.port}/ws`;
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

test("Personal NFC link generation, verification, regeneration, revocation, and /auth/session restore", async () => {
  const regA = await api<{ token: string; user: { id: string; fullName: string } }>(
    "/auth/register",
    {
      method: "POST",
      body: {
        fullName: "Nadia Reader",
        username: "nadia_reads",
        email: "nadia@example.com",
        password: "NadiaPassword123!",
      },
    },
  );
  assert.equal(regA.status, 201);
  const tokenA = regA.data.token;

  const regB = await api<{ token: string; user: { id: string } }>("/auth/register", {
    method: "POST",
    body: {
      fullName: "Sam Reader",
      username: "sam_reads",
      email: "sam@example.com",
      password: "SamPassword123!",
    },
  });
  assert.equal(regB.status, 201);
  const tokenB = regB.data.token;

  // Session check returns authenticated user for valid bearer token and null user without token
  const anonSess = await api<{ user: unknown }>("/auth/session");
  assert.equal(anonSess.status, 200);
  assert.equal(anonSess.data.user, null);

  const authSess = await api<{ user: { id: string; email: string } }>("/auth/session", {
    token: tokenA,
  });
  assert.equal(authSess.status, 200);
  assert.equal(authSess.data.user.id, regA.data.user.id);
  assert.equal(authSess.data.user.email, "nadia@example.com");

  // Fetch initial NFC personal link for User A
  const nfc1 = await api<{ token: string; path: string; version: number; revoked: boolean }>(
    "/nfc",
    { token: tokenA },
  );
  assert.equal(nfc1.status, 200);
  assert.equal(nfc1.data.revoked, false);
  assert.equal(nfc1.data.version, 1);
  assert.ok(nfc1.data.token);
  assert.equal(nfc1.data.path, `/nfc/${nfc1.data.token}`);

  // Owner session resolves as authorized; anonymous / different user gets login_required
  const resolveSelf = await api<{ status: string; owner?: { id: string } }>(
    `/nfc/resolve?token=${encodeURIComponent(nfc1.data.token)}`,
    { token: tokenA },
  );
  assert.equal(resolveSelf.status, 200);
  assert.equal(resolveSelf.data.status, "authorized");
  assert.equal(resolveSelf.data.owner?.id, regA.data.user.id);

  const resolveOther = await api<{
    status: string;
    signedInAsDifferentAccount?: boolean;
  }>(`/nfc/resolve?token=${encodeURIComponent(nfc1.data.token)}`, { token: tokenB });
  assert.equal(resolveOther.status, 200);
  assert.equal(resolveOther.data.status, "login_required");
  assert.equal(resolveOther.data.signedInAsDifferentAccount, true);

  // Regenerating link invalidates old token and increments version
  const regen = await api<{ token: string; path: string; version: number; revoked: boolean }>(
    "/nfc/regenerate",
    { method: "POST", token: tokenA },
  );
  assert.equal(regen.status, 200);
  assert.equal(regen.data.version, 2);
  assert.notEqual(regen.data.token, nfc1.data.token);

  const oldResolve = await api(`/nfc/resolve?token=${encodeURIComponent(nfc1.data.token)}`, {
    token: tokenA,
  });
  assert.equal(oldResolve.status, 404);

  const newResolve = await api<{ status: string }>(
    `/nfc/resolve?token=${encodeURIComponent(regen.data.token)}`,
    { token: tokenA },
  );
  assert.equal(newResolve.status, 200);
  assert.equal(newResolve.data.status, "authorized");

  // Revoking disables token
  const revoke = await api<{ revoked: boolean; token: string | null }>("/nfc/revoke", {
    method: "POST",
    token: tokenA,
  });
  assert.equal(revoke.status, 200);
  assert.equal(revoke.data.revoked, true);
  assert.equal(revoke.data.token, null);

  const revokedResolve = await api(`/nfc/resolve?token=${encodeURIComponent(regen.data.token)}`, {
    token: tokenA,
  });
  assert.equal(revokedResolve.status, 404);
});

function connectWs(token: string): Promise<{
  ws: WebSocket;
  waitForEvent: (name: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBaseUrl}?token=${encodeURIComponent(token)}`);
    const queue: { event: string; payload: Record<string, unknown> }[] = [];
    const waiters: {
      event: string;
      done: (payload: Record<string, unknown>) => void;
    }[] = [];

    ws.on("message", (raw) => {
      const parsed = JSON.parse(raw.toString()) as {
        event?: string;
        payload?: Record<string, unknown>;
      };
      if (!parsed.event) return;
      const idx = waiters.findIndex((w) => w.event === parsed.event);
      if (idx >= 0) {
        const [w] = waiters.splice(idx, 1);
        w?.done(parsed.payload ?? {});
      } else {
        queue.push({ event: parsed.event, payload: parsed.payload ?? {} });
      }
    });

    const waitForEvent = (name: string, timeoutMs = 4000) => {
      const existingIdx = queue.findIndex((item) => item.event === name);
      if (existingIdx >= 0) {
        const [item] = queue.splice(existingIdx, 1);
        return Promise.resolve(item!.payload);
      }
      return new Promise<Record<string, unknown>>((res, rej) => {
        const timer = setTimeout(() => {
          rej(new Error(`Timed out waiting for WS event '${name}'`));
        }, timeoutMs);
        waiters.push({
          event: name,
          done: (payload) => {
            clearTimeout(timer);
            res(payload);
          },
        });
      });
    };

    ws.on("open", () => resolve({ ws, waitForEvent }));
    ws.on("error", reject);
  });
}

test("Real-time user registration broadcast, live chat delivery, WebRTC call SDP/ICE relay, and firebase-session guard", async () => {
  const regA = await api<{ token: string; user: { id: string; fullName: string } }>(
    "/auth/register",
    {
      method: "POST",
      body: {
        fullName: "Live Caller",
        username: "live_caller",
        email: "caller@example.com",
        password: "Password123!",
      },
    },
  );
  assert.equal(regA.status, 201);

  const regB = await api<{ token: string; user: { id: string; fullName: string } }>(
    "/auth/register",
    {
      method: "POST",
      body: {
        fullName: "Live Callee",
        username: "live_callee",
        email: "callee@example.com",
        password: "Password123!",
      },
    },
  );
  assert.equal(regB.status, 201);

  const clientA = await connectWs(regA.data.token);
  const clientB = await connectWs(regB.data.token);
  await Promise.all([clientA.waitForEvent("connected"), clientB.waitForEvent("connected")]);

  try {
    // 1. Registering User C broadcasts live user:registered to all connected clients without leaking email
    const broadcastA = clientA.waitForEvent("user:registered");
    const broadcastB = clientB.waitForEvent("user:registered");
    const regC = await api<{ token: string; user: { id: string; fullName: string } }>(
      "/auth/register",
      {
        method: "POST",
        body: {
          fullName: "Newcomer Reader",
          username: "newcomer_reader",
          email: "newcomer@example.com",
          password: "Password123!",
        },
      },
    );
    assert.equal(regC.status, 201);
    const [evtA, evtB] = await Promise.all([broadcastA, broadcastB]);
    const userOnA = evtA["user"] as Record<string, unknown>;
    const userOnB = evtB["user"] as Record<string, unknown>;
    assert.equal(userOnA["id"], regC.data.user.id);
    assert.equal(userOnB["fullName"], "Newcomer Reader");
    assert.equal(userOnA["email"], undefined);

    // 2. Live chat message reaches recipient over WebSocket
    const dmIncoming = clientB.waitForEvent("message:new");
    const sendRes = await api<{ message: { id: string; text: string } }>("/messages", {
      method: "POST",
      token: regA.data.token,
      body: { peerId: regB.data.user.id, text: "Realtime WS message check" },
    });
    assert.equal(sendRes.status, 201);
    const dmPayload = await dmIncoming;
    assert.equal((dmPayload["message"] as { text?: string })?.text, "Realtime WS message check");

    // 3. Live WebRTC audio/video call signaling preserves callId, SDP offer/answer, and ICE candidates
    const callIncomingB = clientB.waitForEvent("call:incoming");
    const callRingingA = clientA.waitForEvent("call:ringing");
    clientA.ws.send(
      JSON.stringify({
        event: "call:initiate",
        payload: {
          callId: "call_test_1234",
          targetId: regB.data.user.id,
          callType: "video",
        },
      }),
    );
    const [incomingData, ringingData] = await Promise.all([callIncomingB, callRingingA]);
    assert.equal(incomingData["callId"], "call_test_1234");
    assert.equal(incomingData["callType"], "video");
    assert.equal((incomingData["from"] as { id?: string })?.id, regA.data.user.id);
    assert.equal(ringingData["recipientOnline"], true);

    const acceptedA = clientA.waitForEvent("call:signal");
    clientB.ws.send(
      JSON.stringify({
        event: "call:signal",
        payload: { targetId: regA.data.user.id, callId: "call_test_1234", action: "accepted" },
      }),
    );
    assert.equal((await acceptedA)["action"], "accepted");

    const offerB = clientB.waitForEvent("call:signal");
    clientA.ws.send(
      JSON.stringify({
        event: "call:signal",
        payload: {
          targetId: regB.data.user.id,
          callId: "call_test_1234",
          action: "offer",
          sdp: { type: "offer", sdp: "v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\n" },
        },
      }),
    );
    const receivedOffer = await offerB;
    assert.equal(receivedOffer["action"], "offer");
    assert.equal((receivedOffer["sdp"] as { type?: string })?.type, "offer");

    const answerA = clientA.waitForEvent("call:signal");
    clientB.ws.send(
      JSON.stringify({
        event: "call:signal",
        payload: {
          targetId: regA.data.user.id,
          callId: "call_test_1234",
          action: "answer",
          sdp: { type: "answer", sdp: "v=0\r\no=- 456 2 IN IP4 127.0.0.1\r\n" },
        },
      }),
    );
    const receivedAnswer = await answerA;
    assert.equal(receivedAnswer["action"], "answer");
    assert.equal((receivedAnswer["sdp"] as { type?: string })?.type, "answer");

    const iceA = clientA.waitForEvent("call:signal");
    clientB.ws.send(
      JSON.stringify({
        event: "call:signal",
        payload: {
          targetId: regA.data.user.id,
          callId: "call_test_1234",
          action: "ice-candidate",
          candidate: { candidate: "candidate:1 1 udp 2122260223 127.0.0.1 50000 typ host" },
        },
      }),
    );
    const receivedIce = await iceA;
    assert.equal(receivedIce["action"], "ice-candidate");
    assert.ok((receivedIce["candidate"] as { candidate?: string })?.candidate?.includes("host"));

    const endedB = clientB.waitForEvent("call:signal");
    clientA.ws.send(
      JSON.stringify({
        event: "call:signal",
        payload: { targetId: regB.data.user.id, callId: "call_test_1234", action: "ended" },
      }),
    );
    assert.equal((await endedB)["action"], "ended");

    // 4. firebase-session endpoint validates ID token presence & signature
    const missingFb = await api("/auth/firebase-session", { method: "POST", body: {} });
    assert.equal(missingFb.status, 400);
    const badFb = await api("/auth/firebase-session", {
      method: "POST",
      body: { idToken: "not-a-valid-jwt" },
    });
    assert.equal(badFb.status, 401);

    // 5. Account deletion removes user from directory & broadcasts user:deleted live
    const deletedEventPromise = clientA.waitForEvent("user:deleted");
    const delC = await api<{ ok: boolean; deletedUserId: string }>("/auth/account", {
      method: "DELETE",
      token: regC.data.token,
    });
    assert.equal(delC.status, 200);
    assert.equal(delC.data.ok, true);
    assert.equal(delC.data.deletedUserId, regC.data.user.id);
    const deletedEv = await deletedEventPromise;
    assert.equal(deletedEv["userId"], regC.data.user.id);

    const listAfterDel = await api<{ users: Array<{ id: string }> }>("/users", {
      token: regA.data.token,
    });
    assert.equal(listAfterDel.status, 200);
    assert.equal(
      listAfterDel.data.users.some((u) => u.id === regC.data.user.id),
      false,
    );
  } finally {
    clientA.ws.close();
    clientB.ws.close();
  }
});
