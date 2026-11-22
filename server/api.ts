import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import multer from "multer";

import {
  createFirebaseNfcToken,
  createNfcTokenForUser,
  db,
  decryptToken,
  didUserBlock,
  getFollowStats,
  hashPassword,
  isBlockedBetween,
  mediaDir,
  normalizeEmail,
  normalizeHandle,
  normalizePhoneE164,
  sha256,
  signCookieToken,
  threadKeyFor,
  toPublicUser,
  verifyCookieToken,
  verifyPassword,
  type DbUser,
  type SecretTheme,
} from "./db";
import { broadcastEvent, isUserConnected, sendToUser } from "./ws";

type AuthedRequest = Request & { authUser?: DbUser; authToken?: string; firebaseUid?: string };

let cachedProjectId: string | null = null;
function getFirebaseAdminAuth() {
  if (!cachedProjectId) {
    const cfgPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as { projectId?: string };
    cachedProjectId = cfg.projectId || process.env["GOOGLE_CLOUD_PROJECT"] || "";
  }
  const app = getApps().length
    ? getApp()
    : initializeApp(cachedProjectId ? { projectId: cachedProjectId } : undefined);
  return getAuth(app);
}

function extractCookieValue(req: Request, name: string): string | null {
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

async function resolveFirebaseUid(req: Request): Promise<string | null> {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token && !token.startsWith("rc_sess_")) {
      try {
        const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
        if (decoded?.uid) return decoded.uid;
      } catch {
        /* invalid Firebase ID token */
      }
    }
  }
  const fbCookie = extractCookieValue(req, "rc_fb_session");
  if (fbCookie) {
    const verified = verifyCookieToken(fbCookie);
    if (verified?.uid) return verified.uid;
  }
  return null;
}

type DbMessageRow = {
  id: string;
  thread_key: string;
  sender_id: string;
  recipient_id: string;
  text: string;
  media_id: string | null;
  media_kind: string | null;
  media_name: string | null;
  reply_to_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  delivered_at: string | null;
  created_at: string;
  seen_at: string | null;
};

const SESSION_DAYS = 30;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // 25MB for photos & short videos

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, mediaDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").slice(0, 12);
      cb(null, `${Date.now()}_${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_MEDIA_BYTES },
});

function getTwilioConfig() {
  const sid = process.env["TWILIO_ACCOUNT_SID"]?.trim() ?? "";
  const token = process.env["TWILIO_AUTH_TOKEN"]?.trim() ?? "";
  const serviceSid = process.env["TWILIO_VERIFY_SERVICE_SID"]?.trim() ?? "";
  return {
    configured: Boolean(sid && token && serviceSid),
    sid,
    token,
    serviceSid,
  };
}

async function sendTwilioOtp(phoneE164: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = getTwilioConfig();
  if (!cfg.configured) {
    return {
      ok: false,
      error:
        "SMS OTP service is not configured yet. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID to enable real phone OTP verification.",
    };
  }
  const body = new URLSearchParams({ To: phoneE164, Channel: "sms" });
  const auth = Buffer.from(`${cfg.sid}:${cfg.token}`).toString("base64");
  const resp = await fetch(
    `https://verify.twilio.com/v2/Services/${encodeURIComponent(cfg.serviceSid)}/Verifications`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
  );
  if (!resp.ok) {
    const text = await resp.text();
    return { ok: false, error: `SMS provider rejected OTP request (${resp.status}): ${text}` };
  }
  return { ok: true };
}

async function verifyTwilioOtp(
  phoneE164: string,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = getTwilioConfig();
  if (!cfg.configured) {
    return {
      ok: false,
      error:
        "SMS OTP service is not configured yet. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID to enable real phone OTP verification.",
    };
  }
  const body = new URLSearchParams({ To: phoneE164, Code: code.trim() });
  const auth = Buffer.from(`${cfg.sid}:${cfg.token}`).toString("base64");
  const resp = await fetch(
    `https://verify.twilio.com/v2/Services/${encodeURIComponent(cfg.serviceSid)}/VerificationCheck`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
  );
  if (!resp.ok) {
    return { ok: false, error: "Invalid or expired OTP code." };
  }
  const data = (await resp.json()) as { status?: string };
  if (data.status !== "approved") {
    return { ok: false, error: "OTP verification did not pass. Please check the code." };
  }
  return { ok: true };
}

function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const val = auth.slice(7).trim();
    if (val) return val;
  }
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const [k, ...rest] = part.trim().split("=");
      if (k === "rc_session") {
        const val = decodeURIComponent(rest.join("=")).trim();
        if (val) return val;
      }
    }
  }
  return null;
}

function lookupSessionUser(req: Request): { user: DbUser; token: string } | null {
  const token = extractToken(req);
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
  if (!row) return null;
  return { user: row, token };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const resolved = lookupSessionUser(req);
  if (!resolved) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  req.authUser = resolved.user;
  req.authToken = resolved.token;
  db.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    resolved.user.id,
  );
  next();
}

function issueSession(userId: string, req: Request, res: Response): string {
  const token = `rc_sess_${crypto.randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    `sess_${crypto.randomUUID()}`,
    userId,
    sha256(token),
    expires.toISOString(),
    now.toISOString(),
    String(req.headers["user-agent"] ?? "").slice(0, 200),
  );

  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.clearCookie("rc_fb_session", { path: "/" });
  res.cookie("rc_session", token, {
    httpOnly: true,
    sameSite: isHttps ? "none" : "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    secure: isHttps,
  });
  return token;
}

function makeUniqueHandle(fullName: string): string {
  const slug = fullName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 14);
  for (let i = 0; i < 6; i += 1) {
    const suffix = crypto.randomBytes(2).toString("hex");
    const candidate = `@${slug || "reader"}.${suffix}`;
    const exists = db
      .prepare("SELECT 1 FROM users WHERE LOWER(display_handle) = LOWER(?) LIMIT 1")
      .get(candidate);
    if (!exists) return candidate;
  }
  return `@${slug || "reader"}.${crypto.randomUUID().slice(0, 6)}`;
}

function maskPhone(e164: string | null): string | undefined {
  if (!e164) return undefined;
  if (e164.length <= 6) return "***";
  return `${e164.slice(0, 4)}••••${e164.slice(-3)}`;
}

function toSelfUser(user: DbUser) {
  return {
    ...toPublicUser(user, true, user.id),
    email: user.email,
    phoneMasked: maskPhone(user.phone_e164),
    phoneE164: user.phone_e164,
  };
}

function getReactionsForMessage(messageId: string, viewerId?: string) {
  const rows = db
    .prepare(
      "SELECT user_id, emoji FROM message_reactions WHERE message_id = ? ORDER BY created_at ASC",
    )
    .all(messageId) as { user_id: string; emoji: string }[];

  const grouped = new Map<
    string,
    { emoji: string; count: number; reactedByMe: boolean; userIds: string[] }
  >();
  for (const r of rows) {
    const entry = grouped.get(r.emoji) ?? {
      emoji: r.emoji,
      count: 0,
      reactedByMe: false,
      userIds: [],
    };
    entry.count += 1;
    entry.userIds.push(r.user_id);
    if (viewerId && r.user_id === viewerId) {
      entry.reactedByMe = true;
    }
    grouped.set(r.emoji, entry);
  }
  return Array.from(grouped.values());
}

function serializeMessage(m: DbMessageRow, viewerId?: string) {
  const isDeleted = Boolean(m.deleted_at);
  let replyTo: {
    id: string;
    senderId: string;
    senderName: string;
    text: string;
    mediaKind: "image" | "video" | "audio" | null;
    deleted: boolean;
  } | null = null;

  if (m.reply_to_id) {
    const parent = db
      .prepare(
        `SELECT m.id, m.sender_id, m.text, m.media_kind, m.deleted_at, u.full_name
         FROM messages m
         LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.id = ? LIMIT 1`,
      )
      .get(m.reply_to_id) as
      | {
          id: string;
          sender_id: string;
          text: string;
          media_kind: string | null;
          deleted_at: string | null;
          full_name: string | null;
        }
      | undefined;
    if (parent) {
      replyTo = {
        id: parent.id,
        senderId: parent.sender_id,
        senderName: parent.full_name || "Reader",
        text: parent.deleted_at ? "Message deleted" : parent.text,
        mediaKind: parent.deleted_at
          ? null
          : (parent.media_kind as "image" | "video" | "audio" | null),
        deleted: Boolean(parent.deleted_at),
      };
    }
  }

  return {
    id: m.id,
    threadKey: m.thread_key,
    from: m.sender_id,
    to: m.recipient_id,
    text: isDeleted ? "Message deleted" : m.text,
    mediaUrl: !isDeleted && m.media_id ? `/api/media/${m.media_id}` : null,
    mediaId: isDeleted ? null : m.media_id,
    mediaKind: isDeleted ? null : (m.media_kind as "image" | "video" | "audio" | null),
    mediaName: isDeleted ? null : m.media_name,
    replyToId: m.reply_to_id,
    replyTo,
    reactions: isDeleted ? [] : getReactionsForMessage(m.id, viewerId),
    editedAt: m.edited_at,
    deletedAt: m.deleted_at,
    deliveredAt: m.delivered_at,
    createdAt: m.created_at,
    seenAt: m.seen_at,
  };
}

function findUserByIdentifier(rawIdentifier: string, countryCode = "+91"): DbUser | undefined {
  const trimmed = rawIdentifier.trim();
  if (!trimmed) return undefined;

  // 1. Exact case-insensitive email match
  const asEmail = normalizeEmail(trimmed);
  if (asEmail) {
    const byEmail = db
      .prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1")
      .get(asEmail) as DbUser | undefined;
    if (byEmail) return byEmail;
  }

  // 2. Display handle match (with or without leading @)
  const cleanHandle = trimmed.replace(/^@+/, "").toLowerCase();
  if (cleanHandle && !cleanHandle.includes("@")) {
    const byHandle = db
      .prepare("SELECT * FROM users WHERE LOWER(display_handle) = ? LIMIT 1")
      .get(`@${cleanHandle}`) as DbUser | undefined;
    if (byHandle) return byHandle;
  }

  // 3. Phone E.164 match
  const asPhone = normalizePhoneE164(trimmed, countryCode);
  if (asPhone) {
    const byPhone = db.prepare("SELECT * FROM users WHERE phone_e164 = ? LIMIT 1").get(asPhone) as
      DbUser | undefined;
    if (byPhone) return byPhone;
  }

  return undefined;
}

export function createApiRouter() {
  const router = express.Router();
  router.use(express.json({ limit: "4mb" }));

  router.get("/health", (_req, res) => {
    res.json({ ok: true, otpConfigured: getTwilioConfig().configured });
  });

  router.get("/auth/otp-status", (_req, res) => {
    const cfg = getTwilioConfig();
    res.json({
      configured: cfg.configured,
      provider: cfg.configured ? "twilio_verify" : null,
    });
  });

  // Register using email (and/or phone), username, password, and profile details
  router.post("/auth/register", async (req, res) => {
    try {
      const {
        email,
        username,
        displayHandle,
        phone,
        countryCode,
        password,
        fullName,
        bio = "",
        avatarDataUrl,
      } = req.body as {
        email?: string;
        username?: string;
        displayHandle?: string;
        phone?: string;
        countryCode?: string;
        password?: string;
        fullName?: string;
        bio?: string;
        avatarDataUrl?: string;
      };

      const cleanEmail = email && email.trim() ? normalizeEmail(email) : null;
      if (email && email.trim() && !cleanEmail) {
        res.status(400).json({ error: "Enter a valid email address." });
        return;
      }

      const rawPhone = String(phone ?? "").trim();
      const phoneE164 = rawPhone ? normalizePhoneE164(rawPhone, countryCode ?? "+91") : null;
      if (rawPhone && !phoneE164) {
        res.status(400).json({ error: "Enter a valid phone number with country code." });
        return;
      }

      if (!cleanEmail && !phoneE164) {
        res
          .status(400)
          .json({ error: "Please enter your email address (or a valid phone number)." });
        return;
      }

      const name = String(fullName ?? "").trim();
      if (name.length < 2 || name.length > 60) {
        res.status(400).json({ error: "Full name is required (2–60 characters)." });
        return;
      }

      const pwd = String(password ?? "");
      if (pwd.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters." });
        return;
      }

      if (cleanEmail) {
        const existingEmail = db
          .prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1")
          .get(cleanEmail);
        if (existingEmail) {
          res.status(409).json({
            error: "An account is already registered with this email. Please sign in instead.",
          });
          return;
        }
      }

      if (phoneE164) {
        const existingPhone = db
          .prepare("SELECT id FROM users WHERE phone_e164 = ? LIMIT 1")
          .get(phoneE164);
        if (existingPhone) {
          res.status(409).json({
            error:
              "An account is already registered with this phone number. Please sign in instead.",
          });
          return;
        }
      }

      const requestedUsername = (username ?? displayHandle ?? "").trim();
      let finalHandle: string;
      if (requestedUsername) {
        const normalized = normalizeHandle(requestedUsername);
        if (!normalized) {
          res.status(400).json({
            error: "Username must be at least 2 characters (letters, numbers, dots, underscores).",
          });
          return;
        }
        const existingHandle = db
          .prepare("SELECT id FROM users WHERE LOWER(display_handle) = LOWER(?) LIMIT 1")
          .get(normalized);
        if (existingHandle) {
          res.status(409).json({
            error: "That username is already taken. Please choose another.",
          });
          return;
        }
        finalHandle = normalized;
      } else {
        finalHandle = makeUniqueHandle(name);
      }

      const phoneVerified = 0;

      const userId = `u_${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      let avatarMediaId: string | null = null;

      if (avatarDataUrl && avatarDataUrl.startsWith("data:image/")) {
        const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(avatarDataUrl);
        if (match && match[1] && match[2]) {
          const buf = Buffer.from(match[2], "base64");
          if (buf.byteLength <= 4 * 1024 * 1024) {
            const ext = match[1].split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "jpg";
            const fileName = `avatar_${userId}.${ext}`;
            fs.writeFileSync(path.join(mediaDir, fileName), buf);
            avatarMediaId = `med_${crypto.randomUUID()}`;
            db.prepare(
              "INSERT INTO media_objects (id, owner_id, recipient_id, kind, mime_type, original_name, file_path, size_bytes, is_public_avatar, created_at) VALUES (?, ?, NULL, 'image', ?, ?, ?, ?, 1, ?)",
            ).run(avatarMediaId, userId, match[1], fileName, fileName, buf.byteLength, now);
          }
        }
      }

      db.prepare(
        `INSERT INTO users (id, email, phone_e164, phone_verified, full_name, display_handle, bio, avatar_media_id, password_hash, theme, created_at, last_active_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'instagram', ?, ?)`,
      ).run(
        userId,
        cleanEmail,
        phoneE164,
        phoneVerified,
        name,
        finalHandle,
        String(bio).trim().slice(0, 200),
        avatarMediaId,
        hashPassword(pwd),
        now,
        now,
      );

      createNfcTokenForUser(userId);
      const token = issueSession(userId, req, res);
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as DbUser;

      broadcastEvent("user:registered", { user: toPublicUser(user, true) }, user.id);

      res.status(201).json({
        token,
        user: toSelfUser(user),
      });
    } catch (err) {
      console.error("register error", err);
      res.status(500).json({ error: "Registration failed. Please try again." });
    }
  });

  // Login using email, username, or phone number + password
  router.post("/auth/login", (req, res) => {
    const { identifier, email, phone, countryCode, password } = req.body as {
      identifier?: string;
      email?: string;
      phone?: string;
      countryCode?: string;
      password?: string;
    };

    const rawIdentifier = String(identifier ?? email ?? phone ?? "").trim();
    if (!rawIdentifier) {
      res.status(400).json({ error: "Enter your email, username, or phone number." });
      return;
    }

    const user = findUserByIdentifier(rawIdentifier, countryCode ?? "+91");
    if (!user || !verifyPassword(String(password ?? ""), user.password_hash)) {
      res.status(401).json({ error: "Invalid email, username, phone number, or password." });
      return;
    }

    const existingNfc = db
      .prepare("SELECT id FROM nfc_links WHERE user_id = ? LIMIT 1")
      .get(user.id);
    if (!existingNfc) {
      createNfcTokenForUser(user.id);
    }

    const now = new Date().toISOString();
    db.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").run(now, user.id);
    const token = issueSession(user.id, req, res);

    res.json({
      token,
      user: toSelfUser({ ...user, last_active_at: now }),
    });
  });

  // Bridge verified Firebase (Google) accounts into the unified SQLite & WebSocket directory
  router.post("/auth/firebase-session", async (req, res) => {
    const authHeader = req.headers.authorization;
    const body = (req.body ?? {}) as {
      idToken?: string;
      fullName?: string;
      username?: string;
      bio?: string;
      avatarUrl?: string;
    };
    const rawToken =
      (authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "") ||
      String(body.idToken ?? "").trim();

    if (!rawToken) {
      res.status(400).json({ error: "Firebase ID token is required." });
      return;
    }

    try {
      const decoded = await getFirebaseAdminAuth().verifyIdToken(rawToken);
      const fbUid = decoded.uid;
      const decodedEmail = decoded.email ? normalizeEmail(decoded.email) : null;
      const now = new Date().toISOString();

      const rawPic =
        (typeof decoded.picture === "string" && decoded.picture.startsWith("https://")
          ? decoded.picture
          : null) ||
        (typeof body.avatarUrl === "string" && body.avatarUrl.startsWith("https://")
          ? body.avatarUrl
          : null);
      const externalAvatar = rawPic ? rawPic.slice(0, 1024) : null;

      const fbUserId = `fb_${fbUid}`;
      let user = db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(fbUserId) as
        DbUser | undefined;

      if (!user && decodedEmail) {
        user = db
          .prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1")
          .get(decodedEmail) as DbUser | undefined;
      }

      let created = false;
      if (!user) {
        created = true;
        const rawName = String(
          body.fullName ||
            decoded["name"] ||
            (decodedEmail ? decodedEmail.split("@")[0] : "") ||
            "Reader",
        )
          .trim()
          .slice(0, 60);
        const fullName = rawName.length >= 2 ? rawName : `${rawName} Reader`.slice(0, 60);

        let finalHandle: string | null = null;
        if (body.username) {
          const candidate = normalizeHandle(body.username);
          if (candidate) {
            const exists = db
              .prepare("SELECT id FROM users WHERE LOWER(display_handle) = LOWER(?) LIMIT 1")
              .get(candidate);
            if (!exists) finalHandle = candidate;
          }
        }
        if (!finalHandle) {
          finalHandle = makeUniqueHandle(fullName);
        }

        const bio = String(body.bio ?? "")
          .trim()
          .slice(0, 200);

        db.prepare(
          `INSERT INTO users (id, email, phone_e164, phone_verified, full_name, display_handle, bio, avatar_media_id, avatar_external_url, password_hash, theme, created_at, last_active_at)
           VALUES (?, ?, NULL, 0, ?, ?, ?, NULL, ?, ?, 'instagram', ?, ?)`,
        ).run(
          fbUserId,
          decodedEmail,
          fullName,
          finalHandle,
          bio,
          externalAvatar,
          hashPassword(crypto.randomBytes(24).toString("hex")),
          now,
          now,
        );

        // Preserve any legacy firebase_nfc_links token for continuity, or create a fresh one
        const legacyNfc = db
          .prepare(
            "SELECT token_ciphertext, token_hash, revoked, version, created_at, updated_at FROM firebase_nfc_links WHERE uid = ? LIMIT 1",
          )
          .get(fbUid) as
          | {
              token_ciphertext: string | null;
              token_hash: string | null;
              revoked: number;
              version: number;
              created_at: string;
              updated_at: string;
            }
          | undefined;

        if (
          legacyNfc &&
          legacyNfc.revoked === 0 &&
          legacyNfc.token_ciphertext &&
          legacyNfc.token_hash
        ) {
          db.prepare(
            "INSERT OR IGNORE INTO nfc_links (id, user_id, token_ciphertext, token_hash, revoked, version, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
          ).run(
            `nfc_${crypto.randomUUID()}`,
            fbUserId,
            legacyNfc.token_ciphertext,
            legacyNfc.token_hash,
            legacyNfc.version,
            legacyNfc.created_at,
            now,
          );
        } else {
          createNfcTokenForUser(fbUserId);
        }

        user = db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(fbUserId) as DbUser;
        broadcastEvent("user:registered", { user: toPublicUser(user, true) }, user.id);
      } else {
        db.prepare(
          "UPDATE users SET last_active_at = ?, avatar_external_url = COALESCE(avatar_external_url, ?) WHERE id = ?",
        ).run(now, externalAvatar, user.id);
        const existingNfc = db
          .prepare("SELECT id FROM nfc_links WHERE user_id = ? LIMIT 1")
          .get(user.id);
        if (!existingNfc) {
          createNfcTokenForUser(user.id);
        }
        user = db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(user.id) as DbUser;
      }

      const token = issueSession(user.id, req, res);
      res.status(created ? 201 : 200).json({
        token,
        created,
        user: toSelfUser(user),
      });
    } catch (err) {
      console.error("firebase-session error:", err);
      res.status(401).json({ error: "Invalid Firebase ID token." });
    }
  });

  router.post("/auth/firebase-cookie", async (req, res) => {
    const authHeader = req.headers.authorization;
    const bodyToken = (req.body as { idToken?: string } | undefined)?.idToken;
    const rawToken =
      (authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "") ||
      String(bodyToken ?? "").trim();

    if (!rawToken) {
      res.status(400).json({ error: "Firebase ID token is required." });
      return;
    }

    try {
      const decoded = await getFirebaseAdminAuth().verifyIdToken(rawToken);
      const signed = signCookieToken(decoded.uid);
      const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
      res.clearCookie("rc_session", { path: "/" });
      res.cookie("rc_fb_session", signed, {
        httpOnly: true,
        sameSite: isHttps ? "none" : "lax",
        path: "/",
        maxAge: 7 * 24 * 60 * 60 * 1000,
        secure: isHttps,
      });
      res.json({ ok: true, uid: decoded.uid });
    } catch {
      res.status(401).json({ error: "Invalid Firebase ID token." });
    }
  });

  router.post("/auth/logout", (req: AuthedRequest, res) => {
    const token = extractToken(req);
    if (token) {
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
    }
    res.clearCookie("rc_session", { path: "/" });
    res.clearCookie("rc_fb_session", { path: "/" });
    res.json({ ok: true });
  });

  router.delete("/auth/account", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const mediaRows = db
      .prepare("SELECT file_path FROM media_objects WHERE owner_id = ?")
      .all(me.id) as { file_path: string }[];

    db.prepare("DELETE FROM users WHERE id = ?").run(me.id);

    for (const m of mediaRows) {
      if (!m.file_path) continue;
      const diskPath = path.join(mediaDir, m.file_path);
      try {
        if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
      } catch {
        /* ignore file cleanup errors */
      }
    }

    res.clearCookie("rc_session", { path: "/" });
    res.clearCookie("rc_fb_session", { path: "/" });
    broadcastEvent("user:deleted", { userId: me.id }, me.id);
    res.json({ ok: true, deletedUserId: me.id });
  });

  router.get("/auth/session", (req, res) => {
    const resolved = lookupSessionUser(req);
    if (!resolved) {
      res.json({ authenticated: false, user: null });
      return;
    }
    const { user } = resolved;
    const now = new Date().toISOString();
    db.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").run(now, user.id);
    res.json({
      authenticated: true,
      user: toSelfUser({ ...user, last_active_at: now }),
    });
  });

  router.get("/auth/me", (req, res) => {
    const resolved = lookupSessionUser(req);
    if (!resolved) {
      res.status(401).json({ error: "Not signed in." });
      return;
    }
    const { user } = resolved;
    const now = new Date().toISOString();
    db.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").run(now, user.id);
    res.json({
      user: toSelfUser({ ...user, last_active_at: now }),
    });
  });

  // Send real SMS OTP (Forgot Password or Phone Verification)
  router.post("/auth/otp/send", async (req, res) => {
    const {
      phone,
      countryCode,
      purpose = "reset_password",
    } = req.body as {
      phone?: string;
      countryCode?: string;
      purpose?: "reset_password" | "verify_phone" | "register";
    };

    const phoneE164 = normalizePhoneE164(phone ?? "", countryCode ?? "+91");
    if (!phoneE164) {
      res.status(400).json({ error: "Enter a valid phone number." });
      return;
    }

    if (purpose === "reset_password") {
      const existing = db
        .prepare("SELECT id FROM users WHERE phone_e164 = ? LIMIT 1")
        .get(phoneE164);
      if (!existing) {
        res.status(404).json({ error: "No account is registered with that phone number." });
        return;
      }
    }

    const recentWindow = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const recentCount = db
      .prepare("SELECT COUNT(*) AS cnt FROM otp_challenges WHERE phone_e164 = ? AND created_at > ?")
      .get(phoneE164, recentWindow) as { cnt: number };

    if (recentCount.cnt >= 5) {
      res.status(429).json({ error: "Too many OTP requests. Please wait 15 minutes." });
      return;
    }

    const result = await sendTwilioOtp(phoneE164);
    if (!result.ok) {
      res.status(503).json({ error: result.error, needsConfig: !getTwilioConfig().configured });
      return;
    }

    const now = new Date();
    db.prepare(
      "INSERT INTO otp_challenges (id, phone_e164, purpose, created_at, expires_at, attempts, consumed) VALUES (?, ?, ?, ?, ?, 0, 0)",
    ).run(
      `otp_${crypto.randomUUID()}`,
      phoneE164,
      purpose,
      now.toISOString(),
      new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    );

    res.json({ ok: true, phoneMasked: maskPhone(phoneE164) });
  });

  // Reset password with real verified OTP
  router.post("/auth/otp/reset-password", async (req, res) => {
    const { phone, countryCode, code, newPassword } = req.body as {
      phone?: string;
      countryCode?: string;
      code?: string;
      newPassword?: string;
    };

    const phoneE164 = normalizePhoneE164(phone ?? "", countryCode ?? "+91");
    if (!phoneE164) {
      res.status(400).json({ error: "Enter a valid phone number." });
      return;
    }

    const pwd = String(newPassword ?? "");
    if (pwd.length < 8) {
      res.status(400).json({ error: "New password must be at least 8 characters." });
      return;
    }

    const user = db.prepare("SELECT * FROM users WHERE phone_e164 = ? LIMIT 1").get(phoneE164) as
      DbUser | undefined;
    if (!user) {
      res.status(404).json({ error: "No account found for that phone number." });
      return;
    }

    const check = await verifyTwilioOtp(phoneE164, String(code ?? ""));
    if (!check.ok) {
      res.status(400).json({ error: check.error, needsConfig: !getTwilioConfig().configured });
      return;
    }

    db.prepare("UPDATE users SET password_hash = ?, phone_verified = 1 WHERE id = ?").run(
      hashPassword(pwd),
      user.id,
    );
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);

    res.json({ ok: true });
  });

  // Verify signed-in user's phone number with OTP
  router.post("/auth/otp/verify-phone", requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    if (!user.phone_e164) {
      res.status(400).json({ error: "No phone number is linked to this account yet." });
      return;
    }
    const { code } = req.body as { code?: string };
    const check = await verifyTwilioOtp(user.phone_e164, String(code ?? ""));
    if (!check.ok) {
      res.status(400).json({ error: check.error, needsConfig: !getTwilioConfig().configured });
      return;
    }
    db.prepare("UPDATE users SET phone_verified = 1 WHERE id = ?").run(user.id);
    res.json({ ok: true, phoneVerified: true });
  });

  router.post("/auth/change-password", requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!verifyPassword(String(currentPassword ?? ""), user.password_hash)) {
      res.status(400).json({ error: "Current password is incorrect." });
      return;
    }
    const nextPwd = String(newPassword ?? "");
    if (nextPwd.length < 8) {
      res.status(400).json({ error: "New password must be at least 8 characters." });
      return;
    }
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      hashPassword(nextPwd),
      user.id,
    );
    res.json({ ok: true });
  });

  // Update profile details
  router.patch("/profile", requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { fullName, bio, displayHandle } = req.body as {
      fullName?: string;
      bio?: string;
      displayHandle?: string;
    };

    const nextName = fullName !== undefined ? String(fullName).trim() : user.full_name;
    if (nextName.length < 2 || nextName.length > 60) {
      res.status(400).json({ error: "Full name must be 2–60 characters." });
      return;
    }
    const nextBio = bio !== undefined ? String(bio).trim().slice(0, 200) : user.bio;
    let nextHandle = user.display_handle;
    if (displayHandle !== undefined) {
      const normalized = normalizeHandle(String(displayHandle));
      if (!normalized) {
        res.status(400).json({ error: "Username must be at least 2 characters." });
        return;
      }
      const conflict = db
        .prepare("SELECT id FROM users WHERE LOWER(display_handle) = LOWER(?) AND id != ? LIMIT 1")
        .get(normalized, user.id);
      if (conflict) {
        res.status(409).json({ error: "That username is already taken." });
        return;
      }
      nextHandle = normalized;
    }

    db.prepare("UPDATE users SET full_name = ?, bio = ?, display_handle = ? WHERE id = ?").run(
      nextName,
      nextBio,
      nextHandle,
      user.id,
    );

    const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as DbUser;
    res.json({
      user: toSelfUser(updated),
    });
  });

  router.patch("/profile/theme", requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { theme } = req.body as { theme?: string };
    if (theme !== "instagram" && theme !== "emerald" && theme !== "dark") {
      res.status(400).json({ error: "Theme must be instagram, emerald, or dark." });
      return;
    }
    db.prepare("UPDATE users SET theme = ? WHERE id = ?").run(theme as SecretTheme, user.id);
    res.json({ ok: true, theme });
  });

  router.post("/profile/avatar", requireAuth, upload.single("file"), (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No image file provided." });
      return;
    }
    if (!file.mimetype.startsWith("image/")) {
      fs.unlinkSync(file.path);
      res.status(400).json({ error: "Avatar must be an image file." });
      return;
    }

    const mediaId = `med_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO media_objects (id, owner_id, recipient_id, kind, mime_type, original_name, file_path, size_bytes, is_public_avatar, created_at) VALUES (?, ?, NULL, 'image', ?, ?, ?, ?, 1, ?)",
    ).run(
      mediaId,
      user.id,
      file.mimetype,
      file.originalname || "avatar.jpg",
      file.filename,
      file.size,
      now,
    );

    db.prepare("UPDATE users SET avatar_media_id = ? WHERE id = ?").run(mediaId, user.id);
    const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as DbUser;
    res.json({
      user: toSelfUser(updated),
    });
  });

  // Personal NFC Card & Secret Link Management (supports SQLite sessions + Firebase users)
  router.get("/nfc", async (req: AuthedRequest, res) => {
    const resolved = lookupSessionUser(req);
    if (resolved) {
      const user = resolved.user;
      let row = db.prepare("SELECT * FROM nfc_links WHERE user_id = ?").get(user.id) as
        | {
            token_ciphertext: string | null;
            revoked: number;
            version: number;
            updated_at: string;
          }
        | undefined;

      if (!row) {
        createNfcTokenForUser(user.id);
        row = db.prepare("SELECT * FROM nfc_links WHERE user_id = ?").get(user.id) as {
          token_ciphertext: string | null;
          revoked: number;
          version: number;
          updated_at: string;
        };
      }

      const token =
        row.revoked === 0 && row.token_ciphertext ? decryptToken(row.token_ciphertext) : null;

      res.json({
        revoked: row.revoked === 1 || !token,
        version: row.version,
        updatedAt: row.updated_at,
        token,
        path: token ? `/nfc/${token}` : null,
      });
      return;
    }

    const fbUid = await resolveFirebaseUid(req);
    if (!fbUid) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const hintName = String(req.query["fullName"] ?? "").trim();
    const hintHandle = String(req.query["displayHandle"] ?? "").trim();

    let fbRow = db.prepare("SELECT * FROM firebase_nfc_links WHERE uid = ?").get(fbUid) as
      | {
          token_ciphertext: string | null;
          revoked: number;
          version: number;
          updated_at: string;
        }
      | undefined;

    if (!fbRow) {
      createFirebaseNfcToken(fbUid, hintName || "Reader", hintHandle);
      fbRow = db.prepare("SELECT * FROM firebase_nfc_links WHERE uid = ?").get(fbUid) as {
        token_ciphertext: string | null;
        revoked: number;
        version: number;
        updated_at: string;
      };
    }

    const token =
      fbRow.revoked === 0 && fbRow.token_ciphertext ? decryptToken(fbRow.token_ciphertext) : null;

    res.json({
      revoked: fbRow.revoked === 1 || !token,
      version: fbRow.version,
      updatedAt: fbRow.updated_at,
      token,
      path: token ? `/nfc/${token}` : null,
    });
  });

  router.post("/nfc/regenerate", async (req: AuthedRequest, res) => {
    const resolved = lookupSessionUser(req);
    if (resolved) {
      const { token, version } = createNfcTokenForUser(resolved.user.id);
      res.json({
        revoked: false,
        version,
        updatedAt: new Date().toISOString(),
        token,
        path: `/nfc/${token}`,
      });
      return;
    }

    const fbUid = await resolveFirebaseUid(req);
    if (!fbUid) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const body = (req.body ?? {}) as { fullName?: string; displayHandle?: string };
    const { token, version } = createFirebaseNfcToken(
      fbUid,
      String(body.fullName ?? "Reader"),
      String(body.displayHandle ?? ""),
    );
    res.json({
      revoked: false,
      version,
      updatedAt: new Date().toISOString(),
      token,
      path: `/nfc/${token}`,
    });
  });

  router.post("/nfc/revoke", async (req: AuthedRequest, res) => {
    const resolved = lookupSessionUser(req);
    const now = new Date().toISOString();
    if (resolved) {
      db.prepare(
        "UPDATE nfc_links SET revoked = 1, token_ciphertext = NULL, token_hash = NULL, updated_at = ? WHERE user_id = ?",
      ).run(now, resolved.user.id);
      res.json({ revoked: true, token: null, path: null, updatedAt: now });
      return;
    }

    const fbUid = await resolveFirebaseUid(req);
    if (!fbUid) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    db.prepare(
      "UPDATE firebase_nfc_links SET revoked = 1, token_ciphertext = NULL, token_hash = NULL, updated_at = ? WHERE uid = ?",
    ).run(now, fbUid);
    res.json({ revoked: true, token: null, path: null, updatedAt: now });
  });

  // Resolve NFC tap securely — NEVER exposes passwords, phone numbers, emails, or other user data
  router.get("/nfc/resolve", async (req, res) => {
    const token = String(req.query["token"] ?? "").trim();
    if (!token || token.length < 16) {
      res.status(404).json({ status: "invalid" });
      return;
    }

    const tokenHash = sha256(token);
    const resolved = lookupSessionUser(req);
    const fbUid = await resolveFirebaseUid(req);

    const link = db
      .prepare(
        `SELECT n.user_id, n.revoked, u.full_name, u.display_handle
         FROM nfc_links n
         JOIN users u ON u.id = n.user_id
         WHERE n.token_hash = ? AND n.revoked = 0
         LIMIT 1`,
      )
      .get(tokenHash) as
      { user_id: string; revoked: number; full_name: string; display_handle: string } | undefined;

    if (link) {
      if (resolved && resolved.user.id === link.user_id) {
        res.json({
          status: "authorized",
          owner: {
            id: link.user_id,
            fullName: link.full_name,
            displayHandle: link.display_handle,
          },
        });
        return;
      }

      const initial = link.full_name.trim().slice(0, 1).toUpperCase() || "R";
      res.json({
        status: "login_required",
        signedInAsDifferentAccount: Boolean(
          (resolved && resolved.user.id !== link.user_id) || fbUid,
        ),
        ownerHint: `${initial}***`,
      });
      return;
    }

    const fbLink = db
      .prepare(
        `SELECT uid, full_name, display_handle
         FROM firebase_nfc_links
         WHERE token_hash = ? AND revoked = 0
         LIMIT 1`,
      )
      .get(tokenHash) as { uid: string; full_name: string; display_handle: string } | undefined;

    if (!fbLink) {
      res.status(404).json({ status: "invalid" });
      return;
    }

    if (fbUid && fbUid === fbLink.uid) {
      res.json({
        status: "authorized",
        owner: {
          id: fbLink.uid,
          fullName: fbLink.full_name,
          displayHandle: fbLink.display_handle,
        },
      });
      return;
    }

    const initial = fbLink.full_name.trim().slice(0, 1).toUpperCase() || "R";
    res.json({
      status: "login_required",
      signedInAsDifferentAccount: Boolean((fbUid && fbUid !== fbLink.uid) || resolved),
      ownerHint: `${initial}***`,
    });
  });

  // Discover Users — lists ALL registered non-blocked users (strictly public fields only)
  router.get("/users", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const raw = String(req.query["q"] ?? "")
      .trim()
      .toLowerCase();
    const filter = String(req.query["filter"] ?? "all");

    let rows: DbUser[];
    if (raw) {
      const like = `%${raw}%`;
      rows = db
        .prepare(
          `SELECT * FROM users
           WHERE id != ?
             AND (LOWER(full_name) LIKE ? OR LOWER(display_handle) LIKE ? OR LOWER(bio) LIKE ?)
           ORDER BY last_active_at DESC
           LIMIT 500`,
        )
        .all(me.id, like, like, like) as DbUser[];
    } else {
      rows = db
        .prepare(
          `SELECT * FROM users
           WHERE id != ?
           ORDER BY last_active_at DESC
           LIMIT 500`,
        )
        .all(me.id) as DbUser[];
    }

    let visible = rows
      .filter((u) => !didUserBlock(u.id, me.id))
      .map((u) => ({
        ...toPublicUser(u, isUserConnected(u.id) || undefined, me.id),
        blockedByMe: didUserBlock(me.id, u.id),
      }));

    if (filter === "following") {
      visible = visible.filter((u) => u.isFollowing);
    } else if (filter === "followers") {
      visible = visible.filter((u) => u.followsMe);
    }

    visible.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return b.lastActiveAt.localeCompare(a.lastActiveAt);
    });

    res.json({ users: visible });
  });

  // Search users by name, username, or phone (strictly public fields returned)
  router.get("/users/search", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const raw = String(req.query["q"] ?? "").trim();
    if (!raw) {
      const recent = db
        .prepare("SELECT * FROM users WHERE id != ? ORDER BY last_active_at DESC LIMIT 100")
        .all(me.id) as DbUser[];
      const visible = recent
        .filter((u) => !didUserBlock(u.id, me.id))
        .map((u) => ({
          ...toPublicUser(u, isUserConnected(u.id) || undefined, me.id),
          blockedByMe: didUserBlock(me.id, u.id),
        }));
      res.json({ users: visible });
      return;
    }

    const maybePhone = normalizePhoneE164(raw, "+91");
    const like = `%${raw.toLowerCase()}%`;

    const rows = db
      .prepare(
        `SELECT * FROM users
         WHERE id != ?
           AND (LOWER(full_name) LIKE ? OR LOWER(display_handle) LIKE ? OR phone_e164 = ?)
         ORDER BY last_active_at DESC
         LIMIT 30`,
      )
      .all(me.id, like, like, maybePhone ?? "") as DbUser[];

    const visible = rows
      .filter((u) => !didUserBlock(u.id, me.id))
      .map((u) => ({
        ...toPublicUser(u, isUserConnected(u.id) || undefined, me.id),
        blockedByMe: didUserBlock(me.id, u.id),
      }));

    res.json({ users: visible });
  });

  // Public profile view for another user (strictly hides email, phone, password)
  router.get("/users/:userId", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const targetId = String(req.params["userId"] ?? "").trim();
    const target = db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(targetId) as
      DbUser | undefined;

    if (!target || (target.id !== me.id && didUserBlock(target.id, me.id))) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    res.json({
      user: {
        ...toPublicUser(target, isUserConnected(target.id) || undefined, me.id),
        blockedByMe: didUserBlock(me.id, target.id),
        blockedMe: didUserBlock(target.id, me.id),
      },
    });
  });

  // Follow / Unfollow a user
  router.post("/users/:userId/follow", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const targetId = String(req.params["userId"] ?? "").trim();
    if (!targetId || targetId === me.id) {
      res.status(400).json({ error: "Cannot follow yourself." });
      return;
    }
    const target = db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").get(targetId);
    if (!target) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    if (isBlockedBetween(me.id, targetId)) {
      res.status(403).json({ error: "Cannot follow a blocked user." });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      "INSERT OR IGNORE INTO followers (follower_id, following_id, created_at) VALUES (?, ?, ?)",
    ).run(me.id, targetId, now);

    const targetStats = getFollowStats(targetId, me.id);
    const myStats = getFollowStats(me.id, me.id);

    sendToUser(targetId, "follow:updated", {
      followerId: me.id,
      followingId: targetId,
      isFollowing: true,
      targetFollowerCount: targetStats.followerCount,
    });
    sendToUser(me.id, "follow:updated", {
      followerId: me.id,
      followingId: targetId,
      isFollowing: true,
      targetFollowerCount: targetStats.followerCount,
      myFollowingCount: myStats.followingCount,
    });

    res.json({
      ok: true,
      isFollowing: true,
      followerCount: targetStats.followerCount,
      followingCount: targetStats.followingCount,
      myFollowingCount: myStats.followingCount,
    });
  });

  router.delete("/users/:userId/follow", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const targetId = String(req.params["userId"] ?? "").trim();
    db.prepare("DELETE FROM followers WHERE follower_id = ? AND following_id = ?").run(
      me.id,
      targetId,
    );

    const targetStats = getFollowStats(targetId, me.id);
    const myStats = getFollowStats(me.id, me.id);

    sendToUser(targetId, "follow:updated", {
      followerId: me.id,
      followingId: targetId,
      isFollowing: false,
      targetFollowerCount: targetStats.followerCount,
    });
    sendToUser(me.id, "follow:updated", {
      followerId: me.id,
      followingId: targetId,
      isFollowing: false,
      targetFollowerCount: targetStats.followerCount,
      myFollowingCount: myStats.followingCount,
    });

    res.json({
      ok: true,
      isFollowing: false,
      followerCount: targetStats.followerCount,
      followingCount: targetStats.followingCount,
      myFollowingCount: myStats.followingCount,
    });
  });

  // List active conversations for the current user (sorted pinned first, then latest message)
  router.get("/conversations", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;

    // Mark any undelivered messages addressed to me as delivered now
    const deliveredAt = new Date().toISOString();
    const undeliveredSenders = db
      .prepare(
        "SELECT DISTINCT sender_id FROM messages WHERE recipient_id = ? AND delivered_at IS NULL",
      )
      .all(me.id) as { sender_id: string }[];
    if (undeliveredSenders.length > 0) {
      db.prepare(
        "UPDATE messages SET delivered_at = ? WHERE recipient_id = ? AND delivered_at IS NULL",
      ).run(deliveredAt, me.id);
      for (const { sender_id } of undeliveredSenders) {
        if (!isBlockedBetween(me.id, sender_id)) {
          sendToUser(sender_id, "messages:delivered", {
            byUserId: me.id,
            peerId: me.id,
            deliveredAt,
          });
        }
      }
    }

    const peerRows = db
      .prepare(
        `SELECT DISTINCT CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END AS peer_id
         FROM messages
         WHERE sender_id = ? OR recipient_id = ?`,
      )
      .all(me.id, me.id, me.id) as { peer_id: string }[];

    const conversations = peerRows
      .map(({ peer_id }) => {
        const peer = db.prepare("SELECT * FROM users WHERE id = ?").get(peer_id) as
          DbUser | undefined;
        if (!peer) return null;
        const key = threadKeyFor(me.id, peer.id);
        const lastMsg = db
          .prepare("SELECT * FROM messages WHERE thread_key = ? ORDER BY created_at DESC LIMIT 1")
          .get(key) as DbMessageRow | undefined;

        const unread = db
          .prepare(
            "SELECT COUNT(*) AS cnt FROM messages WHERE thread_key = ? AND recipient_id = ? AND seen_at IS NULL AND deleted_at IS NULL",
          )
          .get(key, me.id) as { cnt: number };

        const settings = db
          .prepare(
            "SELECT pinned, muted FROM conversation_settings WHERE user_id = ? AND peer_id = ? LIMIT 1",
          )
          .get(me.id, peer.id) as { pinned: number; muted: number } | undefined;

        return {
          peer: toPublicUser(peer, isUserConnected(peer.id) || undefined, me.id),
          blockedByMe: didUserBlock(me.id, peer.id),
          blockedMe: didUserBlock(peer.id, me.id),
          pinned: settings?.pinned === 1,
          muted: settings?.muted === 1,
          lastMessage: lastMsg ? serializeMessage(lastMsg, me.id) : null,
          unreadCount: unread.cnt,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (b.lastMessage?.createdAt ?? "").localeCompare(a.lastMessage?.createdAt ?? "");
      });

    res.json({ conversations });
  });

  // Update pin/mute settings for a conversation
  router.patch("/conversations/:peerId", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const peerId = String(req.params["peerId"] ?? "").trim();
    if (!peerId || peerId === me.id) {
      res.status(400).json({ error: "Valid peer user required." });
      return;
    }

    const existing = db
      .prepare(
        "SELECT pinned, muted FROM conversation_settings WHERE user_id = ? AND peer_id = ? LIMIT 1",
      )
      .get(me.id, peerId) as { pinned: number; muted: number } | undefined;

    const body = req.body as { pinned?: boolean; muted?: boolean };
    const pinned = body.pinned !== undefined ? (body.pinned ? 1 : 0) : (existing?.pinned ?? 0);
    const muted = body.muted !== undefined ? (body.muted ? 1 : 0) : (existing?.muted ?? 0);
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO conversation_settings (user_id, peer_id, pinned, muted, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, peer_id) DO UPDATE SET pinned = excluded.pinned, muted = excluded.muted, updated_at = excluded.updated_at`,
    ).run(me.id, peerId, pinned, muted, now);

    res.json({ ok: true, pinned: pinned === 1, muted: muted === 1 });
  });

  // Fetch thread messages with a peer (supports ?q= search)
  router.get("/messages/:peerId", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const peerId = String(req.params["peerId"] ?? "");
    const peer = db.prepare("SELECT * FROM users WHERE id = ?").get(peerId) as DbUser | undefined;
    if (!peer) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const key = threadKeyFor(me.id, peer.id);
    const now = new Date().toISOString();
    const deliv = db
      .prepare(
        "UPDATE messages SET delivered_at = ? WHERE thread_key = ? AND sender_id = ? AND recipient_id = ? AND delivered_at IS NULL",
      )
      .run(now, key, peer.id, me.id);
    if (deliv.changes > 0 && !isBlockedBetween(me.id, peer.id)) {
      sendToUser(peer.id, "messages:delivered", {
        byUserId: me.id,
        peerId: me.id,
        deliveredAt: now,
      });
    }

    const q = String(req.query["q"] ?? "")
      .trim()
      .toLowerCase();
    let rows: DbMessageRow[];
    if (q) {
      rows = db
        .prepare(
          "SELECT * FROM messages WHERE thread_key = ? AND deleted_at IS NULL AND LOWER(text) LIKE ? ORDER BY created_at ASC LIMIT 300",
        )
        .all(key, `%${q}%`) as DbMessageRow[];
    } else {
      rows = db
        .prepare("SELECT * FROM messages WHERE thread_key = ? ORDER BY created_at ASC LIMIT 300")
        .all(key) as DbMessageRow[];
    }

    const settings = db
      .prepare(
        "SELECT pinned, muted FROM conversation_settings WHERE user_id = ? AND peer_id = ? LIMIT 1",
      )
      .get(me.id, peer.id) as { pinned: number; muted: number } | undefined;

    res.json({
      peer: toPublicUser(peer, isUserConnected(peer.id) || undefined, me.id),
      blockedByMe: didUserBlock(me.id, peer.id),
      blockedMe: didUserBlock(peer.id, me.id),
      pinned: settings?.pinned === 1,
      muted: settings?.muted === 1,
      messages: rows.map((r) => serializeMessage(r, me.id)),
    });
  });

  // Send message (supports text, media, gallery reuse, replies, and delivery receipts)
  router.post("/messages", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const {
      peerId,
      text = "",
      mediaId = null,
      replyToId = null,
    } = req.body as {
      peerId?: string;
      text?: string;
      mediaId?: string | null;
      replyToId?: string | null;
    };

    const targetId = String(peerId ?? "").trim();
    if (!targetId || targetId === me.id) {
      res.status(400).json({ error: "Valid recipient required." });
      return;
    }

    const peer = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId) as DbUser | undefined;
    if (!peer) {
      res.status(404).json({ error: "Recipient not found." });
      return;
    }

    if (isBlockedBetween(me.id, peer.id)) {
      res.status(403).json({
        error: "Messaging is blocked between you and this user.",
      });
      return;
    }

    const cleanText = String(text).trim().slice(0, 4000);
    let mediaKind: string | null = null;
    let mediaName: string | null = null;
    let validMediaId: string | null = null;

    if (mediaId) {
      const mediaRow = db
        .prepare(
          "SELECT * FROM media_objects WHERE id = ? AND (owner_id = ? OR recipient_id = ?) LIMIT 1",
        )
        .get(mediaId, me.id, me.id) as
        | {
            id: string;
            owner_id: string;
            recipient_id: string | null;
            kind: string;
            original_name: string;
          }
        | undefined;
      if (!mediaRow) {
        res.status(403).json({ error: "Invalid media attachment." });
        return;
      }
      validMediaId = mediaRow.id;
      mediaKind = mediaRow.kind;
      mediaName = mediaRow.original_name;
      if (!mediaRow.recipient_id && mediaRow.owner_id === me.id) {
        db.prepare("UPDATE media_objects SET recipient_id = ? WHERE id = ?").run(
          peer.id,
          mediaRow.id,
        );
      }
    }

    if (!cleanText && !validMediaId) {
      res.status(400).json({ error: "Message text or media is required." });
      return;
    }

    const key = threadKeyFor(me.id, peer.id);
    let validReplyToId: string | null = null;
    if (replyToId) {
      const parent = db
        .prepare("SELECT id FROM messages WHERE id = ? AND thread_key = ? LIMIT 1")
        .get(String(replyToId), key) as { id: string } | undefined;
      if (parent) validReplyToId = parent.id;
    }

    const msgId = `msg_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const deliveredAt = isUserConnected(peer.id) ? now : null;
    const displayText =
      cleanText ||
      (mediaKind === "video"
        ? "Sent a video"
        : mediaKind === "audio"
          ? "Voice note"
          : "Sent a photo");

    db.prepare(
      `INSERT INTO messages (id, thread_key, sender_id, recipient_id, text, media_id, media_kind, media_name, reply_to_id, delivered_at, created_at, seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      msgId,
      key,
      me.id,
      peer.id,
      displayText,
      validMediaId,
      mediaKind,
      mediaName,
      validReplyToId,
      deliveredAt,
      now,
    );

    const saved = db.prepare("SELECT * FROM messages WHERE id = ?").get(msgId) as DbMessageRow;

    const payloadForPeer = {
      message: serializeMessage(saved, peer.id),
      sender: toPublicUser(me, true, peer.id),
    };
    const payloadForMe = {
      message: serializeMessage(saved, me.id),
      sender: toPublicUser(me, true, me.id),
    };

    sendToUser(peer.id, "message:new", payloadForPeer);
    sendToUser(me.id, "message:new", payloadForMe);

    res.status(201).json(payloadForMe);
  });

  // Edit own message
  router.patch("/messages/:id", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const msgId = String(req.params["id"] ?? "").trim();
    const msg = db.prepare("SELECT * FROM messages WHERE id = ? LIMIT 1").get(msgId) as
      DbMessageRow | undefined;

    if (!msg) {
      res.status(404).json({ error: "Message not found." });
      return;
    }
    if (msg.sender_id !== me.id) {
      res.status(403).json({ error: "You can only edit your own messages." });
      return;
    }
    if (msg.deleted_at) {
      res.status(400).json({ error: "Deleted messages cannot be edited." });
      return;
    }

    const cleanText = String((req.body as { text?: string })?.text ?? "")
      .trim()
      .slice(0, 4000);
    if (!cleanText) {
      res.status(400).json({ error: "Message text cannot be empty." });
      return;
    }

    const editedAt = new Date().toISOString();
    db.prepare("UPDATE messages SET text = ?, edited_at = ? WHERE id = ?").run(
      cleanText,
      editedAt,
      msg.id,
    );

    const updated = db.prepare("SELECT * FROM messages WHERE id = ?").get(msg.id) as DbMessageRow;
    const forSender = serializeMessage(updated, msg.sender_id);
    const forRecipient = serializeMessage(updated, msg.recipient_id);

    sendToUser(msg.sender_id, "message:updated", { message: forSender });
    sendToUser(msg.recipient_id, "message:updated", { message: forRecipient });

    res.json({ message: forSender });
  });

  // Delete own message (soft-delete preserves thread continuity cleanly)
  router.delete("/messages/:id", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const msgId = String(req.params["id"] ?? "").trim();
    const msg = db.prepare("SELECT * FROM messages WHERE id = ? LIMIT 1").get(msgId) as
      DbMessageRow | undefined;

    if (!msg) {
      res.status(404).json({ error: "Message not found." });
      return;
    }
    if (msg.sender_id !== me.id) {
      res.status(403).json({ error: "You can only delete your own messages." });
      return;
    }

    const deletedAt = new Date().toISOString();
    db.prepare(
      "UPDATE messages SET deleted_at = ?, text = '', media_id = NULL, media_kind = NULL, media_name = NULL WHERE id = ?",
    ).run(deletedAt, msg.id);
    db.prepare("DELETE FROM message_reactions WHERE message_id = ?").run(msg.id);

    const updated = db.prepare("SELECT * FROM messages WHERE id = ?").get(msg.id) as DbMessageRow;
    const serialized = serializeMessage(updated, me.id);

    sendToUser(msg.sender_id, "message:deleted", { message: serialized });
    sendToUser(msg.recipient_id, "message:deleted", { message: serialized });

    res.json({ ok: true, message: serialized });
  });

  // React to a message with an emoji (toggles if same emoji clicked again)
  router.post("/messages/:id/reactions", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const msgId = String(req.params["id"] ?? "").trim();
    const emoji = String((req.body as { emoji?: string })?.emoji ?? "")
      .trim()
      .slice(0, 12);

    const msg = db.prepare("SELECT * FROM messages WHERE id = ? LIMIT 1").get(msgId) as
      DbMessageRow | undefined;
    if (!msg || msg.deleted_at) {
      res.status(404).json({ error: "Message not found." });
      return;
    }
    if (msg.sender_id !== me.id && msg.recipient_id !== me.id) {
      res.status(403).json({ error: "Not authorized to react to this message." });
      return;
    }
    if (isBlockedBetween(msg.sender_id, msg.recipient_id)) {
      res.status(403).json({ error: "Messaging is blocked between you and this user." });
      return;
    }

    const existing = db
      .prepare("SELECT emoji FROM message_reactions WHERE message_id = ? AND user_id = ? LIMIT 1")
      .get(msg.id, me.id) as { emoji: string } | undefined;

    if (!emoji || existing?.emoji === emoji) {
      db.prepare("DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?").run(
        msg.id,
        me.id,
      );
    } else {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO message_reactions (message_id, user_id, emoji, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`,
      ).run(msg.id, me.id, emoji, now);
    }

    const reactionsForMe = getReactionsForMessage(msg.id, me.id);
    const peerId = msg.sender_id === me.id ? msg.recipient_id : msg.sender_id;
    const reactionsForPeer = getReactionsForMessage(msg.id, peerId);

    sendToUser(me.id, "message:reaction", {
      messageId: msg.id,
      threadKey: msg.thread_key,
      reactions: reactionsForMe,
    });
    sendToUser(peerId, "message:reaction", {
      messageId: msg.id,
      threadKey: msg.thread_key,
      reactions: reactionsForPeer,
    });

    res.json({ ok: true, reactions: reactionsForMe });
  });

  // Mark messages in a thread as seen
  router.post("/messages/:peerId/seen", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const peerId = String(req.params["peerId"] ?? "");
    if (!peerId || isBlockedBetween(me.id, peerId)) {
      res.json({ ok: true, updated: 0 });
      return;
    }

    const key = threadKeyFor(me.id, peerId);
    const seenAt = new Date().toISOString();
    const result = db
      .prepare(
        "UPDATE messages SET seen_at = ?, delivered_at = COALESCE(delivered_at, ?) WHERE thread_key = ? AND sender_id = ? AND recipient_id = ? AND seen_at IS NULL",
      )
      .run(seenAt, seenAt, key, peerId, me.id);

    if (result.changes > 0) {
      sendToUser(peerId, "messages:seen", { byUserId: me.id, peerId: me.id, seenAt });
      sendToUser(me.id, "messages:seen", { byUserId: me.id, peerId, seenAt });
    }

    res.json({ ok: true, updated: result.changes, seenAt });
  });

  // Upload private photo / video / audio media (supports both Firebase ID tokens and SQLite sessions)
  router.post("/media", upload.single("file"), async (req: AuthedRequest, res) => {
    const file = req.file;
    const fbUid = await resolveFirebaseUid(req);
    const resolved = fbUid ? null : lookupSessionUser(req);

    if (!fbUid && !resolved) {
      if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    if (!file) {
      res.status(400).json({ error: "No file uploaded." });
      return;
    }

    const recipientId =
      typeof req.body?.["recipientId"] === "string" ? req.body["recipientId"].trim() : null;

    if (resolved && recipientId && isBlockedBetween(resolved.user.id, recipientId)) {
      fs.unlinkSync(file.path);
      res.status(403).json({ error: "Cannot share media with a blocked user." });
      return;
    }

    const kind = file.mimetype.startsWith("video/")
      ? "video"
      : file.mimetype.startsWith("audio/")
        ? "audio"
        : file.mimetype.startsWith("image/")
          ? "image"
          : null;

    if (!kind) {
      fs.unlinkSync(file.path);
      res.status(400).json({ error: "Only image, video, and audio files are supported." });
      return;
    }

    const mediaId = `${fbUid ? "fbm" : "med"}_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    if (fbUid) {
      db.prepare(
        "INSERT INTO firebase_media (id, owner_uid, recipient_uid, kind, mime_type, original_name, file_path, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        mediaId,
        fbUid,
        recipientId || null,
        kind,
        file.mimetype,
        file.originalname || `${kind}.${kind === "video" ? "mp4" : "jpg"}`,
        file.filename,
        file.size,
        now,
      );
    } else if (resolved) {
      db.prepare(
        "INSERT INTO media_objects (id, owner_id, recipient_id, kind, mime_type, original_name, file_path, size_bytes, is_public_avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
      ).run(
        mediaId,
        resolved.user.id,
        recipientId,
        kind,
        file.mimetype,
        file.originalname || `${kind}.${kind === "video" ? "mp4" : "jpg"}`,
        file.filename,
        file.size,
        now,
      );
    }

    res.status(201).json({
      id: mediaId,
      kind,
      mimeType: file.mimetype,
      originalName: file.originalname || `${kind}.${kind === "video" ? "mp4" : "jpg"}`,
      sizeBytes: file.size,
      createdAt: now,
      url: `/api/media/${mediaId}`,
      mine: true,
    });
  });

  // Grant recipient access when sharing an existing gallery item into a Firebase chat
  router.post("/media/:id/share", async (req: AuthedRequest, res) => {
    const fbUid = await resolveFirebaseUid(req);
    if (!fbUid) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const mediaId = String(req.params["id"] ?? "");
    const recipientId = String(
      (req.body as { recipientId?: string } | undefined)?.recipientId ?? "",
    ).trim();
    if (!recipientId) {
      res.status(400).json({ error: "recipientId is required." });
      return;
    }
    const fbItem = db
      .prepare("SELECT id, owner_uid, recipient_uid FROM firebase_media WHERE id = ? LIMIT 1")
      .get(mediaId) as { id: string; owner_uid: string; recipient_uid: string | null } | undefined;
    if (!fbItem || fbItem.owner_uid !== fbUid) {
      res.status(404).json({ error: "Media not found." });
      return;
    }
    const existing = new Set(
      (fbItem.recipient_uid ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    existing.add(recipientId);
    db.prepare("UPDATE firebase_media SET recipient_uid = ? WHERE id = ?").run(
      Array.from(existing).join(","),
      mediaId,
    );
    res.json({ ok: true });
  });

  // Delete an owned media file from the gallery & disk storage
  router.delete("/media/:id", async (req: AuthedRequest, res) => {
    const fbUid = await resolveFirebaseUid(req);
    const resolved = fbUid ? null : lookupSessionUser(req);
    if (!fbUid && !resolved) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const mediaId = String(req.params["id"] ?? "").trim();
    if (!mediaId) {
      res.status(400).json({ error: "Media ID is required." });
      return;
    }

    const baseMediaDir = path.resolve(mediaDir);

    if (fbUid) {
      const fbItem = db
        .prepare("SELECT id, owner_uid, file_path FROM firebase_media WHERE id = ? LIMIT 1")
        .get(mediaId) as { id: string; owner_uid: string; file_path: string } | undefined;
      if (!fbItem) {
        res.status(404).json({ error: "Media not found." });
        return;
      }
      if (fbItem.owner_uid !== fbUid) {
        res.status(403).json({ error: "You can only delete media that you uploaded." });
        return;
      }

      db.prepare("DELETE FROM firebase_media WHERE id = ? AND owner_uid = ?").run(mediaId, fbUid);
      const fullPath = path.resolve(baseMediaDir, path.basename(fbItem.file_path));
      if (fullPath.startsWith(baseMediaDir + path.sep) && fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
        } catch {
          /* ignore file unlink race */
        }
      }
      res.json({ ok: true, id: mediaId });
      return;
    }

    const me = resolved!.user;
    const item = db
      .prepare(
        "SELECT id, owner_id, file_path, is_public_avatar FROM media_objects WHERE id = ? LIMIT 1",
      )
      .get(mediaId) as
      { id: string; owner_id: string; file_path: string; is_public_avatar: number } | undefined;
    if (!item) {
      res.status(404).json({ error: "Media not found." });
      return;
    }
    if (item.owner_id !== me.id) {
      res.status(403).json({ error: "You can only delete media that you uploaded." });
      return;
    }
    if (item.is_public_avatar === 1) {
      res.status(400).json({ error: "Profile avatars cannot be deleted from the gallery." });
      return;
    }

    db.prepare("UPDATE messages SET media_kind = NULL, media_name = NULL WHERE media_id = ?").run(
      mediaId,
    );
    db.prepare("DELETE FROM media_objects WHERE id = ? AND owner_id = ?").run(mediaId, me.id);

    const fullPath = path.resolve(baseMediaDir, path.basename(item.file_path));
    if (fullPath.startsWith(baseMediaDir + path.sep) && fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
      } catch {
        /* ignore file unlink race */
      }
    }

    res.json({ ok: true, id: mediaId });
  });

  // Protected private media endpoint with ACL & block check
  router.get("/media/:id", async (req: AuthedRequest, res) => {
    const fbUid = await resolveFirebaseUid(req);
    const resolved = fbUid ? null : lookupSessionUser(req);
    if (!fbUid && !resolved) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const mediaId = String(req.params["id"] ?? "");
    const baseMediaDir = path.resolve(mediaDir);

    if (fbUid) {
      const fbItem = db
        .prepare("SELECT * FROM firebase_media WHERE id = ? LIMIT 1")
        .get(mediaId) as
        | {
            id: string;
            owner_uid: string;
            recipient_uid: string | null;
            kind: string;
            mime_type: string;
            original_name: string;
            file_path: string;
          }
        | undefined;
      if (!fbItem) {
        res.status(404).json({ error: "Media not found." });
        return;
      }
      const recipients = (fbItem.recipient_uid ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (fbItem.owner_uid !== fbUid && !recipients.includes(fbUid)) {
        res.status(403).json({ error: "You do not have permission to access this private media." });
        return;
      }
      const fullPath = path.resolve(baseMediaDir, path.basename(fbItem.file_path));
      if (!fullPath.startsWith(baseMediaDir + path.sep) || !fs.existsSync(fullPath)) {
        res.status(404).json({ error: "Media file missing." });
        return;
      }
      res.setHeader("Content-Type", fbItem.mime_type);
      res.setHeader("Cache-Control", "private, max-age=3600");
      if (req.query["download"] === "1") {
        const safeName = fbItem.original_name.replace(/["\r\n]/g, "_");
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      }
      res.sendFile(fullPath, { dotfiles: "allow" });
      return;
    }

    const me = resolved!.user;
    const item = db.prepare("SELECT * FROM media_objects WHERE id = ? LIMIT 1").get(mediaId) as
      | {
          id: string;
          owner_id: string;
          recipient_id: string | null;
          kind: string;
          mime_type: string;
          original_name: string;
          file_path: string;
          is_public_avatar: number;
        }
      | undefined;

    if (!item) {
      res.status(404).json({ error: "Media not found." });
      return;
    }

    if (item.is_public_avatar === 1) {
      if (item.owner_id !== me.id && isBlockedBetween(me.id, item.owner_id)) {
        res.status(403).json({ error: "Access denied." });
        return;
      }
    } else {
      const sharedInMessage = Boolean(
        db
          .prepare(
            "SELECT 1 FROM messages WHERE media_id = ? AND deleted_at IS NULL AND (sender_id = ? OR recipient_id = ?) LIMIT 1",
          )
          .get(item.id, me.id, me.id),
      );
      const allowed = item.owner_id === me.id || item.recipient_id === me.id || sharedInMessage;
      if (!allowed) {
        res.status(403).json({ error: "You do not have permission to access this private media." });
        return;
      }
      if (item.recipient_id && isBlockedBetween(item.owner_id, item.recipient_id)) {
        if (item.owner_id !== me.id) {
          res.status(403).json({ error: "Media unavailable due to block." });
          return;
        }
      }
    }

    const fullPath = path.resolve(baseMediaDir, path.basename(item.file_path));
    if (!fullPath.startsWith(baseMediaDir + path.sep) || !fs.existsSync(fullPath)) {
      res.status(404).json({ error: "Media file missing." });
      return;
    }

    res.setHeader("Content-Type", item.mime_type);
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (req.query["download"] === "1") {
      const safeName = item.original_name.replace(/["\r\n]/g, "_");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    }
    res.sendFile(fullPath, { dotfiles: "allow" });
  });

  // Gallery for Profile & Chat picker: photos & videos owned by or shared with the signed-in user
  router.get("/gallery", async (req: AuthedRequest, res) => {
    const fbUid = await resolveFirebaseUid(req);
    const resolved = fbUid ? null : lookupSessionUser(req);
    if (!fbUid && !resolved) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    if (fbUid) {
      const rows = db
        .prepare(
          `SELECT id, owner_uid, recipient_uid, kind, mime_type, original_name, size_bytes, created_at
           FROM firebase_media
           WHERE kind IN ('image', 'video')
           ORDER BY created_at DESC
           LIMIT 200`,
        )
        .all() as {
        id: string;
        owner_uid: string;
        recipient_uid: string | null;
        kind: string;
        mime_type: string;
        original_name: string;
        size_bytes: number;
        created_at: string;
      }[];

      const visible = rows.filter((r) => {
        if (r.owner_uid === fbUid) return true;
        return (r.recipient_uid ?? "")
          .split(",")
          .map((s) => s.trim())
          .includes(fbUid);
      });

      res.json({
        items: visible.slice(0, 120).map((r) => ({
          id: r.id,
          kind: r.kind as "image" | "video",
          mimeType: r.mime_type,
          originalName: r.original_name,
          sizeBytes: r.size_bytes,
          createdAt: r.created_at,
          url: `/api/media/${r.id}`,
          mine: r.owner_uid === fbUid,
        })),
      });
      return;
    }

    const me = resolved!.user;
    const rows = db
      .prepare(
        `SELECT id, owner_id, recipient_id, kind, mime_type, original_name, size_bytes, created_at
         FROM media_objects
         WHERE is_public_avatar = 0
           AND kind IN ('image', 'video')
           AND (owner_id = ? OR recipient_id = ?)
         ORDER BY created_at DESC
         LIMIT 120`,
      )
      .all(me.id, me.id) as {
      id: string;
      owner_id: string;
      recipient_id: string | null;
      kind: string;
      mime_type: string;
      original_name: string;
      size_bytes: number;
      created_at: string;
    }[];

    const items = rows
      .filter((r) => r.owner_id === me.id || !isBlockedBetween(me.id, r.owner_id))
      .map((r) => ({
        id: r.id,
        kind: r.kind as "image" | "video",
        mimeType: r.mime_type,
        originalName: r.original_name,
        sizeBytes: r.size_bytes,
        createdAt: r.created_at,
        url: `/api/media/${r.id}`,
        mine: r.owner_id === me.id,
      }));

    res.json({ items });
  });

  // Blocking system (backend-enforced)
  router.get("/blocks", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const rows = db
      .prepare(
        `SELECT u.*, b.created_at AS blocked_at
         FROM blocked_users b
         JOIN users u ON u.id = b.blocked_id
         WHERE b.blocker_id = ?
         ORDER BY b.created_at DESC`,
      )
      .all(me.id) as (DbUser & { blocked_at: string })[];

    res.json({
      blockedUsers: rows.map((u) => ({
        ...toPublicUser(u, false, me.id),
        blockedAt: u.blocked_at,
      })),
    });
  });

  router.post("/blocks", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const targetId = String((req.body as { targetUserId?: string })?.targetUserId ?? "").trim();
    if (!targetId || targetId === me.id) {
      res.status(400).json({ error: "Valid user required." });
      return;
    }
    const target = db.prepare("SELECT id FROM users WHERE id = ?").get(targetId);
    if (!target) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      "INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)",
    ).run(me.id, targetId, now);

    sendToUser(targetId, "block:updated", { byUserId: me.id, blocked: true });
    sendToUser(me.id, "block:updated", { targetUserId: targetId, blocked: true });

    res.status(201).json({ ok: true, blockedUserId: targetId });
  });

  router.delete("/blocks/:targetId", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const targetId = String(req.params["targetId"] ?? "").trim();
    db.prepare("DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?").run(
      me.id,
      targetId,
    );

    sendToUser(targetId, "block:updated", { byUserId: me.id, blocked: false });
    sendToUser(me.id, "block:updated", { targetUserId: targetId, blocked: false });

    res.json({ ok: true, unblockedUserId: targetId });
  });

  // Report user safety endpoint
  router.post("/reports", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const {
      reportedUserId,
      reason,
      details = "",
    } = req.body as {
      reportedUserId?: string;
      reason?: string;
      details?: string;
    };
    const targetId = String(reportedUserId ?? "").trim();
    if (!targetId || targetId === me.id) {
      res.status(400).json({ error: "Valid user to report is required." });
      return;
    }
    const target = db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").get(targetId);
    if (!target) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    const cleanReason = String(reason ?? "")
      .trim()
      .slice(0, 100);
    if (!cleanReason) {
      res.status(400).json({ error: "Please select a reason for this report." });
      return;
    }

    const reportId = `rep_${crypto.randomUUID()}`;
    db.prepare(
      "INSERT INTO user_reports (id, reporter_id, reported_user_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      reportId,
      me.id,
      targetId,
      cleanReason,
      String(details).trim().slice(0, 500),
      new Date().toISOString(),
    );

    res.status(201).json({ ok: true, reportId });
  });

  // Backend-enforced call initiation check
  router.post("/calls/initiate", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const { targetUserId, callType = "audio" } = req.body as {
      targetUserId?: string;
      callType?: "audio" | "video";
    };
    const targetId = String(targetUserId ?? "").trim();
    if (!targetId || targetId === me.id) {
      res.status(400).json({ error: "Valid recipient required." });
      return;
    }
    if (isBlockedBetween(me.id, targetId)) {
      res.status(403).json({ error: "Cannot initiate call. This user is blocked." });
      return;
    }
    const callId = `call_${crypto.randomUUID()}`;
    sendToUser(targetId, "call:incoming", {
      callId,
      callType: callType === "video" ? "video" : "audio",
      from: toPublicUser(me, true, targetId),
    });
    res.json({ ok: true, callId });
  });

  // Protected per-user reading progress, bookmarks, favorites & history sync
  router.get("/reading-state", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const row = db
      .prepare("SELECT state_json, updated_at FROM user_reading_state WHERE user_id = ? LIMIT 1")
      .get(me.id) as { state_json: string; updated_at: string } | undefined;

    if (!row) {
      res.json({ state: null, updatedAt: null });
      return;
    }

    try {
      const parsed = JSON.parse(row.state_json) as Record<string, unknown>;
      res.json({ state: parsed, updatedAt: row.updated_at });
    } catch {
      res.json({ state: null, updatedAt: null });
    }
  });

  router.put("/reading-state", requireAuth, (req: AuthedRequest, res) => {
    const me = req.authUser!;
    const body = req.body as { state?: Record<string, unknown> };
    if (
      !body ||
      typeof body.state !== "object" ||
      body.state === null ||
      Array.isArray(body.state)
    ) {
      res.status(400).json({ error: "Valid reading state object is required." });
      return;
    }

    const raw = body.state;
    const sanitized = {
      onboarded: Boolean(raw["onboarded"]),
      languages: Array.isArray(raw["languages"]) ? raw["languages"].slice(0, 20) : [],
      categories: Array.isArray(raw["categories"]) ? raw["categories"].slice(0, 30) : [],
      appTheme:
        raw["appTheme"] === "light" || raw["appTheme"] === "dark" || raw["appTheme"] === "system"
          ? raw["appTheme"]
          : "system",
      reader: typeof raw["reader"] === "object" && raw["reader"] !== null ? raw["reader"] : {},
      notifications:
        typeof raw["notifications"] === "object" && raw["notifications"] !== null
          ? raw["notifications"]
          : { reminders: true, newBooks: true },
      progress:
        typeof raw["progress"] === "object" && raw["progress"] !== null ? raw["progress"] : {},
      favorites: Array.isArray(raw["favorites"]) ? raw["favorites"].slice(0, 300) : [],
      bookmarks: Array.isArray(raw["bookmarks"]) ? raw["bookmarks"].slice(0, 500) : [],
      completed: Array.isArray(raw["completed"]) ? raw["completed"].slice(0, 300) : [],
      history: Array.isArray(raw["history"]) ? raw["history"].slice(0, 80) : [],
      streak: typeof raw["streak"] === "number" ? raw["streak"] : 1,
    };

    const now = new Date().toISOString();
    const serialized = JSON.stringify(sanitized);
    if (serialized.length > 512_000) {
      res.status(413).json({ error: "Reading state payload too large." });
      return;
    }

    db.prepare(
      `INSERT INTO user_reading_state (user_id, state_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
    ).run(me.id, serialized, now);

    res.json({ ok: true, updatedAt: now });
  });

  return router;
}
