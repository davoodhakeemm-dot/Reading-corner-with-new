import { ImageOff } from "lucide-react";
import { useEffect, useState, type ComponentPropsWithoutRef } from "react";

import { getCachedMediaObjectUrl, resolveAuthorizedMediaUrl } from "@/lib/chat-store";
import { cn } from "@/lib/utils";

function useProtectedMediaSrc(url: string | null | undefined) {
  const [resolved, setResolved] = useState<string | null>(() => {
    if (!url) return null;
    if (!url.startsWith("/api/media/")) return url;
    return getCachedMediaObjectUrl(url);
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);

    if (!url) {
      setResolved(null);
      return;
    }

    if (!url.startsWith("/api/media/")) {
      setResolved(url);
      return;
    }

    const cached = getCachedMediaObjectUrl(url);
    if (cached) {
      setResolved(cached);
      return;
    }

    setResolved(null);
    void resolveAuthorizedMediaUrl(url)
      .then((objUrl) => {
        if (active) setResolved(objUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [url]);

  return { src: resolved, failed };
}

export function ProtectedImage({
  src,
  alt,
  className,
  ...rest
}: Omit<ComponentPropsWithoutRef<"img">, "src"> & { src: string | null | undefined }) {
  const { src: resolvedSrc, failed } = useProtectedMediaSrc(src);

  if (failed) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-1 bg-black/10 p-3 text-center text-[11px] opacity-75",
          className,
        )}
      >
        <ImageOff className="size-5 opacity-70" />
        <span className="line-clamp-1 max-w-full">{alt || "Image unavailable"}</span>
      </div>
    );
  }

  if (!resolvedSrc) {
    return <div className={cn("animate-pulse bg-black/10 dark:bg-white/10", className)} />;
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      onError={() => {
        /* Keep browser resilience if blob decode fails */
      }}
      {...rest}
    />
  );
}

export function ProtectedVideo({
  src,
  className,
  ...rest
}: Omit<ComponentPropsWithoutRef<"video">, "src"> & { src: string | null | undefined }) {
  const { src: resolvedSrc, failed } = useProtectedMediaSrc(src);

  if (failed) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-black/20 p-3 text-center text-[11px] text-white/80",
          className,
        )}
      >
        Video unavailable
      </div>
    );
  }

  if (!resolvedSrc) {
    return <div className={cn("animate-pulse bg-black/20", className)} />;
  }

  return <video src={resolvedSrc} className={className} {...rest} />;
}

export function ProtectedAudio({
  src,
  className,
  ...rest
}: Omit<ComponentPropsWithoutRef<"audio">, "src"> & { src: string | null | undefined }) {
  const { src: resolvedSrc, failed } = useProtectedMediaSrc(src);

  if (failed) {
    return <p className="text-xs opacity-75">Audio unavailable</p>;
  }

  if (!resolvedSrc) {
    return <div className={cn("h-9 w-52 animate-pulse rounded-full bg-black/10", className)} />;
  }

  return <audio src={resolvedSrc} className={className} {...rest} />;
}
