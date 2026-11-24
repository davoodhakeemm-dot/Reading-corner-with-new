import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-db-test-"));
process.env["DATA_DIR"] = testDataDir;

const dbMod = await import("./db");

test.after(() => {
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

test("normalizePhoneE164 normalizes local and international numbers", () => {
  assert.equal(dbMod.normalizePhoneE164("98765 43210", "+91"), "+919876543210");
  assert.equal(dbMod.normalizePhoneE164("+1 (415) 555-2671"), "+14155552671");
  assert.equal(dbMod.normalizePhoneE164("123"), null);
});

test("normalizeEmail and normalizeHandle sanitize user inputs safely", () => {
  assert.equal(dbMod.normalizeEmail("  Alice.Reader@Example.COM "), "alice.reader@example.com");
  assert.equal(dbMod.normalizeEmail("not-an-email"), null);
  assert.equal(dbMod.normalizeHandle("Alice_99!"), "@alice_99");
  assert.equal(dbMod.normalizeHandle("@@bob.dev"), "@bob.dev");
  assert.equal(dbMod.normalizeHandle("ab"), "@ab");
  assert.equal(dbMod.normalizeHandle("a"), null);
});

test("hashPassword and verifyPassword validate matching passwords only", () => {
  const hash = dbMod.hashPassword("SecretPass123!");
  assert.notEqual(hash, "SecretPass123!");
  assert.equal(dbMod.verifyPassword("SecretPass123!", hash), true);
  assert.equal(dbMod.verifyPassword("WrongPass123!", hash), false);
});

test("encryptToken and decryptToken round-trip NFC tokens", () => {
  const token = "rc_sample_nfc_token_value";
  const cipher = dbMod.encryptToken(token);
  assert.notEqual(cipher, token);
  assert.equal(dbMod.decryptToken(cipher), token);
  assert.equal(dbMod.decryptToken("corrupted.payload"), null);
});

test("threadKeyFor produces deterministic order-independent keys", () => {
  assert.equal(dbMod.threadKeyFor("user_b", "user_a"), dbMod.threadKeyFor("user_a", "user_b"));
});

test("legacy SQLite DB with stale media_objects.storage_path migrates cleanly", async () => {
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-legacy-db-"));
  const prevDataDir = process.env["DATA_DIR"];
  try {
    const Database = (await import("better-sqlite3")).default;
    const legacyDb = new Database(path.join(legacyDir, "reading_corner_local.db"));
    legacyDb.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT,
        email_verified INTEGER NOT NULL DEFAULT 0,
        phone_e164 TEXT,
        phone_verified INTEGER NOT NULL DEFAULT 0,
        role TEXT NOT NULL DEFAULT 'user',
        full_name TEXT NOT NULL,
        display_handle TEXT NOT NULL,
        bio TEXT NOT NULL DEFAULT '',
        avatar_media_id TEXT,
        avatar_external_url TEXT,
        password_hash TEXT NOT NULL,
        theme TEXT NOT NULL DEFAULT 'instagram',
        created_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL
      );
      CREATE TABLE media_objects (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        recipient_id TEXT,
        kind TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        original_name TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      INSERT INTO users (id, full_name, display_handle, password_hash, created_at, last_active_at)
      VALUES ('u_legacy', 'Legacy', '@legacy', 'scrypt$a$b', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
      INSERT INTO media_objects (id, owner_id, recipient_id, kind, mime_type, storage_path, original_name, size_bytes, created_at)
      VALUES ('med_old', 'u_legacy', NULL, 'image', 'image/png', 'avatars/u_legacy/old.png', 'old.png', 10, '2026-01-01T00:00:00Z');
    `);
    legacyDb.close();

    process.env["DATA_DIR"] = legacyDir;
    await dbMod.db
      .prepare(
        "INSERT INTO media_objects (id, owner_id, recipient_id, kind, mime_type, original_name, file_path, size_bytes, is_public_avatar, created_at) VALUES (?, ?, NULL, 'image', ?, ?, ?, ?, 1, ?)",
      )
      .run(
        "med_new",
        "u_legacy",
        "image/png",
        "new.png",
        "avatars/u_legacy/new.png",
        12,
        "2026-01-02T00:00:00Z",
      );

    const oldRow = (await dbMod.db
      .prepare("SELECT file_path FROM media_objects WHERE id = ?")
      .get("med_old")) as { file_path: string } | undefined;
    assert.equal(oldRow?.file_path, "avatars/u_legacy/old.png");
  } finally {
    process.env["DATA_DIR"] = prevDataDir;
    fs.rmSync(legacyDir, { recursive: true, force: true });
  }
});

test("readConfiguredEnv ignores runtime placeholder sentinels while preserving explicit values", () => {
  const sentinelEnv: NodeJS.ProcessEnv = {
    ADMIN_EMAILS: "UNSET6",
    RESEND_API_KEY: "UNSET6",
    TWILIO_ACCOUNT_SID: "UNSET6",
    CONTROL_REMOVE_CODE: "UNSET6",
    ACCOUNT_DELETE_KEY: "UNSET6",
  };
  assert.equal(dbMod.readConfiguredEnv("CONTROL_REMOVE_CODE", sentinelEnv), undefined);
  assert.equal(dbMod.readConfiguredEnv("ACCOUNT_DELETE_KEY", sentinelEnv), undefined);
  assert.equal(dbMod.readConfiguredEnv("ADMIN_EMAILS", sentinelEnv), undefined);

  const customEnv: NodeJS.ProcessEnv = {
    ...sentinelEnv,
    CONTROL_REMOVE_CODE: "9482",
    ACCOUNT_DELETE_KEY: "MY_CUSTOM_PLACEHOLDER",
  };
  assert.equal(dbMod.readConfiguredEnv("CONTROL_REMOVE_CODE", customEnv), "9482");
  assert.equal(dbMod.readConfiguredEnv("ACCOUNT_DELETE_KEY", customEnv), undefined);
});
