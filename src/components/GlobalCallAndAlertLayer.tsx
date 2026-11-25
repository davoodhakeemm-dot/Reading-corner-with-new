import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Camera,
  CameraOff,
  MessageCircle,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  SwitchCamera,
  Video,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  LocalCallPreview,
  RemoteCallAudio,
  RemoteCallVideo,
  warmUpCallAudio,
} from "@/components/CallMedia";
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
  setCallCameraEnabled,
  setCallMicMuted,
  switchCallCamera,
  useChat,
} from "@/lib/chat-store";
import { getSecretTheme } from "@/lib/secret-themes";
import { cn } from "@/lib/utils";

export function GlobalCallAndAlertLayer() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { me, incomingCall, outgoingCall, incomingMessageAlert, soundEnabled } = useChat();

  const [speakerOn, setSpeakerOn] = useState(true);
  const [seconds, setSeconds] = useState(0);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [switchingCamera, setSwitchingCamera] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isOnChatSurface = pathname.startsWith("/messages") || pathname.startsWith("/chat");
  const theme = getSecretTheme(me?.theme);

  const isConnected = outgoingCall?.status === "accepted";
  const isCallActive = Boolean(incomingCall || outgoingCall);
  const micMuted = outgoingCall?.micMuted ?? false;
  const cameraEnabled = outgoingCall?.cameraEnabled ?? true;
  const remoteMicMuted = outgoingCall?.remoteMicMuted ?? false;
  const remoteCameraEnabled = outgoingCall?.remoteCameraEnabled ?? true;
  const facingMode = outgoingCall?.facingMode ?? "user";
  const canSwitchCamera = outgoingCall?.canSwitchCamera ?? false;

  // Reset call UI states when call session ends or switches
  useEffect(() => {
    if (!isCallActive) {
      setSpeakerOn(true);
      setHasRemoteVideo(false);
      setSwitchingCamera(false);
    }
  }, [isCallActive]);

  const outgoingCallId = outgoingCall?.callId;
  const outgoingCallStatus = outgoingCall?.status;

  // Call duration timer (starts on connected, preserves elapsed time during brief reconnects)
  useEffect(() => {
    if (!outgoingCallId) {
      setSeconds(0);
      return;
    }
    if (outgoingCallStatus !== "accepted" && outgoingCallStatus !== "reconnecting") {
      setSeconds(0);
      return;
    }
    if (outgoingCallStatus !== "accepted") return;

    const timerId = window.setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [outgoingCallId, outgoingCallStatus]);

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
        void openThread(incomingCall.from.id);
        if (!isOnChatSurface) {
          void navigate({ to: "/messages", search: { peer: incomingCall.from.id } });
        }
      },
    });

    return () => {
      window.clearInterval(intervalId);
      stopVibration();
    };
  }, [incomingCall, isOnChatSurface, navigate, soundEnabled]);

  // Auto-dismiss incoming message banner cleanly after 7.5s
  const incomingAlertId = incomingMessageAlert?.id;
  useEffect(() => {
    if (!incomingAlertId) return;
    const timerId = window.setTimeout(() => {
      dismissIncomingMessageAlert();
    }, 7500);
    return () => window.clearTimeout(timerId);
  }, [incomingAlertId]);

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
    warmUpCallAudio();
    stopVibration();
    const callerId = incomingCall.from.id;
    respondToCall(incomingCall.callId, callerId, "accepted");
    void openThread(callerId);
    if (!isOnChatSurface) {
      void navigate({ to: "/messages" });
    }
  }

  async function handleSwitchCamera() {
    if (switchingCamera) return;
    setSwitchingCamera(true);
    try {
      await switchCallCamera();
    } finally {
      setSwitchingCamera(false);
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

  const showFullScreenRemoteVideo = Boolean(
    isVideo &&
    outgoingCall?.stream &&
    hasRemoteVideo &&
    remoteCameraEnabled !== false &&
    !incomingCall,
  );

  const overlayContent = (
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
            className="fixed inset-0 z-[120] flex h-[100dvh] w-[100dvw] flex-col justify-between overflow-hidden overscroll-none bg-zinc-950 p-5 text-white touch-manipulation md:p-10"
          >
            {/* Dedicated Remote Audio Element for BOTH audio & video calls */}
            {outgoingCall && (
              <RemoteCallAudio
                stream={outgoingCall.stream ?? null}
                streamVersion={outgoingCall.streamVersion ?? 0}
                speakerOn={speakerOn}
              />
            )}

            {/* Full-Screen Remote Video Background when active */}
            {isVideo && outgoingCall && (
              <div className="absolute inset-0 z-0 bg-black">
                <RemoteCallVideo
                  stream={outgoingCall.stream ?? null}
                  streamVersion={outgoingCall.streamVersion ?? 0}
                  remoteCameraEnabled={remoteCameraEnabled}
                  onHasVideoChange={setHasRemoteVideo}
                />
                {/* Scrims for legible overlay controls on top & bottom */}
                <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/75 to-transparent" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-black/85 to-transparent" />
              </div>
            )}

            {/* Top Bar: Call Status + Speaker Toggle + Local PiP */}
            <div className="relative z-20 flex items-start justify-between gap-3 pt-[env(safe-area-inset-top)]">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 rounded-full bg-black/45 px-4 py-1.5 text-xs font-semibold backdrop-blur-md">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      outgoingCall?.status === "reconnecting"
                        ? "animate-pulse bg-amber-400"
                        : "animate-pulse bg-emerald-400",
                    )}
                  />
                  <span>
                    {incomingCall
                      ? `Incoming ${incomingCall.callType} call`
                      : {
                          accepted: `Encrypted call · ${formatDuration(seconds)}`,
                          preparing: "Preparing your device…",
                          connecting: "Connecting…",
                          ringing: "Ringing…",
                          reconnecting: "Reconnecting…",
                        }[outgoingCall!.status]}
                  </span>
                </div>

                {showFullScreenRemoteVideo && (
                  <div className="px-1 drop-shadow">
                    <p className="font-display text-lg font-extrabold leading-tight">
                      {activePeerData.fullName}
                    </p>
                    <p className="text-xs text-white/75">
                      {activePeerData.displayHandle || "@reader"}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-col items-end gap-3">
                <button
                  type="button"
                  onClick={() => setSpeakerOn((s) => !s)}
                  aria-label={speakerOn ? "Mute call speaker" : "Unmute call speaker"}
                  className={cn(
                    "grid size-11 place-items-center rounded-full bg-black/45 backdrop-blur-md transition hover:bg-black/65",
                    speakerOn ? "text-emerald-400" : "text-rose-400",
                  )}
                >
                  {speakerOn ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
                </button>

                {/* Local Camera PiP Preview during Video Calls */}
                {isVideo && outgoingCall && (
                  <div className="relative h-36 w-24 overflow-hidden rounded-2xl border-2 border-white/25 bg-zinc-900 shadow-2xl sm:h-44 sm:w-32">
                    {cameraEnabled && outgoingCall.localStream ? (
                      <LocalCallPreview
                        stream={outgoingCall.localStream}
                        streamVersion={outgoingCall.streamVersion ?? 0}
                        cameraEnabled={cameraEnabled}
                        facingMode={facingMode}
                      />
                    ) : (
                      <div className="grid size-full place-items-center bg-zinc-900 text-center text-[11px] font-semibold text-zinc-400">
                        <div className="flex flex-col items-center gap-1">
                          <CameraOff className="size-5" />
                          <span>Camera off</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Center: Profile Avatar & Name (shown on audio calls or until remote video frames appear) */}
            {!showFullScreenRemoteVideo && (
              <div className="relative z-10 my-auto flex flex-col items-center justify-center text-center">
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

                <h2 className="font-display text-2xl font-extrabold md:text-3xl">
                  {activePeerData.fullName}
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  {activePeerData.displayHandle || "@reader"}
                </p>
                {isConnected && (
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    {!isVideo && (
                      <p className="rounded-full bg-white/10 px-3.5 py-1 text-xs font-semibold text-emerald-300">
                        {micMuted ? "Microphone muted" : "Voice connected"}
                      </p>
                    )}
                    {isVideo && remoteCameraEnabled === false && (
                      <p className="rounded-full bg-white/10 px-3.5 py-1 text-xs font-semibold text-amber-200">
                        Camera off
                      </p>
                    )}
                    {remoteMicMuted && (
                      <p className="rounded-full bg-white/10 px-3.5 py-1 text-xs font-semibold text-zinc-300">
                        Remote muted
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Bottom Bar: Action Controls & End Call / Receive */}
            <div className="relative z-20 mx-auto mt-auto flex w-full max-w-md flex-col gap-5 pb-[env(safe-area-inset-bottom)]">
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
                  <div className="flex items-center justify-center gap-5">
                    <button
                      type="button"
                      onClick={() => setCallMicMuted(!micMuted)}
                      aria-label={micMuted ? "Unmute microphone" : "Mute microphone"}
                      className={cn(
                        "grid size-14 place-items-center rounded-full transition hover:scale-105",
                        micMuted
                          ? "bg-white text-zinc-950"
                          : "bg-black/45 text-white backdrop-blur-md hover:bg-black/65",
                      )}
                    >
                      {micMuted ? <MicOff className="size-6" /> : <Mic className="size-6" />}
                    </button>

                    {isVideo && (
                      <button
                        type="button"
                        onClick={() => setCallCameraEnabled(!cameraEnabled)}
                        aria-label={cameraEnabled ? "Turn camera off" : "Turn camera on"}
                        className={cn(
                          "grid size-14 place-items-center rounded-full transition hover:scale-105",
                          !cameraEnabled
                            ? "bg-white text-zinc-950"
                            : "bg-black/45 text-white backdrop-blur-md hover:bg-black/65",
                        )}
                      >
                        {!cameraEnabled ? (
                          <CameraOff className="size-6" />
                        ) : (
                          <Camera className="size-6" />
                        )}
                      </button>
                    )}

                    {isVideo && canSwitchCamera && (
                      <button
                        type="button"
                        disabled={switchingCamera}
                        onClick={() => void handleSwitchCamera()}
                        aria-label="Switch front or rear camera"
                        className="grid size-14 place-items-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:scale-105 hover:bg-black/65 disabled:opacity-50"
                      >
                        <SwitchCamera className="size-6" />
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

  if (!mounted || typeof document === "undefined") {
    return null;
  }

  return createPortal(overlayContent, document.body);
}
