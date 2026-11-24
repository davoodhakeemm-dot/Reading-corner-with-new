import crypto from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import { db, isBlockedBetween, sha256, threadKeyFor, toPublicUser, type DbUser } from "./db";

type ClientSocket = WebSocket & { userId?: string; isAlive?: boolean };

const userSockets = new Map<string, Set<ClientSocket>>();
const activeCallPeers = new Map<string, { callId: string; peerId: string }>();

export function isUserConnected(userId: string): boolean {
  const set = userSockets.get(userId);
  return Boolean(set && set.size > 0);
}

export function sendToUser(userId: string, event: string, payload: unknown) {
  const set = userSockets.get(userId);
  if (!set) return;
  const serialized = JSON.stringify({ event, payload });
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
    }
  }
}

export function broadcastEvent(event: string, payload: unknown, excludeUserId?: string) {
  const serialized = JSON.stringify({ event, payload });
  for (const [connectedUserId, set] of userSockets.entries()) {
    if (excludeUserId && connectedUserId === excludeUserId) continue;
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(serialized);
      }
    }
  }
}

function parseSessionTokenFromRequest(req: IncomingMessage): string | null {
  const url = new URL(req.url ?? "/", "http://localhost");
  const queryToken = url.searchParams.get("token")?.trim();
  if (queryToken) return queryToken;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const [k, ...rest] = part.trim().split("=");
      if (k === "rc_session") {
        return decodeURIComponent(rest.join("="));
      }
    }
  }
  return null;
}

function resolveUserFromToken(token: string | null): DbUser | null {
  if (!token) return null;
  const now = new Date().toISOString();
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?
       LIMIT 1`,
    )
    .get(sha256(token), now) as DbUser | undefined;
  return row ?? null;
}

export function broadcastPresence(userId: string, online: boolean) {
  const now = new Date().toISOString();
  db.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").run(now, userId);

  // Notify connected non-blocked users so active chats and Discover Users stay live
  for (const connectedUserId of userSockets.keys()) {
    if (connectedUserId !== userId && !isBlockedBetween(userId, connectedUserId)) {
      sendToUser(connectedUserId, "presence:update", { userId, online, lastActiveAt: now });
    }
  }
}

function markPendingDeliveredForUser(userId: string) {
  const now = new Date().toISOString();
  const pendingSenders = db
    .prepare(
      "SELECT DISTINCT sender_id FROM messages WHERE recipient_id = ? AND delivered_at IS NULL",
    )
    .all(userId) as { sender_id: string }[];

  if (pendingSenders.length === 0) return;

  db.prepare(
    "UPDATE messages SET delivered_at = ? WHERE recipient_id = ? AND delivered_at IS NULL",
  ).run(now, userId);

  for (const { sender_id } of pendingSenders) {
    if (!isBlockedBetween(userId, sender_id)) {
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

  httpServer.on("upgrade", (req, socket, head) => {
    const reqUrl = req.url ?? "";
    const pathname = reqUrl.split("?")[0];
    if (pathname !== "/ws") {
      return;
    }

    const token = parseSessionTokenFromRequest(req);
    const user = resolveUserFromToken(token);
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

    let set = userSockets.get(userId);
    if (!set) {
      set = new Set();
      userSockets.set(userId, set);
    }
    set.add(ws);
    broadcastPresence(userId, true);
    markPendingDeliveredForUser(userId);

    ws.send(JSON.stringify({ event: "connected", payload: { userId } }));

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString()) as {
          event?: string;
          payload?: Record<string, unknown>;
        };
        const event = data.event;
        const payload = data.payload ?? {};

        if (event === "ping") {
          db.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").run(
            new Date().toISOString(),
            userId,
          );
          ws.send(JSON.stringify({ event: "pong", payload: { ts: Date.now() } }));
          return;
        }

        if (event === "typing") {
          const peerId = typeof payload["peerId"] === "string" ? payload["peerId"] : "";
          const active = Boolean(payload["active"]);
          if (!peerId || isBlockedBetween(userId, peerId)) return;
          sendToUser(peerId, "typing", { fromUserId: userId, active });
          return;
        }

        if (event === "messages:seen") {
          const peerId = typeof payload["peerId"] === "string" ? payload["peerId"] : "";
          if (!peerId || isBlockedBetween(userId, peerId)) return;
          const key = threadKeyFor(userId, peerId);
          const seenAt = new Date().toISOString();
          const result = db
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
          const targetId = typeof payload["targetId"] === "string" ? payload["targetId"] : "";
          const callType = payload["callType"] === "video" ? "video" : "audio";
          if (!targetId || targetId === userId) return;
          if (isBlockedBetween(userId, targetId)) {
            ws.send(
              JSON.stringify({
                event: "call:error",
                payload: { error: "Cannot initiate call. This user is blocked." },
              }),
            );
            return;
          }
          const caller = db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(userId) as
            DbUser | undefined;
          const target = db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").get(targetId) as
            { id: string } | undefined;
          if (!caller || !target) {
            ws.send(
              JSON.stringify({
                event: "call:error",
                payload: { error: "Recipient account not found." },
              }),
            );
            return;
          }
          const rawCallId = typeof payload["callId"] === "string" ? payload["callId"].trim() : "";
          const callId =
            rawCallId && /^[a-zA-Z0-9_-]{4,64}$/.test(rawCallId)
              ? rawCallId
              : `call_${crypto.randomUUID()}`;
          const recipientOnline = isUserConnected(targetId);

          const existingTargetCall = activeCallPeers.get(targetId);
          if (existingTargetCall && existingTargetCall.callId !== callId) {
            sendToUser(userId, "call:signal", {
              fromUserId: targetId,
              callId,
              action: "busy",
              sdp: null,
              candidate: null,
            });
            return;
          }

          activeCallPeers.set(userId, { callId, peerId: targetId });
          if (recipientOnline) {
            sendToUser(targetId, "call:incoming", {
              callId,
              callType,
              from: toPublicUser(caller, true, targetId),
            });
          }
          sendToUser(userId, "call:ringing", {
            callId,
            targetId,
            callType,
            recipientOnline,
          });
          return;
        }

        if (event === "call:signal") {
          const targetId = typeof payload["targetId"] === "string" ? payload["targetId"] : "";
          const callId = typeof payload["callId"] === "string" ? payload["callId"] : "";
          const action = typeof payload["action"] === "string" ? payload["action"] : "";
          if (!targetId || !action || isBlockedBetween(userId, targetId)) return;

          if (action === "accepted") {
            activeCallPeers.set(userId, { callId, peerId: targetId });
            activeCallPeers.set(targetId, { callId, peerId: userId });
          } else if (action === "declined" || action === "ended" || action === "busy") {
            const mine = activeCallPeers.get(userId);
            if (!mine || mine.callId === callId) activeCallPeers.delete(userId);
            const theirs = activeCallPeers.get(targetId);
            if (theirs && theirs.callId === callId) activeCallPeers.delete(targetId);
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
      const current = userSockets.get(userId);
      if (current) {
        current.delete(ws);
        if (current.size === 0) {
          userSockets.delete(userId);
          const activeCall = activeCallPeers.get(userId);
          if (activeCall) {
            activeCallPeers.delete(userId);
            const peerActive = activeCallPeers.get(activeCall.peerId);
            if (peerActive && peerActive.callId === activeCall.callId) {
              activeCallPeers.delete(activeCall.peerId);
            }
            sendToUser(activeCall.peerId, "call:signal", {
              fromUserId: userId,
              callId: activeCall.callId,
              action: "ended",
              sdp: null,
              candidate: null,
            });
          }
          broadcastPresence(userId, false);
        }
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
