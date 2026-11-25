import crypto from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import {
  db,
  isBlockedBetween,
  normalizeEmail,
  sha256,
  threadKeyFor,
  toPublicUser,
  verifyCookieToken,
  type DbUser,
} from "./db";
import { getFirebaseAdminAuth } from "./firebase-admin";

type ClientSocket = WebSocket & {
  userId?: string;
  isAlive?: boolean;
  activePeerId?: string | null;
};

const userSockets = new Map<string, Set<ClientSocket>>();
const activeCallPeers = new Map<string, { callId: string; peerId: string }>();
const pendingCallOffers = new Map<
  string,
  {
    callId: string;
    callType: "audio" | "video";
    caller: DbUser;
    targetId: string;
    createdAt: number;
  }
>();

export function getUserAliases(userId: string): string[] {
  if (!userId) return [];
  const list = [userId];
  if (userId.startsWith("fb_")) {
    const raw = userId.slice(3);
    if (raw && !list.includes(raw)) list.push(raw);
  } else {
    const fbKey = `fb_${userId}`;
    if (!list.includes(fbKey)) list.push(fbKey);
  }
  return list;
}

export function isUserConnected(userId: string): boolean {
  for (const alias of getUserAliases(userId)) {
    const set = userSockets.get(alias);
    if (set) {
      for (const ws of set) {
        if (ws.readyState === WebSocket.OPEN) return true;
      }
    }
  }
  return false;
}

export function isUserViewingThread(userId: string, peerId: string): boolean {
  const peerAliases = new Set(getUserAliases(peerId));
  for (const alias of getUserAliases(userId)) {
    const set = userSockets.get(alias);
    if (!set) continue;
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN && ws.activePeerId && peerAliases.has(ws.activePeerId)) {
        return true;
      }
    }
  }
  return false;
}

export function sendToUser(userId: string, event: string, payload: unknown) {
  const serialized = JSON.stringify({ event, payload });
  const sentSockets = new Set<ClientSocket>();
  for (const alias of getUserAliases(userId)) {
    const set = userSockets.get(alias);
    if (!set) continue;
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN && !sentSockets.has(ws)) {
        sentSockets.add(ws);
        ws.send(serialized);
      }
    }
  }
}

export function broadcastEvent(event: string, payload: unknown, excludeUserId?: string) {
  const excludedAliases = excludeUserId ? new Set(getUserAliases(excludeUserId)) : null;
  const serialized = JSON.stringify({ event, payload });
  const sentSockets = new Set<ClientSocket>();
  for (const [connectedUserId, set] of userSockets.entries()) {
    if (excludedAliases?.has(connectedUserId)) continue;
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN && !sentSockets.has(ws)) {
        sentSockets.add(ws);
        ws.send(serialized);
      }
    }
  }
}

function parseCookieValue(req: IncomingMessage, name: string): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) {
      const val = decodeURIComponent(rest.join("=")).trim();
      if (val) return val;
    }
  }
  return null;
}

function parseAuthTokensFromRequest(req: IncomingMessage): {
  sessionToken: string | null;
  firebaseToken: string | null;
  fbCookie: string | null;
} {
  const url = new URL(req.url ?? "/", "http://localhost");
  const queryToken = url.searchParams.get("token")?.trim() || null;
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  const sessionToken =
    (queryToken && queryToken.startsWith("rc_sess_") ? queryToken : null) ||
    (bearerToken && bearerToken.startsWith("rc_sess_") ? bearerToken : null) ||
    parseCookieValue(req, "rc_session");

  const firebaseToken =
    (bearerToken && !bearerToken.startsWith("rc_sess_") ? bearerToken : null) ||
    (queryToken && !queryToken.startsWith("rc_sess_") ? queryToken : null);

  const fbCookie = parseCookieValue(req, "rc_fb_session");
  return { sessionToken, firebaseToken, fbCookie };
}

async function resolveUserFromRequest(req: IncomingMessage): Promise<DbUser | null> {
  const { sessionToken, firebaseToken, fbCookie } = parseAuthTokensFromRequest(req);
  const now = new Date().toISOString();

  if (sessionToken) {
    const row = (await db
      .prepare(
        `SELECT u.* FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?
         LIMIT 1`,
      )
      .get(sha256(sessionToken), now)) as DbUser | undefined;
    if (row) return row;
  }

  if (fbCookie) {
    const verified = verifyCookieToken(fbCookie);
    if (verified?.uid) {
      const fbRow = (await db
        .prepare("SELECT * FROM users WHERE id = ? OR id = ? LIMIT 1")
        .get(`fb_${verified.uid}`, verified.uid)) as DbUser | undefined;
      if (fbRow) return fbRow;
    }
  }

  if (firebaseToken) {
    try {
      const decoded = await getFirebaseAdminAuth().verifyIdToken(firebaseToken);
      if (decoded?.uid) {
        const fbRow = (await db
          .prepare("SELECT * FROM users WHERE id = ? OR id = ? LIMIT 1")
          .get(`fb_${decoded.uid}`, decoded.uid)) as DbUser | undefined;
        if (fbRow) return fbRow;

        const cleanEmail = decoded.email ? normalizeEmail(decoded.email) : null;
        if (decoded.email_verified && cleanEmail) {
          const emailRow = (await db
            .prepare(
              "SELECT * FROM users WHERE email_verified = 1 AND LOWER(email) = LOWER(?) LIMIT 1",
            )
            .get(cleanEmail)) as DbUser | undefined;
          if (emailRow) return emailRow;
        }
      }
    } catch {
      /* invalid firebase token */
    }
  }

  return null;
}

export async function broadcastPresence(userId: string, online: boolean) {
  const now = new Date().toISOString();
  await db.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").run(now, userId);

  // Notify connected non-blocked users so active chats and Discover Users stay live
  for (const connectedUserId of userSockets.keys()) {
    if (connectedUserId !== userId && !(await isBlockedBetween(userId, connectedUserId))) {
      sendToUser(connectedUserId, "presence:update", { userId, online, lastActiveAt: now });
    }
  }
}

async function markPendingDeliveredForUser(userId: string) {
  const now = new Date().toISOString();
  const pendingSenders = (await db
    .prepare(
      "SELECT DISTINCT sender_id FROM messages WHERE recipient_id = ? AND delivered_at IS NULL",
    )
    .all(userId)) as { sender_id: string }[];

  if (pendingSenders.length === 0) return;

  await db
    .prepare("UPDATE messages SET delivered_at = ? WHERE recipient_id = ? AND delivered_at IS NULL")
    .run(now, userId);

  for (const { sender_id } of pendingSenders) {
    if (!(await isBlockedBetween(userId, sender_id))) {
      sendToUser(sender_id, "messages:delivered", {
        byUserId: userId,
        peerId: userId,
        deliveredAt: now,
      });
    }
  }
}

export function attachWebSocketServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", async (req, socket, head) => {
    const reqUrl = req.url ?? "";
    const pathname = reqUrl.split("?")[0];
    if (pathname !== "/ws") {
      return;
    }

    const user = await resolveUserFromRequest(req);
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const client = ws as ClientSocket;
      client.userId = user.id;
      client.isAlive = true;
      wss.emit("connection", client, req);
    });
  });

  wss.on("connection", (ws: ClientSocket) => {
    const userId = ws.userId;
    if (!userId) {
      ws.close(1008, "Unauthorized");
      return;
    }

    const aliases = getUserAliases(userId);
    for (const alias of aliases) {
      let set = userSockets.get(alias);
      if (!set) {
        set = new Set();
        userSockets.set(alias, set);
      }
      set.add(ws);
    }

    broadcastPresence(userId, true);
    markPendingDeliveredForUser(userId);

    ws.send(JSON.stringify({ event: "connected", payload: { userId } }));

    // Check if there is an active pending incoming call for this user (<35s old)
    for (const alias of aliases) {
      const pending = pendingCallOffers.get(alias);
      if (pending && Date.now() - pending.createdAt < 35_000) {
        pendingCallOffers.delete(alias);
        void toPublicUser(pending.caller, true, alias).then((fromPub) => {
          sendToUser(alias, "call:incoming", {
            callId: pending.callId,
            callType: pending.callType,
            from: fromPub,
          });
          sendToUser(pending.caller.id, "call:ringing", {
            callId: pending.callId,
            targetId: alias,
            callType: pending.callType,
            recipientOnline: true,
          });
        });
      }
    }

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw.toString()) as {
          event?: string;
          payload?: Record<string, unknown>;
        };
        const event = data.event;
        const payload = data.payload ?? {};

        if (event === "ping") {
          await db
            .prepare("UPDATE users SET last_active_at = ? WHERE id = ?")
            .run(new Date().toISOString(), userId);
          ws.send(JSON.stringify({ event: "pong", payload: { ts: Date.now() } }));
          return;
        }

        if (event === "thread:active") {
          const peerId = typeof payload["peerId"] === "string" ? payload["peerId"].trim() : "";
          ws.activePeerId = peerId || null;
          return;
        }

        if (event === "typing") {
          const peerId = typeof payload["peerId"] === "string" ? payload["peerId"] : "";
          const active = Boolean(payload["active"]);
          if (!peerId || (await isBlockedBetween(userId, peerId))) return;
          sendToUser(peerId, "typing", { fromUserId: userId, active });
          return;
        }

        if (event === "messages:seen") {
          const peerId = typeof payload["peerId"] === "string" ? payload["peerId"] : "";
          if (!peerId || (await isBlockedBetween(userId, peerId))) return;
          const key = threadKeyFor(userId, peerId);
          const seenAt = new Date().toISOString();
          const result = await db
            .prepare(
              "UPDATE messages SET seen_at = ? WHERE thread_key = ? AND sender_id = ? AND recipient_id = ? AND seen_at IS NULL",
            )
            .run(seenAt, key, peerId, userId);

          if (result.changes > 0) {
            sendToUser(peerId, "messages:seen", { byUserId: userId, peerId: userId, seenAt });
            sendToUser(userId, "messages:seen", { byUserId: userId, peerId, seenAt });
          }
          return;
        }

        if (event === "call:initiate") {
          const rawTarget =
            typeof payload["targetId"] === "string" ? payload["targetId"].trim() : "";
          const callType = payload["callType"] === "video" ? "video" : "audio";
          if (!rawTarget) return;

          const targetAliases = getUserAliases(rawTarget);
          const callerAliases = getUserAliases(userId);
          if (targetAliases.some((t) => callerAliases.includes(t))) return;

          const callerPlaceholders = callerAliases.map(() => "?").join(",");
          const targetPlaceholders = targetAliases.map(() => "?").join(",");

          const caller = (await db
            .prepare(`SELECT * FROM users WHERE id IN (${callerPlaceholders}) LIMIT 1`)
            .get(...callerAliases)) as DbUser | undefined;
          const target = (await db
            .prepare(`SELECT * FROM users WHERE id IN (${targetPlaceholders}) LIMIT 1`)
            .get(...targetAliases)) as DbUser | undefined;

          if (!caller || !target) {
            ws.send(
              JSON.stringify({
                event: "call:error",
                payload: { error: "Recipient account not found." },
              }),
            );
            return;
          }

          if (await isBlockedBetween(caller.id, target.id)) {
            ws.send(
              JSON.stringify({
                event: "call:error",
                payload: { error: "Cannot initiate call. This user is blocked." },
              }),
            );
            return;
          }

          const rawCallId = typeof payload["callId"] === "string" ? payload["callId"].trim() : "";
          const callId =
            rawCallId && /^[a-zA-Z0-9_-]{4,64}$/.test(rawCallId)
              ? rawCallId
              : `call_${crypto.randomUUID()}`;

          const canonicalCallerId = caller.id;
          const canonicalTargetId = target.id;
          const recipientOnline = isUserConnected(canonicalTargetId);

          let existingTargetCall: { callId: string; peerId: string } | undefined;
          for (const tAlias of getUserAliases(canonicalTargetId)) {
            const hit = activeCallPeers.get(tAlias);
            if (hit) {
              existingTargetCall = hit;
              break;
            }
          }

          if (existingTargetCall && existingTargetCall.callId !== callId) {
            sendToUser(canonicalCallerId, "call:signal", {
              fromUserId: canonicalTargetId,
              callId,
              action: "busy",
              sdp: null,
              candidate: null,
            });
            return;
          }

          for (const cAlias of getUserAliases(canonicalCallerId)) {
            activeCallPeers.set(cAlias, { callId, peerId: canonicalTargetId });
          }
          for (const tAlias of getUserAliases(canonicalTargetId)) {
            activeCallPeers.set(tAlias, { callId, peerId: canonicalCallerId });
          }

          const callPayload = {
            callId,
            callType,
            from: await toPublicUser(caller, true, canonicalTargetId),
          };

          if (recipientOnline) {
            sendToUser(canonicalTargetId, "call:incoming", callPayload);
          } else {
            pendingCallOffers.set(canonicalTargetId, {
              callId,
              callType,
              caller,
              targetId: canonicalTargetId,
              createdAt: Date.now(),
            });
          }

          sendToUser(canonicalCallerId, "call:ringing", {
            callId,
            targetId: canonicalTargetId,
            callType,
            recipientOnline,
          });
          return;
        }

        if (event === "call:signal") {
          const targetId =
            typeof payload["targetId"] === "string" ? payload["targetId"].trim() : "";
          const callId = typeof payload["callId"] === "string" ? payload["callId"].trim() : "";
          const action = typeof payload["action"] === "string" ? payload["action"].trim() : "";
          if (!targetId || !action || (await isBlockedBetween(userId, targetId))) return;

          const userAliases = getUserAliases(userId);
          const targetAliases = getUserAliases(targetId);

          if (action === "accepted") {
            for (const uAlias of userAliases) {
              activeCallPeers.set(uAlias, { callId, peerId: targetId });
              pendingCallOffers.delete(uAlias);
            }
            for (const tAlias of targetAliases) {
              activeCallPeers.set(tAlias, { callId, peerId: userId });
              pendingCallOffers.delete(tAlias);
            }
          } else if (action === "declined" || action === "ended" || action === "busy") {
            for (const uAlias of userAliases) {
              const mine = activeCallPeers.get(uAlias);
              if (!mine || mine.callId === callId) activeCallPeers.delete(uAlias);
              pendingCallOffers.delete(uAlias);
            }
            for (const tAlias of targetAliases) {
              const theirs = activeCallPeers.get(tAlias);
              if (theirs && theirs.callId === callId) activeCallPeers.delete(tAlias);
              pendingCallOffers.delete(tAlias);
            }
          }

          sendToUser(targetId, "call:signal", {
            fromUserId: userId,
            callId,
            action,
            sdp: payload["sdp"] ?? null,
            candidate: payload["candidate"] ?? null,
            cameraEnabled:
              typeof payload["cameraEnabled"] === "boolean" ? payload["cameraEnabled"] : undefined,
            micMuted: typeof payload["micMuted"] === "boolean" ? payload["micMuted"] : undefined,
            reason: typeof payload["reason"] === "string" ? payload["reason"] : undefined,
          });
        }
      } catch {
        /* ignore malformed ws frame */
      }
    });

    ws.on("close", () => {
      const aliases = getUserAliases(userId);
      let wasLast = false;
      for (const alias of aliases) {
        const current = userSockets.get(alias);
        if (current) {
          current.delete(ws);
          if (current.size === 0) {
            userSockets.delete(alias);
            wasLast = true;
          }
        }
      }

      if (wasLast && !isUserConnected(userId)) {
        for (const alias of aliases) {
          const activeCall = activeCallPeers.get(alias);
          if (activeCall) {
            activeCallPeers.delete(alias);
            const peerAliases = getUserAliases(activeCall.peerId);
            for (const pAlias of peerAliases) {
              const peerActive = activeCallPeers.get(pAlias);
              if (peerActive && peerActive.callId === activeCall.callId) {
                activeCallPeers.delete(pAlias);
              }
            }
            sendToUser(activeCall.peerId, "call:signal", {
              fromUserId: userId,
              callId: activeCall.callId,
              action: "ended",
              sdp: null,
              candidate: null,
            });
          }
          pendingCallOffers.delete(alias);
        }
        broadcastPresence(userId, false);
      }
    });
  });

  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      const client = ws as ClientSocket;
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 30_000);
  interval.unref();

  httpServer.once("close", () => {
    wss.close();
  });
  wss.on("close", () => clearInterval(interval));
  return wss;
}
