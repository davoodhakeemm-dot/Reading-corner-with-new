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
