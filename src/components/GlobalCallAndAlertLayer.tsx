import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Camera,
  CameraOff,
  MessageCircle,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Volume2,
  Video,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

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

  const [micMuted, setMicMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [seconds, setSeconds] = useState(0);

  const isOnChatSurface = pathname.startsWith("/messages") || pathname.startsWith("/chat");
  const theme = getSecretTheme(me?.theme);

  const isConnected = outgoingCall?.status === "accepted";

  // Call duration timer
  useEffect(() => {
    if (!isConnected) {
      setSeconds(0);
      return;
    }
    const timerId = window.setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [isConnected]);

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  };

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

  const activePeerData = incomingCall
    ? incomingCall.from
    : outgoingCall
      ? outgoingCall.target
      : null;
  const isVideo = incomingCall
    ? incomingCall.callType === "video"
    : outgoingCall
      ? outgoingCall.callType === "video"
      : false;

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

      {/* Full-Screen Immersive Call Interface (WhatsApp / Instagram Style) */}
      <AnimatePresence>
        {(incomingCall || outgoingCall) && activePeerData && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="dialog"
            aria-modal="true"
            aria-label={incomingCall ? "Incoming call" : "Active call"}
            className="fixed inset-0 z-[80] flex flex-col justify-between bg-zinc-950 p-6 text-white md:p-12"
          >
            {/* Top Bar: Call Type & Encryption / Status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold backdrop-blur-md">
                <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
                <span>
                  {incomingCall
                    ? `Incoming ${incomingCall.callType} call`
                    : {
                        accepted: `Encrypted call · ${formatDuration(seconds)}`,
                        preparing: "Preparing your device…",
                        connecting: "Connecting…",
                        ringing: "Ringing…",
                      }[outgoingCall!.status]}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSpeakerOn((s) => !s)}
                aria-label="Toggle speaker"
                className={cn(
                  "grid size-11 place-items-center rounded-full bg-white/10 backdrop-blur-md transition hover:bg-white/20",
                  speakerOn ? "text-emerald-400" : "text-white/70",
                )}
              >
                <Volume2 className="size-5" />
              </button>
            </div>

            {/* Center: Profile Avatar / Remote Video Stream */}
            <div className="relative my-auto flex flex-col items-center justify-center text-center">
              {isVideo && isConnected && outgoingCall?.stream ? (
                <div className="absolute inset-0 overflow-hidden rounded-[32px] bg-black shadow-2xl">
                  <CallMedia stream={outgoingCall.stream} video={true} />
                </div>
              ) : (
                <div className="relative mb-6">
                  {incomingCall && (
                    <span className="absolute -inset-4 animate-ping rounded-full bg-emerald-500/30" />
                  )}
                  <div className="relative grid size-32 place-items-center overflow-hidden rounded-full border-4 border-white/20 bg-gradient-to-br from-violet-600 to-indigo-800 text-3xl font-extrabold shadow-2xl md:size-40">
                    {activePeerData.avatarUrl ? (
                      <img
                        src={activePeerData.avatarUrl}
                        alt={activePeerData.fullName}
                        className="size-full object-cover"
                      />
                    ) : (
                      initialsOf(activePeerData.fullName)
                    )}
                  </div>
                </div>
              )}

              <h2 className="font-display text-2xl font-extrabold md:text-3xl">
                {activePeerData.fullName}
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                {activePeerData.displayHandle || "@reader"}
              </p>
            </div>

            {/* Bottom Bar: Action Controls & End Call / Receive */}
            <div className="mx-auto flex w-full max-w-md flex-col gap-6">
              {incomingCall ? (
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      stopVibration();
                      respondToCall(incomingCall.callId, incomingCall.from.id, "declined");
                    }}
                    className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-full bg-rose-600 px-6 text-sm font-bold text-white shadow-xl transition hover:bg-rose-500"
                    aria-label="Decline call"
                  >
                    <PhoneOff className="size-5" />
                    <span>Decline</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleReceiveCall}
                    className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-full bg-emerald-600 px-6 text-sm font-bold text-white shadow-[0_10px_30px_rgba(16,185,129,0.5)] transition hover:bg-emerald-500"
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
              ) : (
                <>
                  <div className="flex items-center justify-center gap-6">
                    <button
                      type="button"
                      onClick={() => setMicMuted((m) => !m)}
                      aria-label={micMuted ? "Unmute microphone" : "Mute microphone"}
                      className={cn(
                        "grid size-14 place-items-center rounded-full transition hover:scale-105",
                        micMuted ? "bg-white text-zinc-950" : "bg-white/15 backdrop-blur-md",
                      )}
                    >
                      {micMuted ? <MicOff className="size-6" /> : <Mic className="size-6" />}
                    </button>

                    {isVideo && (
                      <button
                        type="button"
                        onClick={() => setVideoOff((v) => !v)}
                        aria-label={videoOff ? "Turn camera on" : "Turn camera off"}
                        className={cn(
                          "grid size-14 place-items-center rounded-full transition hover:scale-105",
                          videoOff ? "bg-white text-zinc-950" : "bg-white/15 backdrop-blur-md",
                        )}
                      >
                        {videoOff ? (
                          <CameraOff className="size-6" />
                        ) : (
                          <Camera className="size-6" />
                        )}
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      respondToCall(outgoingCall!.callId, outgoingCall!.target.id, "ended")
                    }
                    className="mx-auto flex min-h-[56px] w-full max-w-xs items-center justify-center gap-2 rounded-full bg-rose-600 px-6 text-sm font-bold text-white shadow-[0_10px_30px_rgba(225,29,72,0.5)] transition hover:bg-rose-500"
                    aria-label="End call"
                  >
                    <PhoneOff className="size-5" />
                    <span>End Call</span>
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
