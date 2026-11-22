import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIncomingCallAlertPayload,
  buildIncomingMessageAlertPayload,
  CALL_RING_VIBRATION_PATTERN,
  isVibrationEnabled,
  MESSAGE_VIBRATION_PATTERN,
  setVibrationEnabled,
  stopVibration,
  triggerVibration,
} from "./alerts";

test("buildIncomingCallAlertPayload builds clear video/audio call notification with ring vibration", () => {
  const video = buildIncomingCallAlertPayload({ senderName: "Aanya", callType: "video" });
  assert.equal(video.title, "Reading Corner");
  assert.equal(video.body, "Incoming video call from Aanya. Open the app to receive or decline.");
  assert.deepEqual(video.vibratePattern, CALL_RING_VIBRATION_PATTERN);

  const audio = buildIncomingCallAlertPayload({ senderName: "  ", callType: "audio" });
  assert.equal(audio.title, "Reading Corner");
  assert.match(audio.body, /Incoming audio call from Someone/);
});

test("buildIncomingMessageAlertPayload formats text and media previews cleanly with message vibration", () => {
  const msg = buildIncomingMessageAlertPayload({ senderName: "Zayd", text: "Hello there!" });
  assert.equal(msg.title, "Reading Corner");
  assert.equal(msg.body, "New message from Zayd: Hello there!");
  assert.deepEqual(msg.vibratePattern, MESSAGE_VIBRATION_PATTERN);

  const media = buildIncomingMessageAlertPayload({
    senderName: "Zayd",
    text: "",
    mediaKind: "audio",
  });
  assert.equal(media.body, "New message from Zayd: Sent a audio");
});

test("vibration helpers fail safely in non-browser environments", () => {
  assert.equal(isVibrationEnabled(), true);
  assert.doesNotThrow(() => setVibrationEnabled(false));
  assert.equal(triggerVibration(MESSAGE_VIBRATION_PATTERN), false);
  assert.doesNotThrow(() => stopVibration());
});
