import assert from "node:assert/strict";
import test from "node:test";

import { buildIceServers, formatCallError } from "./call-peer";

test("buildIceServers always includes default Google STUN servers", () => {
  const servers = buildIceServers({});
  assert.ok(servers.length >= 1);
  const firstUrls = Array.isArray(servers[0]?.urls) ? servers[0].urls : [servers[0]?.urls];
  assert.ok(firstUrls.some((u) => String(u).includes("stun:stun.l.google.com:19302")));
});

test("buildIceServers appends configured TURN servers and ignores malformed JSON", () => {
  const servers = buildIceServers({
    VITE_TURN_URLS: "turn:turn.example.com:3478, turns:turn.example.com:5349 ",
    VITE_TURN_USERNAME: "rc-user",
    VITE_TURN_CREDENTIAL: "rc-pass",
    VITE_ICE_SERVERS_JSON: "{bad-json",
  });
  const turn = servers.find((s) =>
    (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => String(u).startsWith("turn:")),
  );
  assert.ok(turn);
  assert.deepEqual(turn.urls, ["turn:turn.example.com:3478", "turns:turn.example.com:5349"]);
  assert.equal(turn.username, "rc-user");
  assert.equal(turn.credential, "rc-pass");
});

test("buildIceServers parses valid VITE_ICE_SERVERS_JSON entries", () => {
  const servers = buildIceServers({
    VITE_ICE_SERVERS_JSON: JSON.stringify([
      { urls: "turns:relay.example.org:443", username: "a", credential: "b" },
    ]),
  });
  assert.ok(servers.some((s) => s.urls === "turns:relay.example.org:443"));
});

test("formatCallError returns actionable user messages for media DOMExceptions", () => {
  const denied = Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
  assert.match(formatCallError(denied, "audio"), /Microphone permission was denied/i);
  assert.match(formatCallError(denied, "video"), /Microphone or camera permission was denied/i);

  const busy = Object.assign(new Error("Could not start video source"), {
    name: "NotReadableError",
  });
  assert.match(formatCallError(busy, "video"), /currently in use/i);

  const missing = Object.assign(new Error("Requested device not found"), { name: "NotFoundError" });
  assert.match(formatCallError(missing, "audio"), /No working microphone/i);
});
