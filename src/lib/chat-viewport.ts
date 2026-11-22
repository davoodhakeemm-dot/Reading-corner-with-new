export type ChatKeyboardLayout = {
  isKeyboardOpen: boolean;
  viewportHeightPx: number | null;
  viewportOffsetTopPx: number;
};

export function computeChatKeyboardLayout(input: {
  layoutHeight: number;
  visualHeight: number;
  visualOffsetTop: number;
  isMobile: boolean;
  isComposerFocused?: boolean;
}): ChatKeyboardLayout {
  const safeVisualHeight =
    Number.isFinite(input.visualHeight) && input.visualHeight > 120
      ? Math.round(input.visualHeight)
      : null;
  const safeOffsetTop =
    Number.isFinite(input.visualOffsetTop) && input.visualOffsetTop >= 0
      ? Math.round(input.visualOffsetTop)
      : 0;

  if (!input.isMobile || safeVisualHeight === null) {
    return {
      isKeyboardOpen: false,
      viewportHeightPx: null,
      viewportOffsetTopPx: 0,
    };
  }

  const heightDelta = input.layoutHeight - safeVisualHeight;
  const isKeyboardOpen = heightDelta > 110 || Boolean(input.isComposerFocused && heightDelta > 40);

  return {
    isKeyboardOpen,
    viewportHeightPx: safeVisualHeight,
    viewportOffsetTopPx: safeOffsetTop,
  };
}

export function isActiveElementTextInput(activeEl: Element | null | undefined): boolean {
  if (!activeEl) return false;
  const tag = activeEl.tagName?.toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = activeEl.getAttribute("type")?.toLowerCase() ?? "text";
    return (
      type === "text" ||
      type === "search" ||
      type === "email" ||
      type === "url" ||
      type === "tel" ||
      type === "password"
    );
  }
  return activeEl.getAttribute("contenteditable") === "true";
}
