import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Nfc, ShieldAlert } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Logo } from "@/components/Logo";
import { ReadingActions } from "@/components/ReadingActions";
import { TripleTapExit } from "@/components/TripleTapExit";
import { loginWithPersonalLink, useChat } from "@/lib/chat-store";

export const Route = createFileRoute("/nfc/$token")({
  head: () => ({
    meta: [{ title: "Personal NFC Link — Reading Corner" }, { name: "robots", content: "noindex" }],
  }),
  component: NfcTapPage,
});

function NfcTapPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const { ready } = useChat();

  const [status, setStatus] = useState<"checking" | "authorized" | "invalid">("checking");
  const [ownerName, setOwnerName] = useState("Reader");
  const [ownerHandle, setOwnerHandle] = useState("");
  const attemptedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (attemptedTokenRef.current === token) return;
    attemptedTokenRef.current = token;
    let active = true;

    loginWithPersonalLink(token)
      .then((user) => {
        if (!active) return;
        setOwnerName(user.fullName || "Reader");
        setOwnerHandle(user.displayHandle || "");
        setStatus("authorized");
        toast.success(`Signed in as ${user.fullName}`);
        window.setTimeout(() => {
          navigate({ to: "/home", replace: true });
        }, 450);
      })
      .catch(() => {
        if (!active) return;
        setStatus("invalid");
      });

    return () => {
      active = false;
    };
  }, [token, ready, navigate]);

  return (
    <div className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-gradient-to-b from-[#060913] via-[#0c1427] to-[#07090f] px-4 pt-10 pb-[calc(5rem+env(safe-area-inset-bottom))] text-white">
      {/* Drifting 3D Glass Ambient Orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <motion.div
          animate={{ x: [0, 22, -12, 0], y: [0, 14, -10, 0], scale: [1, 1.08, 0.96, 1] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -left-24 -top-24 size-96 rounded-full bg-gradient-to-tr from-[#2563eb]/35 via-[#dd2a7b]/25 to-[#8134af]/30 blur-3xl"
        />
        <motion.div
          animate={{ x: [0, -20, 14, 0], y: [0, -14, 10, 0], scale: [1.04, 0.95, 1.07, 1.04] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -bottom-24 -right-24 size-96 rounded-full bg-gradient-to-tr from-[#f58529]/22 via-[#e11d48]/26 to-[#3b82f6]/32 blur-3xl"
        />
      </div>

      <TripleTapExit />
      <ReadingActions themeId="dark" />

      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        className="relative w-full max-w-md"
      >
        {/* Upper Frosted Glass Header Crest */}
        <div className="rounded-t-[32px] border border-b-0 border-[#3b82f6]/30 bg-gradient-to-b from-[#162039]/84 to-[#10172b]/76 px-6 pb-8 pt-6 backdrop-blur-2xl shadow-[inset_0_1.5px_1px_rgba(255,255,255,0.2)]">
          <div className="flex items-center gap-3.5">
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
              className="glass-sheen grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-tr from-[#f58529] via-[#dd2a7b] to-[#8134af] text-white shadow-[0_10px_24px_-6px_rgba(221,42,123,0.6)]"
            >
              {status === "invalid" ? (
                <ShieldAlert className="size-5" />
              ) : status === "authorized" ? (
                <CheckCircle2 className="size-5" />
              ) : (
                <Nfc className="size-5" />
              )}
            </motion.div>
            <div>
              <p className="font-display text-lg font-extrabold tracking-tight">
                Reading Corner Personal Link
              </p>
              <p className="text-xs text-white/70">Permanent link &amp; NFC verification</p>
            </div>
          </div>
        </div>

        {/* Lower Overlapping Curved Frosted Form Sheet */}
        <div className="-mt-4 rounded-[32px] border border-[#3b82f6]/35 bg-[#0f1628]/86 p-6 text-white backdrop-blur-2xl shadow-[inset_0_1.5px_1px_rgba(147,197,253,0.22),0_26px_60px_-14px_rgba(37,99,235,0.42)] sm:p-7">
          {status === "checking" && (
            <div className="space-y-3 py-4 text-center">
              <Logo className="mx-auto size-12 animate-pulse" />
              <p className="text-sm font-semibold">Signing into Reading Corner…</p>
              <p className="text-xs text-white/65">
                Restoring your synced reading session from your personal link.
              </p>
            </div>
          )}

          {status === "authorized" && (
            <div className="rounded-2xl border border-emerald-400/35 bg-emerald-500/15 p-5 text-center text-emerald-100">
              <CheckCircle2 className="mx-auto size-9 text-emerald-400" />
              <p className="mt-2 font-display text-base font-bold">
                Signed in as {ownerName}
                {ownerHandle ? ` (${ownerHandle})` : ""}
              </p>
              <p className="mt-1 text-xs text-emerald-200/80">
                Opening Reading Corner completely logged in…
              </p>
            </div>
          )}

          {status === "invalid" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-rose-400/35 bg-rose-500/15 p-4 text-rose-100">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-400" />
                  <div>
                    <p className="text-sm font-bold">Link Revoked or Invalid</p>
                    <p className="mt-1 text-xs leading-relaxed text-rose-200/80">
                      This personal link has been revoked, regenerated, or does not exist. For your
                      security, no account information is accessible.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Link
                  to="/auth"
                  className="glass-sheen flex-1 rounded-full bg-gradient-to-r from-[#f58529] via-[#dd2a7b] to-[#8134af] py-3 text-center text-xs font-bold text-white shadow-md"
                >
                  Sign In Normally
                </Link>
                <Link
                  to="/home"
                  className="flex-1 rounded-full border border-white/15 bg-white/10 py-3 text-center text-xs font-bold text-white hover:bg-white/15"
                >
                  Reading Home
                </Link>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
