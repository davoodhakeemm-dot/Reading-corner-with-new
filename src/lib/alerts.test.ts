import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIncomingCallAlertPayload,
  buildIncomingMessageAlertPayload,
  CALL_RING_VIBRATION_PATTERN,
  MESSAGE_VIBRATION_PATTERN,
  stopVibration,
  triggerVibration,
} from "./alerts";

test("buildIncomingCallAlertPayload builds clear video/audio call notification with ring vibration", () => {
  const video = buildIncomingCallAlertPayload({ senderName: "Aanya", callType: "video" });
  assert.equal(video.title, "Incoming video call from Aanya");
  assert.equal(video.body, "Tap Receive to answer now.");
  assert.deepEqual(video.vibratePattern, CALL_RING_VIBRATION_PATTERN);

  const audio = buildIncomingCallAlertPayload({ senderName: "  ", callType: "audio" });
  assert.equal(audio.title, "Incoming audio call from Someone");
});

test("buildIncomingMessageAlertPayload formats text and media previews cleanly with message vibration", () => {
  const msg = buildIncomingMessageAlertPayload({ senderName: "Zayd", text: "Hello there!" });
  assert.equal(msg.title, "Zayd");
  assert.equal(msg.body, "Hello there!");
  assert.deepEqual(msg.vibratePattern, MESSAGE_VIBRATION_PATTERN);

  const media = buildIncomingMessageAlertPayload({
    senderName: "Zayd",
    text: "",
    mediaKind: "audio",
  });
  assert.equal(media.body, "Sent a audio");
});

test("vibration helpers fail safely in non-browser environments", () => {
  assert.equal(triggerVibration(MESSAGE_VIBRATION_PATTERN), false);
  assert.doesNotThrow(() => stopVibration());
});
