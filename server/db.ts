import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const uploadDir = path.join(os.tmpdir(), "reading-corner-uploads");
fs.mkdirSync(uploadDir, { recursive: true });
export const mediaDir = uploadDir;

const MEDIA_BUCKET = "reading-corner-media";

let supabase: SupabaseClient | undefined;
function getSupabase(): SupabaseClient {
  if (supabase) return supabase;
  const url = process.env["SUPABASE_URL"] ?? process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["SUPABASE_SECRET_KEY"];
  if (!url || !serviceKey) {
    throw new Error("Supabase server credentials are required for persistent application storage.");
  }
  supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return supabase;
}

export async function uploadMediaStorage(
  key: string,
  file: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await getSupabase().storage.from(MEDIA_BUCKET).upload(key, file, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Media upload failed: ${error.message}`);
}

export async function downloadMediaStorage(key: string): Promise<Buffer | null> {
  const { data, error } = await getSupabase().storage.from(MEDIA_BUCKET).download(key);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function deleteMediaStorage(key: string): Promise<void> {
  const { error } = await getSupabase().storage.from(MEDIA_BUCKET).remove([key]);
  if (error) throw new Error(`Media removal failed: ${error.message}`);
}

async function execute<T>(
  statement: string,
  parameters: unknown[],
  operation: "all" | "one" | "run",
): Promise<T> {
  const { data, error } = await getSupabase().rpc("app_execute_sql", {
    statement,
    parameters,
    operation,
  });
  if (error) {
    throw new Error(`Persistent database request failed: ${error.message}`);
  }
  return data as T;
}

type RunResult = { changes: number };
export const db = {
  prepare(statement: string) {
    return {
      all: (...parameters: unknown[]) => execute<unknown[]>(statement, parameters, "all"),
      get: (...parameters: unknown[]) => execute<unknown | undefined>(statement, parameters, "one"),
      run: (...parameters: unknown[]) => execute<RunResult>(statement, parameters, "run"),
    };
  },
};

export const MAX_ACCOUNTS_PER_CONTACT = 3;

export function getAdminEmailSet(): Set<string> {
  return new Set(
    (process.env["ADMIN_EMAILS"] ?? "mohammadakeem22@gmail.com")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export type SecretTheme = "instagram" | "emerald" | "dark";
export type DbUser = {
  id: string;
  email: string | null;
  email_verified: number;
  phone_e164: string | null;
  phone_verified: number;
  role: string;
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

function loadServerSecret(): string {
  const secret =
    process.env["SESSION_SECRET"]?.trim() || process.env["SUPABASE_JWT_SECRET"]?.trim();
  if (secret && secret.length >= 16) return secret;
  if (process.env["VERCEL"] === "1") {
    throw new Error("Set a stable SESSION_SECRET for production session signing.");
  }
  return "local-development-only-reading-corner-secret";
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
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const expected = crypto.createHmac("sha256", SERVER_SECRET).update(payload).digest("base64url");
    const actualBuffer = Buffer.from(sig);
    const expectedBuffer = Buffer.from(expected);
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    )
      return null;
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
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, salt, expectedHex] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", NFC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptToken(payload: string): string | null {
  try {
    const [iv, tag, encrypted] = payload.split(".");
    if (!iv || !tag || !encrypted) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", NFC_KEY, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export function normalizeEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return value && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? value : null;
}
export function normalizeHandle(raw: string): string | null {
  const value = raw
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 28)
    .toLowerCase();
  return value.length >= 2 ? `@${value}` : null;
}
export function normalizePhoneE164(raw: string, defaultCountryCode = "+91"): string | null {
  const cleaned = raw.trim().replace(/[\s\-().]/g, "");
  if (!cleaned) return null;
  const international = cleaned.startsWith("+")
    ? cleaned.slice(1)
    : cleaned.startsWith("00")
      ? cleaned.slice(2)
      : "";
  const digits = international
    ? international.replace(/\D/g, "")
    : `${defaultCountryCode.startsWith("+") ? defaultCountryCode : `+${defaultCountryCode}`}${cleaned.replace(/\D/g, "").replace(/^0/, "")}`.slice(
        1,
      );
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}
export function threadKeyFor(userA: string, userB: string): string {
  return [userA, userB].sort().join("::");
}
export function isOnlineActive(lastActiveAt: string): boolean {
  const timestamp = Date.parse(lastActiveAt);
  return !Number.isNaN(timestamp) && Date.now() - timestamp < 90_000;
}

export async function getFollowStats(userId: string, viewerId?: string) {
  const [followersRow, followingRow] = await Promise.all([
    (await db
      .prepare("SELECT COUNT(*) AS cnt FROM followers WHERE following_id = ?")
      .get(userId)) as Promise<{ cnt: number }>,
    (await db
      .prepare("SELECT COUNT(*) AS cnt FROM followers WHERE follower_id = ?")
      .get(userId)) as Promise<{ cnt: number }>,
  ]);
  let isFollowing = false;
  let followsMe = false;
  if (viewerId && viewerId !== userId) {
    [isFollowing, followsMe] = await Promise.all([
      await db
        .prepare("SELECT 1 FROM followers WHERE follower_id = ? AND following_id = ? LIMIT 1")
        .get(viewerId, userId)
        .then(Boolean),
      await db
        .prepare("SELECT 1 FROM followers WHERE follower_id = ? AND following_id = ? LIMIT 1")
        .get(userId, viewerId)
        .then(Boolean),
    ]);
  }
  return {
    followerCount: Number(followersRow.cnt),
    followingCount: Number(followingRow.cnt),
    isFollowing,
    followsMe,
  };
}

export async function toPublicUser(
  u: DbUser,
  onlineOverride?: boolean,
  viewerId?: string,
): Promise<PublicUser> {
  const stats = await getFollowStats(u.id, viewerId);
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

export async function createNfcTokenForUser(
  userId: string,
): Promise<{ token: string; version: number }> {
  const token = `rc_${crypto.randomBytes(24).toString("base64url")}`;
  const tokenHash = sha256(token);
  const ciphertext = encryptToken(token);
  const now = new Date().toISOString();
  const existing = (await await db
    .prepare("SELECT id, version FROM nfc_links WHERE user_id = ?")
    .get(userId)) as { id: string; version: number } | undefined;
  if (existing) {
    const version = existing.version + 1;
    await await db
      .prepare(
        "UPDATE nfc_links SET token_ciphertext = ?, token_hash = ?, revoked = 0, version = ?, updated_at = ? WHERE user_id = ?",
      )
      .run(ciphertext, tokenHash, version, now, userId);
    return { token, version };
  }
  await await db
    .prepare(
      "INSERT INTO nfc_links (id, user_id, token_ciphertext, token_hash, revoked, version, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, ?, ?)",
    )
    .run(`nfc_${crypto.randomUUID()}`, userId, ciphertext, tokenHash, now, now);
  return { token, version: 1 };
}

export async function createFirebaseNfcToken(
  uid: string,
  fullName = "Reader",
  displayHandle = "",
): Promise<{ token: string; version: number }> {
  const token = `rc_${crypto.randomBytes(24).toString("base64url")}`;
  const tokenHash = sha256(token);
  const ciphertext = encryptToken(token);
  const now = new Date().toISOString();
  const safeName = fullName.trim().slice(0, 60) || "Reader";
  const safeHandle = displayHandle.trim().slice(0, 32) || `@reader.${uid.slice(-4).toLowerCase()}`;
  const existing = (await await db
    .prepare("SELECT id, version FROM firebase_nfc_links WHERE uid = ?")
    .get(uid)) as { id: string; version: number } | undefined;
  if (existing) {
    const version = existing.version + 1;
    await await db
      .prepare(
        "UPDATE firebase_nfc_links SET full_name = ?, display_handle = ?, token_ciphertext = ?, token_hash = ?, revoked = 0, version = ?, updated_at = ? WHERE uid = ?",
      )
      .run(safeName, safeHandle, ciphertext, tokenHash, version, now, uid);
    return { token, version };
  }
  await await db
    .prepare(
      "INSERT INTO firebase_nfc_links (id, uid, full_name, display_handle, token_ciphertext, token_hash, revoked, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)",
    )
    .run(
      `fbnfc_${crypto.randomUUID()}`,
      uid,
      safeName,
      safeHandle,
      ciphertext,
      tokenHash,
      now,
      now,
    );
  return { token, version: 1 };
}

export async function isBlockedBetween(userA: string, userB: string): Promise<boolean> {
  return Boolean(
    await await db
      .prepare(
        "SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1",
      )
      .get(userA, userB, userB, userA),
  );
}
export async function didUserBlock(blockerId: string, blockedId: string): Promise<boolean> {
  return Boolean(
    await await db
      .prepare("SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ? LIMIT 1")
      .get(blockerId, blockedId),
  );
}
export function isAdminUser(user: DbUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  return Boolean(
    user.email && user.email_verified === 1 && getAdminEmailSet().has(user.email.toLowerCase()),
  );
}
export async function countAccountsByEmail(email: string): Promise<number> {
  const row = (await await db
    .prepare("SELECT COUNT(*) AS cnt FROM users WHERE LOWER(email) = LOWER(?)")
    .get(email)) as { cnt: number };
  return Number(row.cnt);
}
export async function countAccountsByPhone(phoneE164: string): Promise<number> {
  const row = (await await db
    .prepare("SELECT COUNT(*) AS cnt FROM users WHERE phone_e164 = ?")
    .get(phoneE164)) as { cnt: number };
  return Number(row.cnt);
}
export async function getLinkedSiblingAccounts(user: DbUser): Promise<DbUser[]> {
  const clauses = ["id = ?"];
  const params: unknown[] = [user.id];
  if (user.email && user.email_verified === 1) {
    clauses.push("(LOWER(email) = LOWER(?) AND email_verified = 1)");
    params.push(user.email);
  }
  if (user.phone_e164 && user.phone_verified === 1) {
    clauses.push("(phone_e164 = ? AND phone_verified = 1)");
    params.push(user.phone_e164);
  }
  return (await await db
    .prepare(`SELECT * FROM users WHERE ${clauses.join(" OR ")} ORDER BY created_at ASC`)
    .all(...params)) as DbUser[];
}

export async function checkRateLimit(
  rateKey: string,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const row = (await await db
    .prepare(
      "SELECT failures, first_failure_at, locked_until FROM auth_rate_limits WHERE rate_key = ? LIMIT 1",
    )
    .get(rateKey)) as
    { failures: number; first_failure_at: string; locked_until: string | null } | undefined;
  if (!row?.locked_until) return { allowed: true, retryAfterSeconds: 0 };
  const lockMs = Date.parse(row.locked_until);
  if (Number.isNaN(lockMs) || lockMs <= Date.now()) return { allowed: true, retryAfterSeconds: 0 };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((lockMs - Date.now()) / 1000)),
  };
}
export async function recordRateLimitFailure(
  rateKey: string,
  maxFailures = 5,
  windowMs = 15 * 60 * 1000,
  lockMs = 15 * 60 * 1000,
): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const row = (await await db
    .prepare("SELECT failures, first_failure_at FROM auth_rate_limits WHERE rate_key = ? LIMIT 1")
    .get(rateKey)) as { failures: number; first_failure_at: string } | undefined;
  const firstMs = row ? Date.parse(row.first_failure_at) : 0;
  const expiredWindow = !row || Number.isNaN(firstMs) || now - firstMs > windowMs;
  const failures = expiredWindow ? 1 : row.failures + 1;
  const locked = failures >= maxFailures;
  const lockedUntil = locked ? new Date(now + lockMs).toISOString() : null;
  await await db
    .prepare(
      "INSERT INTO auth_rate_limits (rate_key, failures, first_failure_at, locked_until) VALUES (?, ?, ?, ?) ON CONFLICT(rate_key) DO UPDATE SET failures = excluded.failures, first_failure_at = excluded.first_failure_at, locked_until = excluded.locked_until",
    )
    .run(rateKey, failures, expiredWindow ? nowIso : row.first_failure_at, lockedUntil);
  return { locked, retryAfterSeconds: locked ? Math.ceil(lockMs / 1000) : 0 };
}
export async function clearRateLimit(rateKey: string): Promise<void> {
  await await db.prepare("DELETE FROM auth_rate_limits WHERE rate_key = ?").run(rateKey);
}
