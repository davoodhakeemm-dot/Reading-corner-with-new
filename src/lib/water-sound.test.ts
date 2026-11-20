import assert from "node:assert/strict";
import test from "node:test";

import {
  computeDropletParams,
  computeWaterRippleGeometry,
  isSoundAllowed,
  playWaterSound,
} from "./water-sound";

test("isSoundAllowed respects mute setting strictly", () => {
  assert.equal(isSoundAllowed(true), true);
  assert.equal(isSoundAllowed(false), false);
});

test("computeDropletParams returns ascending water pitch envelopes for all kinds", () => {
  for (const kind of ["droplet", "pop", "ripple"] as const) {
    const p = computeDropletParams(kind);
    assert.ok(p.endFreqHz > p.startFreqHz, `${kind} should sweep upward like a water droplet`);
    assert.ok(p.harmonicFreqHz > p.endFreqHz);
    assert.ok(p.durationSec > 0.08 && p.durationSec < 0.4);
    assert.ok(p.peakGain > 0 && p.peakGain <= 0.15);
  }
});

test("computeWaterRippleGeometry centers ripple at pointer or falls back to button center", () => {
  const fromPointer = computeWaterRippleGeometry(
    { left: 100, top: 200, width: 200, height: 50 },
    140,
    225,
  );
  assert.equal(fromPointer.x, 40);
  assert.equal(fromPointer.y, 25);
  assert.ok(fromPointer.diameter >= 320);

  const fallbackCenter = computeWaterRippleGeometry(
    { left: 100, top: 200, width: 200, height: 50 },
    0,
    0,
  );
  assert.equal(fallbackCenter.x, 100);
  assert.equal(fallbackCenter.y, 25);
  assert.ok(fallbackCenter.diameter >= 200);
});

test("playWaterSound is safe when called in non-browser or muted environments", () => {
  assert.doesNotThrow(() => playWaterSound("droplet", false));
  assert.doesNotThrow(() => playWaterSound("ripple", true));
});
