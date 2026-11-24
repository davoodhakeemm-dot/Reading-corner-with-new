import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  Nfc,
  QrCode,
  RefreshCw,
  Share2,
  ShieldAlert,
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { fetchNfcLink, regenerateNfcLink, revokeNfcLink, useChat } from "@/lib/chat-store";
import type { SecretThemeTokens } from "@/lib/secret-themes";
import { cn } from "@/lib/utils";

async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fallback below */
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.top = "-9999px";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

export function PersonalLinkCard({
  variant = "surface",
  theme,
  className,
}: {
  variant?: "surface" | "glass";
  theme?: SecretThemeTokens;
  className?: string;
}) {
  const { me, nfc } = useChat();
  const [revealUrl, setRevealUrl] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nfcBusy, setNfcBusy] = useState(false);
  const [writingNfc, setWritingNfc] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    if (!nfc) {
      void fetchNfcLink().catch(() => {});
    }
  }, [me?.id, nfc]);

  const personalUrl =
    typeof window !== "undefined" && nfc?.path && !nfc.revoked
      ? `${window.location.origin}${nfc.path}`
      : null;

  useEffect(() => {
    if (!personalUrl) {
      setQrDataUrl(null);
      return;
    }
    let active = true;
    QRCode.toDataURL(personalUrl, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl(null);
      });
    return () => {
      active = false;
    };
  }, [personalUrl]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(t);
  }, [copied]);

  if (!me) return null;

  const isGlass = variant === "glass" && Boolean(theme);

  async function handleCopyLink() {
    if (!personalUrl) return;
    const ok = await copyText(personalUrl);
    if (ok) {
      setCopied(true);
      toast.success("Personal link copied to clipboard");
    } else {
      toast.error("Could not copy automatically. Reveal the URL to copy manually.");
    }
  }

  async function handleShareLink() {
    if (!personalUrl) return;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: `${me?.fullName ?? "Reading Corner"} — Personal Link`,
          text: "Open my permanent Reading Corner link",
          url: personalUrl,
        });
        return;
      } catch {
        /* fallback to clipboard */
      }
    }
    await handleCopyLink();
  }

  function handleDownloadQr() {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `${(me?.displayHandle ?? "reading-corner").replace(/^@/, "")}-qr.png`;
    a.click();
  }

  async function handleWriteNfcTag() {
    if (!personalUrl) return;
    const w = window as unknown as {
      NDEFReader?: new () => {
        write: (msg: { records: { recordType: string; data: string }[] }) => Promise<void>;
      };
    };
    if (!w.NDEFReader) {
      toast("Web NFC not available in this browser", {
        description:
          "Copy your personal link above and write it using NFC Tools on Android or iPhone.",
      });
      return;
    }
    setWritingNfc(true);
    try {
      const ndef = new w.NDEFReader();
      await ndef.write({ records: [{ recordType: "url", data: personalUrl }] });
      toast.success("NFC card written successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "NFC write canceled or unsupported.");
    } finally {
      setWritingNfc(false);
    }
  }

  async function handleRegenerate() {
    setNfcBusy(true);
    try {
      await regenerateNfcLink();
      toast.success("New personal link & QR generated. Previous link invalidated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to regenerate link.");
    } finally {
      setNfcBusy(false);
    }
  }

  async function handleRevoke() {
    setNfcBusy(true);
    try {
      await revokeNfcLink();
      toast.success("Personal link revoked. Old link can no longer unlock your account.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke link.");
    } finally {
      setNfcBusy(false);
    }
  }

  return (
    <section
      data-testid="personal-link-card"
      className={cn(
        "space-y-4 rounded-3xl p-5 sm:p-6",
        isGlass
          ? cn("border backdrop-blur-xl", theme!.surfaceGlass, theme!.border, theme!.cardShadow)
          : "bg-card shadow-soft",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold sm:text-lg">
            Personal Link &amp; QR Code
          </h2>
          <p
            className={cn(
              "mt-0.5 text-xs leading-relaxed",
              isGlass ? theme!.mutedText : "text-muted-foreground",
            )}
          >
            Permanent login &amp; NFC link tied to your account across sessions and devices.
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold",
            nfc?.revoked ? "bg-rose-500/15 text-rose-600" : "bg-emerald-500/15 text-emerald-600",
          )}
        >
          {nfc?.revoked ? "Revoked" : `Active · v${nfc?.version ?? 1}`}
        </span>
      </div>

      {personalUrl && !nfc?.revoked ? (
        <div
          className={cn(
            "space-y-4 rounded-2xl p-4",
            isGlass ? cn("border", theme!.border, theme!.surfaceMuted) : "bg-secondary/60",
          )}
        >
          {/* QR + URL Row */}
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="flex flex-col items-center gap-2 shrink-0">
              <div className="grid size-36 place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`QR code for ${me.displayHandle} personal link`}
                    data-testid="personal-link-qr"
                    className="size-full object-contain"
                  />
                ) : (
                  <QrCode className="size-10 text-slate-400 animate-pulse" />
                )}
              </div>
              {qrDataUrl && (
                <button
                  type="button"
                  onClick={handleDownloadQr}
                  className={cn(
                    "inline-flex items-center gap-1 text-[11px] font-bold hover:underline",
                    isGlass ? theme!.accentText : "text-primary",
                  )}
                >
                  <Download className="size-3" /> Save QR
                </button>
              )}
            </div>

            <div className="w-full min-w-0 flex-1 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold">My Personal URL</span>
                <button
                  type="button"
                  onClick={() => setRevealUrl((r) => !r)}
                  className={cn(
                    "inline-flex items-center gap-1 text-xs font-semibold hover:underline",
                    isGlass ? theme!.accentText : "text-primary",
                  )}
                >
                  {revealUrl ? (
                    <>
                      <EyeOff className="size-3.5" /> Hide URL
                    </>
                  ) : (
                    <>
                      <Eye className="size-3.5" /> Reveal URL
                    </>
                  )}
                </button>
              </div>

              <p
                data-testid="personal-link-url"
                className={cn(
                  "break-all rounded-xl px-3 py-2.5 font-mono text-xs",
                  isGlass ? "bg-black/10" : "bg-background border border-border/60",
                )}
              >
                {revealUrl ? personalUrl : `${window.location.origin}/nfc/••••••••••••••••••••`}
              </p>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => void handleCopyLink()}
                  className={cn(
                    "press inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-bold",
                    isGlass
                      ? cn("border", theme!.surface, theme!.border)
                      : "bg-card border border-border text-foreground",
                  )}
                >
                  {copied ? (
                    <>
                      <Check className="size-4 text-emerald-500" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-4" /> Copy Link
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void handleShareLink()}
                  className={cn(
                    "press inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-bold",
                    isGlass
                      ? cn("border", theme!.surface, theme!.border)
                      : "bg-card border border-border text-foreground",
                  )}
                >
                  <Share2 className="size-4" /> Share Link
                </button>
                <button
                  type="button"
                  disabled={writingNfc}
                  onClick={() => void handleWriteNfcTag()}
                  className={cn(
                    "press col-span-2 inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-bold sm:col-span-1",
                    isGlass ? theme!.accentBg : "bg-brand text-primary-foreground",
                  )}
                >
                  <Nfc className="size-4" /> {writingNfc ? "Hold NFC Tag…" : "Write NFC"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-xs text-rose-600">
          <p className="font-bold">Personal Link Revoked</p>
          <p className="mt-1">
            Your previous link and QR code are permanently disabled. Generate a new link below when
            ready.
          </p>
        </div>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          disabled={nfcBusy}
          onClick={() => void handleRegenerate()}
          className={cn(
            "press inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold disabled:opacity-50",
            isGlass ? theme!.surfaceMuted : "bg-secondary text-secondary-foreground",
          )}
        >
          <RefreshCw className="size-4" /> Regenerate Link
        </button>
        <button
          type="button"
          disabled={nfcBusy || Boolean(nfc?.revoked)}
          onClick={() => void handleRevoke()}
          className="press inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-xs font-bold text-white transition hover:bg-rose-700 disabled:opacity-50"
        >
          <ShieldAlert className="size-4" /> Revoke Lost Card
        </button>
      </div>
    </section>
  );
}
