import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentReference,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import type { IncomingCall, OutgoingCall, PublicAccount } from "./chat-store";
import { gatherDescription } from "./call-peer";

type Kind = IncomingCall["callType"];
type Session = {
  ref: DocumentReference;
  kind: Kind;
  target?: PublicAccount;
  offer?: string;
  answering: boolean;
  published: boolean;
  peer?: RTCPeerConnection;
  local?: MediaStream;
  remote?: MediaStream;
  status: OutgoingCall["status"];
  timer?: ReturnType<typeof setTimeout>;
  unsub?: Unsubscribe;
};

export function createCallClient(
  db: Firestore,
  uid: string,
  profile: (id: string) => Promise<PublicAccount>,
  render: (value: { incomingCall: IncomingCall | null; outgoingCall: OutgoingCall | null }) => void,
  notify: (message: string) => void,
) {
  const calls = collection(db, "calls");
  let current: Session | undefined;
  function display(s: Session) {
    if (current !== s || !s.target) return;
    const common = { callId: s.ref.id, callType: s.kind };
    if (s.offer && !s.answering)
      render({ incomingCall: { ...common, from: s.target }, outgoingCall: null });
    else
      render({
        incomingCall: null,
        outgoingCall: { ...common, target: s.target, status: s.status, stream: s.remote ?? null },
      });
  }
  function finish(s: Session, remove: boolean, message?: string) {
    if (current !== s) return;
    current = undefined;
    clearTimeout(s.timer);
    s.unsub?.();
    s.peer?.close();
    s.local?.getTracks().forEach((t) => t.stop());
    render({ incomingCall: null, outgoingCall: null });
    if (remove && s.published) void deleteDoc(s.ref).catch(() => {});
    if (message) notify(message);
  }
  function timeout(s: Session, ms: number, message: string) {
    clearTimeout(s.timer);
    s.timer = setTimeout(() => finish(s, true, message), ms);
  }
  async function prepare(s: Session) {
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined")
      throw new Error("Calls need a secure browser tab with microphone access.");
    const local = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: s.kind === "video",
    });
    if (current !== s) {
      local.getTracks().forEach((t) => t.stop());
      throw new Error("Call ended.");
    }
    s.local = local;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    s.peer = pc;
    local.getTracks().forEach((t) => pc.addTrack(t, local));
    pc.ontrack = (event) => {
      s.remote = event.streams[0] ?? s.remote ?? new MediaStream();
      if (!s.remote.getTracks().includes(event.track)) s.remote.addTrack(event.track);
      display(s);
    };
    pc.onconnectionstatechange = () => {
      if (current !== s) return;
      if (pc.connectionState === "connected") {
        clearTimeout(s.timer);
        s.status = "accepted";
        display(s);
      }
      if (pc.connectionState === "failed")
        finish(s, true, "Call could not connect. Try another network.");
      if (pc.connectionState === "disconnected") timeout(s, 12000, "Call disconnected.");
    };
    return pc;
  }
  function failed(s: Session, err: unknown) {
    finish(s, true, err instanceof Error ? err.message : "Call failed. Please try again.");
  }
  const inbox = onSnapshot(
    query(calls, where("callee", "==", uid)),
    (snapshot) => {
      for (const change of snapshot.docChanges()) {
        const data = change.doc.data() as { caller: string; kind: Kind; offer: string; answer?: string; createdAt: { toMillis(): number } | null };
        if (change.type === "removed" || data.answer) {
          if (
            current?.ref.id === change.doc.id &&
            (change.type === "removed" || !current.answering)
          )
            finish(current, false);
          continue;
        }
        if (change.type !== "added" || current || !data.createdAt) continue;
        const remaining = 45000 - (Date.now() - data.createdAt.toMillis());
        if (remaining <= 0) {
          void deleteDoc(change.doc.ref).catch(() => {});
          continue;
        }
        const s: Session = {
          ref: change.doc.ref,
          kind: data.kind,
          offer: data.offer,
          published: true,
          answering: false,
          status: "ringing",
        };
        current = s;
        timeout(s, remaining, "Missed call.");
        void profile(data.caller)
          .then((target) => {
            s.target = target;
            display(s);
          })
          .catch((err) => failed(s, err));
      }
    },
    () => notify("Incoming calls are unavailable. Check your connection and call permissions."),
  );
  const leave = () => {
    if (current) finish(current, true);
  };
  window.addEventListener("pagehide", leave);
  return {
    async dial(target: PublicAccount, kind: Kind) {
      if (current) throw new Error("Finish the current call first.");
      const s: Session = {
        ref: doc(calls),
        kind,
        target,
        published: false,
        answering: false,
        status: "preparing",
      };
      current = s;
      display(s);
      timeout(s, 45000, "Call setup timed out.");
      try {
        const pc = await prepare(s);
        const offer = await gatherDescription(pc, "offer");
        if (current !== s) return;
        await setDoc(s.ref, {
          caller: uid,
          callee: target.id,
          kind,
          offer,
          createdAt: serverTimestamp(),
        });
        s.published = true;
        if (current !== s) {
          await deleteDoc(s.ref);
          return;
        }
        s.status = "ringing";
        display(s);
        timeout(s, 45000, "No answer.");
        s.unsub = onSnapshot(
          s.ref,
          (snap) => {
            if (!snap.exists()) {
              finish(s, false, "Call ended.");
              return;
            }
            const answer = snap.get('answer');
            if (answer && s.status === "ringing") {
              s.status = "connecting";
              display(s);
              timeout(s, 30000, "Call could not connect.");
              void pc
                .setRemoteDescription({ type: "answer", sdp: answer })
                .catch((err) => failed(s, err));
            }
          },
          () => finish(s, false, "Call ended or signaling became unavailable."),
        );
      } catch (err) {
        failed(s, err);
      }
    },
    async respond(id: string, action: "accepted" | "declined" | "ended") {
      const s = current;
      if (!s || id !== s.ref.id) return;
      if (action !== "accepted") {
        finish(s, true);
        return;
      }
      if (!s.offer || s.answering) return;
      s.answering = true;
      s.status = "connecting";
      display(s);
      timeout(s, 30000, "Call could not connect.");
      try {
        const pc = await prepare(s);
        await pc.setRemoteDescription({ type: "offer", sdp: s.offer });
        const answer = await gatherDescription(pc, "answer");
        if (current === s) await updateDoc(s.ref, { answer });
      } catch (err) {
        failed(s, err);
      }
    },
    dispose() {
      inbox();
      window.removeEventListener("pagehide", leave);
      leave();
    },
  };
}
