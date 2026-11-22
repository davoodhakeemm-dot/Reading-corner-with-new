import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function resolveDataDir(): string {
  const envDir = process.env["DATA_DIR"]?.trim();
  if (envDir) {
    const abs = path.resolve(envDir);
    fs.mkdirSync(path.join(abs, "media"), { recursive: true });
    return abs;
  }

  const localDir = path.resolve(process.cwd(), ".data");
  if (process.env["VERCEL"] !== "1") {
    try {
      fs.mkdirSync(path.join(localDir, "media"), { recursive: true });
      return localDir;
    } catch {
      /* read-only filesystem fallback */
    }
  }

  const tmpDir = path.join(os.tmpdir(), "reading-corner-data");
  fs.mkdirSync(path.join(tmpDir, "media"), { recursive: true });
  return tmpDir;
}

const DATA_DIR = resolveDataDir();
const MEDIA_DIR = path.join(DATA_DIR, "media");
const DB_PATH = path.join(DATA_DIR, "reading-corner.sqlite");

export const mediaDir = MEDIA_DIR;
export const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// Non-destructive base schema initialization
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT,
    phone_e164 TEXT UNIQUE,
    phone_verified INTEGER NOT NULL DEFAULT 0,
    full_name TEXT NOT NULL,
    display_handle TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    avatar_media_id TEXT,
    password_hash TEXT NOT NULL,
    theme TEXT NOT NULL DEFAULT 'instagram',
    created_at TEXT NOT NULL,
    last_active_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS nfc_links (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_ciphertext TEXT,
    token_hash TEXT UNIQUE,
    revoked INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    user_agent TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS media_objects (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id TEXT,
    kind TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    is_public_avatar INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    thread_key TEXT NOT NULL,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL DEFAULT '',
    media_id TEXT REFERENCES media_objects(id) ON DELETE SET NULL,
    media_kind TEXT,
    media_name TEXT,
    reply_to_id TEXT,
    edited_at TEXT,
    deleted_at TEXT,
    delivered_at TEXT,
    created_at TEXT NOT NULL,
    seen_at TEXT
  );

  CREATE TABLE IF NOT EXISTS blocked_users (
    blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  );

  CREATE TABLE IF NOT EXISTS otp_challenges (
    id TEXT PRIMARY KEY,
    phone_e164 TEXT NOT NULL,
    purpose TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS user_reading_state (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS followers (
    follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (follower_id, following_id)
  );

  CREATE TABLE IF NOT EXISTS message_reactions (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS conversation_settings (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    peer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pinned INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, peer_id)
  );

  CREATE TABLE IF NOT EXISTS user_reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS firebase_media (
    id TEXT PRIMARY KEY,
    owner_uid TEXT NOT NULL,
    recipient_uid TEXT,
    kind TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS firebase_nfc_links (
    id TEXT PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    display_handle TEXT NOT NULL,
    token_ciphertext TEXT,
    token_hash TEXT UNIQUE,
    revoked INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// Non-destructive column migrations for pre-existing databases
function runSafeMigrations() {
  const userCols = db.prepare("PRAGMA table_info(users)").all() as {
    name: string;
    notnull: number;
  }[];
  const hasEmail = userCols.some((c) => c.name === "email");
  const phoneCol = userCols.find((c) => c.name === "phone_e164");

  // Upgrade existing `users` table if `email` is missing or `phone_e164` was NOT NULL
  if (!hasEmail || (phoneCol && phoneCol.notnull === 1)) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("BEGIN TRANSACTION;");
    try {
      db.exec(`
        CREATE TABLE users_migrated (
          id TEXT PRIMARY KEY,
          email TEXT,
          phone_e164 TEXT UNIQUE,
          phone_verified INTEGER NOT NULL DEFAULT 0,
          full_name TEXT NOT NULL,
          display_handle TEXT NOT NULL,
          bio TEXT NOT NULL DEFAULT '',
          avatar_media_id TEXT,
          password_hash TEXT NOT NULL,
          theme TEXT NOT NULL DEFAULT 'instagram',
          created_at TEXT NOT NULL,
          last_active_at TEXT NOT NULL
        );
      `);
      if (hasEmail) {
        db.exec(`
          INSERT INTO users_migrated (id, email, phone_e164, phone_verified, full_name, display_handle, bio, avatar_media_id, password_hash, theme, created_at, last_active_at)
          SELECT id, email, phone_e164, phone_verified, full_name, display_handle, bio, avatar_media_id, password_hash, theme, created_at, last_active_at FROM users;
        `);
      } else {
        db.exec(`
          INSERT INTO users_migrated (id, email, phone_e164, phone_verified, full_name, display_handle, bio, avatar_media_id, password_hash, theme, created_at, last_active_at)
          SELECT id, NULL, phone_e164, phone_verified, full_name, display_handle, bio, avatar_media_id, password_hash, theme, created_at, last_active_at FROM users;
        `);
      }
      db.exec("DROP TABLE users;");
      db.exec("ALTER TABLE users_migrated RENAME TO users;");
      db.exec("COMMIT;");
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }
  }

  // Deduplicate any pre-existing colliding display_handles before adding unique index
  const allUsers = db
    .prepare("SELECT id, display_handle FROM users ORDER BY created_at ASC")
    .all() as { id: string; display_handle: string }[];
  const seenHandles = new Set<string>();
  for (const u of allUsers) {
    let candidate = u.display_handle.trim();
    if (!candidate.startsWith("@")) candidate = `@${candidate}`;
    const lower = candidate.toLowerCase();
    if (seenHandles.has(lower)) {
      const uniqueSuffix = u.id.slice(-4).toLowerCase();
      candidate = `${lower}.${uniqueSuffix}`;
      db.prepare("UPDATE users SET display_handle = ? WHERE id = ?").run(candidate, u.id);
    } else if (candidate !== u.display_handle) {
      db.prepare("UPDATE users SET display_handle = ? WHERE id = ?").run(candidate, u.id);
    }
    seenHandles.add(candidate.toLowerCase());
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(LOWER(email)) WHERE email IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle_unique ON users(LOWER(display_handle));
  `);

  const userColSet = new Set(
    (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!userColSet.has("avatar_external_url")) {
    db.exec("ALTER TABLE users ADD COLUMN avatar_external_url TEXT;");
  }

  const msgCols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  const msgColSet = new Set(msgCols.map((c) => c.name));
  if (!msgColSet.has("reply_to_id")) {
    db.exec("ALTER TABLE messages ADD COLUMN reply_to_id TEXT;");
  }
  if (!msgColSet.has("edited_at")) {
    db.exec("ALTER TABLE messages ADD COLUMN edited_at TEXT;");
  }
  if (!msgColSet.has("deleted_at")) {
    db.exec("ALTER TABLE messages ADD COLUMN deleted_at TEXT;");
  }
  if (!msgColSet.has("delivered_at")) {
    db.exec("ALTER TABLE messages ADD COLUMN delivered_at TEXT;");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_key, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_recipient_seen ON messages(recipient_id, seen_at);
    CREATE INDEX IF NOT EXISTS idx_followers_following ON followers(following_id);
    CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
  `);
}

runSafeMigrations();

export type SecretTheme = "instagram" | "emerald" | "dark";

export type DbUser = {
  id: string;
  email: string | null;
  phone_e164: string | null;
  phone_verified: number;
  full_name: string;
  display_handle: string;
  bio: string;
  avatar_media_id: string | null;
  avatar_external_url?: string | null;
  password_hash: string;
  theme: SecretTheme;
  created_at: string;
  last_active_at: string;
};

export type PublicUser = {
  id: string;
  fullName: string;
  displayHandle: string;
  bio: string;
  avatarUrl: string | null;
  theme: SecretTheme;
  phoneVerified: boolean;
  lastActiveAt: string;
  online: boolean;
  followerCount?: number;
  followingCount?: number;
  isFollowing?: boolean;
  followsMe?: boolean;
};

const SECRET_FILE = path.join(DATA_DIR, ".session-secret");
function loadServerSecret(): string {
  const envSecret = process.env["SESSION_SECRET"]?.trim();
  if (envSecret && envSecret.length >= 16) return envSecret;
  if (fs.existsSync(SECRET_FILE)) {
    return fs.readFileSync(SECRET_FILE, "utf8").trim();
  }
  const generated = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
  return generated;
}

const SERVER_SECRET = loadServerSecret();
const NFC_KEY = crypto.createHash("sha256").update(`nfc::${SERVER_SECRET}`).digest();

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function signCookieToken(uid: string, ttlSeconds = 7 * 24 * 60 * 60): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ uid, exp }), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", SERVER_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyCookieToken(token: string): { uid: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [payload, sig] = parts;
    if (!payload || !sig) return null;
    const expectedSig = crypto
      .createHmac("sha256", SERVER_SECRET)
      .update(payload)
      .digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      uid?: string;
      exp?: number;
    };
    if (!parsed.uid || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return { uid: parsed.uid };
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = parts[1];
  const expectedHex = parts[2];
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", NFC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptToken(payload: string): string | null {
  try {
    const parts = payload.split(".");
    if (parts.length !== 3) return null;
    const [ivB64, tagB64, dataB64] = parts;
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      NFC_KEY,
      Buffer.from(ivB64, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

export function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) return null;
  return trimmed;
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

export function normalizePhoneE164(raw: string, defaultCountryCode = "+91"): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[\s\-().]/g, "");
  if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1).replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }
  if (cleaned.startsWith("00")) {
    const digits = cleaned.slice(2).replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }
  const digits = cleaned.replace(/\D/g, "");
  const strippedLeadingZero = digits.startsWith("0") ? digits.slice(1) : digits;
  const cc = defaultCountryCode.startsWith("+") ? defaultCountryCode : `+${defaultCountryCode}`;
  const full = `${cc}${strippedLeadingZero}`;
  const totalDigits = full.slice(1);
  if (totalDigits.length < 8 || totalDigits.length > 15) return null;
  return full;
}

export function threadKeyFor(userA: string, userB: string): string {
  return [userA, userB].sort().join("::");
}

export function isOnlineActive(lastActiveAt: string): boolean {
  const ts = Date.parse(lastActiveAt);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < 90_000;
}

export function getFollowStats(userId: string, viewerId?: string) {
  const followersRow = db
    .prepare("SELECT COUNT(*) AS cnt FROM followers WHERE following_id = ?")
    .get(userId) as { cnt: number };
  const followingRow = db
    .prepare("SELECT COUNT(*) AS cnt FROM followers WHERE follower_id = ?")
    .get(userId) as { cnt: number };

  let isFollowing = false;
  let followsMe = false;
  if (viewerId && viewerId !== userId) {
    isFollowing = Boolean(
      db
        .prepare("SELECT 1 FROM followers WHERE follower_id = ? AND following_id = ? LIMIT 1")
        .get(viewerId, userId),
    );
    followsMe = Boolean(
      db
        .prepare("SELECT 1 FROM followers WHERE follower_id = ? AND following_id = ? LIMIT 1")
        .get(userId, viewerId),
    );
  }

  return {
    followerCount: followersRow.cnt,
    followingCount: followingRow.cnt,
    isFollowing,
    followsMe,
  };
}

export function toPublicUser(u: DbUser, onlineOverride?: boolean, viewerId?: string): PublicUser {
  const stats = getFollowStats(u.id, viewerId);
  return {
    id: u.id,
    fullName: u.full_name,
    displayHandle: u.display_handle,
    bio: u.bio,
    avatarUrl: u.avatar_media_id
      ? `/api/media/${u.avatar_media_id}`
      : (u.avatar_external_url ?? null),
    theme: u.theme === "emerald" || u.theme === "dark" ? u.theme : "instagram",
    phoneVerified: u.phone_verified === 1,
    lastActiveAt: u.last_active_at,
    online: onlineOverride ?? isOnlineActive(u.last_active_at),
    ...stats,
  };
}

export function createNfcTokenForUser(userId: string): { token: string; version: number } {
  const token = `rc_${crypto.randomBytes(24).toString("base64url")}`;
  const tokenHash = sha256(token);
  const ciphertext = encryptToken(token);
  const now = new Date().toISOString();

  const existing = db.prepare("SELECT id, version FROM nfc_links WHERE user_id = ?").get(userId) as
    { id: string; version: number } | undefined;

  if (existing) {
    const nextVersion = existing.version + 1;
    db.prepare(
      "UPDATE nfc_links SET token_ciphertext = ?, token_hash = ?, revoked = 0, version = ?, updated_at = ? WHERE user_id = ?",
    ).run(ciphertext, tokenHash, nextVersion, now, userId);
    return { token, version: nextVersion };
  }

  db.prepare(
    "INSERT INTO nfc_links (id, user_id, token_ciphertext, token_hash, revoked, version, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, ?, ?)",
  ).run(`nfc_${crypto.randomUUID()}`, userId, ciphertext, tokenHash, now, now);
  return { token, version: 1 };
}

export function createFirebaseNfcToken(
  uid: string,
  fullName = "Reader",
  displayHandle = "",
): { token: string; version: number } {
  const token = `rc_${crypto.randomBytes(24).toString("base64url")}`;
  const tokenHash = sha256(token);
  const ciphertext = encryptToken(token);
  const now = new Date().toISOString();
  const safeName = fullName.trim().slice(0, 60) || "Reader";
  const safeHandle = displayHandle.trim().slice(0, 32) || `@reader.${uid.slice(-4).toLowerCase()}`;

  const existing = db
    .prepare("SELECT id, version FROM firebase_nfc_links WHERE uid = ?")
    .get(uid) as { id: string; version: number } | undefined;

  if (existing) {
    const nextVersion = existing.version + 1;
    db.prepare(
      "UPDATE firebase_nfc_links SET full_name = ?, display_handle = ?, token_ciphertext = ?, token_hash = ?, revoked = 0, version = ?, updated_at = ? WHERE uid = ?",
    ).run(safeName, safeHandle, ciphertext, tokenHash, nextVersion, now, uid);
    return { token, version: nextVersion };
  }

  db.prepare(
    "INSERT INTO firebase_nfc_links (id, uid, full_name, display_handle, token_ciphertext, token_hash, revoked, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)",
  ).run(`fbnfc_${crypto.randomUUID()}`, uid, safeName, safeHandle, ciphertext, tokenHash, now, now);
  return { token, version: 1 };
}

export function isBlockedBetween(userA: string, userB: string): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1",
    )
    .get(userA, userB, userB, userA);
  return Boolean(row);
}

export function didUserBlock(blockerId: string, blockedId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ? LIMIT 1")
    .get(blockerId, blockedId);
  return Boolean(row);
}
