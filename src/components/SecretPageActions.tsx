import { useNavigate } from "@tanstack/react-router";
import { BookOpen, Check, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { WaterGlowButton } from "@/components/WaterGlowButton";
import { fetchNfcLink, useChat } from "@/lib/chat-store";
import { resolveWaterButtonVariant, type SecretThemeTokens } from "@/lib/secret-themes";
import { cn } from "@/lib/utils";

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall back to execCommand below */
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

export function GoToReadingButton({
  size = "md",
  compact = false,
  className,
}: {
  size?: "sm" | "md" | "lg";
  compact?: boolean;
  className?: string;
}) {
  const navigate = useNavigate();
  const { soundEnabled } = useChat();

  return (
    <WaterGlowButton
      type="button"
      variant="liquidViolet"
      size={size}
      sound="droplet"
      soundEnabled={soundEnabled}
      onClick={() => navigate({ to: "/home" })}
      aria-label="Go to Reading"
      className={cn(compact && "min-h-[36px] px-3 text-[11px]", className)}
    >
      <BookOpen className={cn(size === "sm" || compact ? "size-3.5" : "size-4", "shrink-0")} />
      <span className={cn(compact ? "hidden sm:inline" : "inline")}>Go to Reading</span>
    </WaterGlowButton>
  );
}

export function CopyPersonalLinkButton({
  theme,
  size = "sm",
  label = "Copy Link",
  className,
}: {
  theme: SecretThemeTokens;
  size?: "sm" | "md";
  label?: string;
  className?: string;
}) {
  const { nfc, soundEnabled } = useChat();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function handleCopy() {
    if (busy) return;
    setBusy(true);
    try {
      const current = nfc?.path || nfc?.revoked ? nfc : await fetchNfcLink();
      if (!current) {
        toast.error("Could not load your personal link yet.");
        return;
      }
      if (current.revoked || !current.path) {
        toast.error("Personal link is revoked. Regenerate it in Profile → NFC Card.");
        return;
      }
      const fullUrl =
        typeof window !== "undefined" ? `${window.location.origin}${current.path}` : current.path;
      const ok = await copyTextToClipboard(fullUrl);
      if (ok) {
        setCopied(true);
        toast.success("Personal link copied");
      } else {
        toast.error("Could not copy link automatically. Open Profile → NFC Card to copy.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not copy personal link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <WaterGlowButton
      type="button"
      variant={resolveWaterButtonVariant(theme.id, "surface")}
      size={size}
      sound="pop"
      soundEnabled={soundEnabled}
      disabled={busy}
      onClick={() => void handleCopy()}
      aria-label="Copy Personal Link"
      className={className}
    >
      {copied ? (
        <>
          <Check className="size-3.5 shrink-0 text-emerald-500" />
          <span>Copied</span>
        </>
      ) : (
        <>
          <Link2 className="size-3.5 shrink-0" />
          <span>{busy ? "Loading…" : label}</span>
        </>
      )}
    </WaterGlowButton>
  );
}
