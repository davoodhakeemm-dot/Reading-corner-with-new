import { useNavigate, useRouterState } from "@tanstack/react-router";
import { MessageCircle, Phone, PhoneOff, Video, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";

import { CallMedia } from "@/components/CallMedia";
import {
  buildIncomingCallAlertPayload,
  playIncomingRingtone,
  showSystemNotification,
  stopVibration,
  triggerVibration,
} from "@/lib/alerts";
import {
  dismissIncomingMessageAlert,
  initialsOf,
  openThread,
  respondToCall,
  useChat,
} from "@/lib/chat-store";
import { getSecretTheme } from "@/lib/secret-themes";
import { cn } from "@/lib/utils";

export function GlobalCallAndAlertLayer() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { me, incomingCall, outgoingCall, incomingMessageAlert, soundEnabled } = useChat();

  const isOnChatSurface = pathname.startsWith("/messages") || pathname.startsWith("/chat");
  const theme = getSecretTheme(me?.theme);

  // Repeating vibration + ringtone + OS notification while an incoming call is ringing
  useEffect(() => {
    if (!incomingCall) {
      stopVibration();
      return;
    }

    const payload = buildIncomingCallAlertPayload({
      senderName: incomingCall.from.fullName,
      callType: incomingCall.callType,
    });

    const ringOnce = () => {
      triggerVibration(payload.vibratePattern);
      playIncomingRingtone(soundEnabled);
    };

    ringOnce();
    const intervalId = window.setInterval(ringOnce, 2200);

    showSystemNotification({
      title: payload.title,
      body: payload.body,
      tag: `${payload.tag}-${incomingCall.callId}`,
      requireInteraction: true,
      onClick: () => {
        if (!isOnChatSurface) {
          void navigate({ to: "/messages" });
        }
      },
    });

    return () => {
      window.clearInterval(intervalId);
      stopVibration();
    };
  }, [incomingCall, isOnChatSurface, navigate, soundEnabled]);

  // Auto-dismiss incoming message banner cleanly after 7.5s
  useEffect(() => {
    if (!incomingMessageAlert) return;
    const timerId = window.setTimeout(() => {
      dismissIncomingMessageAlert();
    }, 7500);
    return () => window.clearTimeout(timerId);
  }, [incomingMessageAlert?.id]);

  function handleReceiveMessage() {
    if (!incomingMessageAlert) return;
    const peerId = incomingMessageAlert.peer.id;
    dismissIncomingMessageAlert();
    void openThread(peerId);
    if (!isOnChatSurface) {
      void navigate({ to: "/messages" });
    }
  }

  function handleReceiveCall() {
    if (!incomingCall) return;
    stopVibration();
    const callerId = incomingCall.from.id;
    respondToCall(incomingCall.callId, callerId, "accepted");
    void openThread(callerId);
    if (!isOnChatSurface) {
      void navigate({ to: "/messages" });
    }
  }

  return (
    <>
      {/* Incoming Message Notification Banner with Receive Action */}
      <AnimatePresence>
        {incomingMessageAlert && !incomingCall && (
          <motion.div
            key={incomingMessageAlert.id}
            initial={{ opacity: 0, y: -24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 360, damping: 28 }}
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[60] flex justify-center"
          >
            <div
              className={cn(
                "pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-[24px] border p-3 shadow-2xl backdrop-blur-2xl",
                theme.surfaceGlass,
                theme.border,
              )}
            >
              <span className={cn("shrink-0 rounded-full p-[2px]", theme.ringGradient)}>
                <span
                  className={cn(
                    "grid size-10 place-items-center overflow-hidden rounded-full font-display text-xs font-bold",
                    theme.surface,
                  )}
                >
                  {incomingMessageAlert.peer.avatarUrl ? (
                    <img
                      src={incomingMessageAlert.peer.avatarUrl}
                      alt={incomingMessageAlert.peer.fullName}
                      className="size-full object-cover"
                    />
                  ) : (
                    initialsOf(incomingMessageAlert.peer.fullName)
                  )}
                </span>
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
                  <p className="truncate text-xs font-extrabold">
                    {incomingMessageAlert.peer.fullName}
                  </p>
                </div>
                <p className={cn("truncate text-xs", theme.mutedText)}>
                  {incomingMessageAlert.preview}
                </p>
              </div>

              <button
                type="button"
                onClick={handleReceiveMessage}
                className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 text-xs font-bold text-white shadow-md transition hover:bg-emerald-500"
              >
                <MessageCircle className="size-3.5" />
                <span>{isOnChatSurface ? "Open" : "Receive"}</span>
              </button>

              <button
                type="button"
                onClick={dismissIncomingMessageAlert}
                aria-label="Dismiss message notification"
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full transition hover:opacity-80",
                  theme.surfaceMuted,
                )}
              >
                <X className="size-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Real-time Incoming / Outgoing Call Modal (Available on Chat & Reading Pages) */}
      <AnimatePresence>
        {(incomingCall || outgoingCall) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="dialog"
            aria-modal="true"
            aria-label={incomingCall ? "Incoming call" : "Active call"}
            className="fixed inset-0 z-[70] grid place-items-center bg-black/75 p-4 backdrop-blur-lg"
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 12 }}
              className={cn(
                "glass-sheen w-full max-w-sm rounded-[32px] border p-6 text-center backdrop-blur-2xl",
                theme.surfaceGlass,
                theme.border,
              )}
            >
              {incomingCall ? (
                <>
                  <div className="relative mx-auto w-fit">
                    <span className="absolute -inset-2 animate-ping rounded-full bg-emerald-500/25" />
                    <div
                      className={cn(
                        "relative grid size-20 place-items-center overflow-hidden rounded-full text-xl font-bold shadow-lg",
                        theme.accentBg,
                      )}
                    >
                      {incomingCall.from.avatarUrl ? (
                        <img
                          src={incomingCall.from.avatarUrl}
                          alt={incomingCall.from.fullName}
                          className="size-full object-cover"
                        />
                      ) : incomingCall.callType === "video" ? (
                        <Video className="size-8" />
                      ) : (
                        <Phone className="size-8" />
                      )}
                    </div>
                  </div>

                  <p className="mt-4 font-display text-xl font-extrabold">
                    {incomingCall.from.fullName}
                  </p>
                  <p className={cn("mt-1 text-xs font-semibold", theme.mutedText)}>
                    Incoming {incomingCall.callType} call…
                  </p>
                  <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-bold text-emerald-500">
                    <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
                    Ringing &amp; vibrating
                  </span>

                  <div className="mt-6 grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        stopVibration();
                        respondToCall(incomingCall.callId, incomingCall.from.id, "declined");
                      }}
                      className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-rose-600 px-4 text-sm font-bold text-white shadow-lg transition hover:bg-rose-500"
                      aria-label="Decline call"
                    >
                      <PhoneOff className="size-5" />
                      <span>Decline</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleReceiveCall}
                      className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-emerald-600 px-4 text-sm font-bold text-white shadow-[0_10px_26px_-4px_rgba(16,185,129,0.65)] transition hover:bg-emerald-500"
                      aria-label="Receive call"
                    >
                      {incomingCall.callType === "video" ? (
                        <Video className="size-5" />
                      ) : (
                        <Phone className="size-5" />
                      )}
                      <span>Receive</span>
                    </button>
                  </div>
                </>
              ) : outgoingCall ? (
                <>
                  <div
                    className={cn(
                      "mx-auto grid size-16 place-items-center overflow-hidden rounded-full text-xl font-bold",
                      theme.accentBg,
                    )}
                  >
                    {outgoingCall.target.avatarUrl ? (
                      <img
                        src={outgoingCall.target.avatarUrl}
                        alt={outgoingCall.target.fullName}
                        className="size-full object-cover"
                      />
                    ) : outgoingCall.callType === "video" ? (
                      <Video className="size-7" />
                    ) : (
                      <Phone className="size-7" />
                    )}
                  </div>
                  <p className="mt-4 font-display text-lg font-extrabold">
                    {outgoingCall.target.fullName}
                  </p>
                  <p className={cn("mt-1 text-xs", theme.mutedText)}>
                    {
                      {
                        accepted: "Connected",
                        preparing: "Preparing your device…",
                        connecting: "Connecting…",
                        ringing: "Ringing…",
                      }[outgoingCall.status]
                    }
                  </p>
                  <CallMedia
                    stream={outgoingCall.stream ?? null}
                    video={outgoingCall.callType === "video"}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      respondToCall(outgoingCall.callId, outgoingCall.target.id, "ended")
                    }
                    className="mx-auto mt-6 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-rose-600 px-6 text-sm font-bold text-white shadow-lg transition hover:bg-rose-500"
                    aria-label="End call"
                  >
                    <PhoneOff className="size-5" />
                    <span>End Call</span>
                  </button>
                </>
              ) : null}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
