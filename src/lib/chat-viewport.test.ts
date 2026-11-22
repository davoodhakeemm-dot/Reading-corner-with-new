import assert from "node:assert/strict";
import test from "node:test";

import { computeChatKeyboardLayout } from "./chat-viewport";

test("computeChatKeyboardLayout shrinks viewport cleanly when mobile keyboard opens", () => {
  const closed = computeChatKeyboardLayout({
    layoutHeight: 844,
    visualHeight: 844,
    visualOffsetTop: 0,
    isMobile: true,
    isComposerFocused: false,
  });
  assert.equal(closed.isKeyboardOpen, false);
  assert.equal(closed.viewportHeightPx, 844);
  assert.equal(closed.viewportOffsetTopPx, 0);

  const open = computeChatKeyboardLayout({
    layoutHeight: 844,
    visualHeight: 492,
    visualOffsetTop: 24,
    isMobile: true,
    isComposerFocused: true,
  });
  assert.equal(open.isKeyboardOpen, true);
  assert.equal(open.viewportHeightPx, 492);
  assert.equal(open.viewportOffsetTopPx, 24);
});

test("computeChatKeyboardLayout does not constrain desktop layout", () => {
  const desktop = computeChatKeyboardLayout({
    layoutHeight: 900,
    visualHeight: 700,
    visualOffsetTop: 0,
    isMobile: false,
    isComposerFocused: true,
  });
  assert.equal(desktop.isKeyboardOpen, false);
  assert.equal(desktop.viewportHeightPx, null);
  assert.equal(desktop.viewportOffsetTopPx, 0);
});
