const DEFAULT_STUN_SERVERS: RTCIceServer[] = [
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun2.l.google.com:19302",
    ],
  },
];

type EnvLike = Record<string, unknown>;

function readDefaultEnv(): EnvLike {
  if (typeof import.meta !== "undefined" && (import.meta as { env?: EnvLike }).env) {
    return (import.meta as { env?: EnvLike }).env ?? {};
  }
  return {};
}

export function buildIceServers(env: EnvLike = readDefaultEnv()): RTCIceServer[] {
  const servers: RTCIceServer[] = DEFAULT_STUN_SERVERS.map((s) => ({ ...s }));

  const rawJson =
    typeof env["VITE_ICE_SERVERS_JSON"] === "string" ? env["VITE_ICE_SERVERS_JSON"].trim() : "";
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object" && "urls" in item && (item as RTCIceServer).urls) {
            servers.push(item as RTCIceServer);
          }
        }
      }
    } catch {
      // Ignore malformed JSON and continue with STUN / explicit TURN env vars
    }
  }

  const rawTurnUrls =
    (typeof env["VITE_TURN_URLS"] === "string" ? env["VITE_TURN_URLS"] : "") ||
    (typeof env["VITE_TURN_URL"] === "string" ? env["VITE_TURN_URL"] : "");
  const turnUrls = rawTurnUrls
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.startsWith("turn:") || u.startsWith("turns:"));

  if (turnUrls.length > 0) {
    const username =
      typeof env["VITE_TURN_USERNAME"] === "string" ? env["VITE_TURN_USERNAME"].trim() : "";
    const credential =
      typeof env["VITE_TURN_CREDENTIAL"] === "string" ? env["VITE_TURN_CREDENTIAL"].trim() : "";
    const turnServer: RTCIceServer = { urls: turnUrls };
    if (username) turnServer.username = username;
    if (credential) turnServer.credential = credential;
    servers.push(turnServer);
  }

  return servers;
}

export function formatCallError(err: unknown, callType: "audio" | "video"): string {
  const name =
    err &&
    typeof err === "object" &&
    "name" in err &&
    typeof (err as { name: unknown }).name === "string"
      ? (err as { name: string }).name
      : "";
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return callType === "video"
      ? "Microphone or camera permission was denied. Allow both in your browser or site settings and retry."
      : "Microphone permission was denied. Allow microphone access in your browser or site settings and retry.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return callType === "video"
      ? "No working microphone or camera was found on this device."
      : "No working microphone was found on this device.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return callType === "video"
      ? "Your camera or microphone is currently in use by another app or tab."
      : "Your microphone is currently in use by another app or tab.";
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return "Your camera does not support the requested video settings.";
  }
  if (name === "SecurityError") {
    return "Calls require a secure HTTPS connection with microphone access.";
  }
  if (message) return message;
  return "Call failed. Please check your permissions and network connection.";
}

export async function gatherDescription(peer: RTCPeerConnection, type: "offer" | "answer") {
  await peer.setLocalDescription(
    type === "offer" ? await peer.createOffer() : await peer.createAnswer(),
  );
  // Send one complete description so signaling doesn't depend on candidate write ordering.
  if (peer.iceGatheringState !== "complete") {
    await new Promise<void>((resolve) => {
      let settled = false;
      let hasPublicCandidate = false;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        clearTimeout(idleTimer);
        peer.removeEventListener("icegatheringstatechange", changed);
        peer.removeEventListener("icecandidate", onCandidate);
        resolve();
      };

      const changed = () => {
        if (peer.iceGatheringState === "complete") finish();
      };

      const onCandidate = (event: RTCPeerConnectionIceEvent) => {
        const cand = event.candidate?.candidate ?? "";
        if (!cand) {
          finish();
          return;
        }
        if (cand.includes(" typ srflx ") || cand.includes(" typ relay ")) {
          hasPublicCandidate = true;
        }
        if (hasPublicCandidate) {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(finish, 900);
        }
      };

      const hardTimer = setTimeout(finish, 4500);
      peer.addEventListener("icegatheringstatechange", changed);
      peer.addEventListener("icecandidate", onCandidate);
    });
  }
  const description = peer.localDescription?.sdp;
  if (!description || !description.includes("a=candidate:")) {
    throw new Error("No network route for this call. Check your connection or TURN configuration.");
  }
  return description;
}
