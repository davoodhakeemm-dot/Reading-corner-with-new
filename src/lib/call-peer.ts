export async function gatherDescription(peer: RTCPeerConnection, type: "offer" | "answer") {
  await peer.setLocalDescription(
    type === "offer" ? await peer.createOffer() : await peer.createAnswer(),
  );
  // Send one complete description so signaling doesn't depend on candidate write ordering.
  if (peer.iceGatheringState !== "complete")
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", changed);
        resolve();
      };
      const changed = () => {
        if (peer.iceGatheringState === "complete") finish();
      };
      const timer = setTimeout(finish, 5000);
      peer.addEventListener("icegatheringstatechange", changed);
    });
  const description = peer.localDescription?.sdp;
  if (!description || !description.includes("a=candidate:"))
    throw new Error("No network route for this call. Try another network.");
  return description;
}
