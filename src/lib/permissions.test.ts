import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_PERMISSION_ITEMS,
  countGrantedPermissions,
  detectDevicePlatform,
  getMobilePermissionSettingsGuide,
  normalizePermissionState,
  shouldShowStartupPermissions,
  type PermissionSnapshot,
} from "./permissions";

test("APP_PERMISSION_ITEMS prioritizes Microphone first, followed by Camera and Notifications", () => {
  assert.deepEqual(
    APP_PERMISSION_ITEMS.map((item) => item.kind),
    ["microphone", "camera", "notifications"],
  );
});

test("normalizePermissionState maps browser permission values reliably", () => {
  assert.equal(normalizePermissionState("granted"), "granted");
  assert.equal(normalizePermissionState("denied"), "denied");
  assert.equal(normalizePermissionState("prompt"), "prompt");
  assert.equal(normalizePermissionState("default"), "prompt");
  assert.equal(normalizePermissionState(undefined), "unsupported");
  assert.equal(normalizePermissionState("unknown"), "unsupported");
});

test("shouldShowStartupPermissions shows prompt only on first visit when permissions still need asking", () => {
  const needsAsk: PermissionSnapshot = {
    microphone: "prompt",
    camera: "prompt",
    notifications: "prompt",
  };
  assert.equal(shouldShowStartupPermissions(needsAsk, false), true);
  assert.equal(shouldShowStartupPermissions(needsAsk, true), false);

  const partialGranted: PermissionSnapshot = {
    microphone: "granted",
    camera: "granted",
    notifications: "prompt",
  };
  assert.equal(shouldShowStartupPermissions(partialGranted, false), true);

  const allHandled: PermissionSnapshot = {
    microphone: "granted",
    camera: "denied",
    notifications: "unsupported",
  };
  assert.equal(shouldShowStartupPermissions(allHandled, false), false);
});

test("countGrantedPermissions counts only granted permissions", () => {
  assert.equal(
    countGrantedPermissions({
      microphone: "granted",
      camera: "prompt",
      notifications: "granted",
    }),
    2,
  );
  assert.equal(
    countGrantedPermissions({
      microphone: "denied",
      camera: "unsupported",
      notifications: "prompt",
    }),
    0,
  );
});

test("detectDevicePlatform and getMobilePermissionSettingsGuide identify Android, iOS, and Desktop", () => {
  assert.equal(
    detectDevicePlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36"),
    "android",
  );
  assert.equal(
    detectDevicePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"),
    "ios",
  );
  assert.equal(detectDevicePlatform("Mozilla/5.0 (X11; Linux x86_64) Chrome/128.0"), "desktop");

  const androidGuide = getMobilePermissionSettingsGuide("android");
  assert.match(androidGuide.title, /Android/i);
  assert.ok(androidGuide.steps.length >= 2);
});
