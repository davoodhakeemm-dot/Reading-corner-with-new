import { useEffect, useRef, useState } from "react";

export function CallMedia({ stream, video }: { stream: MediaStream | null; video: boolean }) {
  const player = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const el = player.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    void el.play().catch(() => setPaused(true));
    return () => {
      el.srcObject = null;
    };
  }, [stream]);
  return (
    <>
      <video
        aria-label="Remote call media"
        className={
          video && stream
            ? "mx-auto mt-3 max-h-48 w-full rounded-xl bg-black object-contain"
            : "hidden"
        }
        ref={player}
        playsInline
        autoPlay
        onPlaying={() => setPaused(false)}
      />
      {paused && (
        <button
          type="button"
          onClick={() => void player.current?.play().catch(() => setPaused(true))}
        >
          Play call audio
        </button>
      )}
    </>
  );
}
