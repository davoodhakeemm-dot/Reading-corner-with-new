export type CompressOptions = {
  maxDimension?: number;
  quality?: number;
  minBytesToCompress?: number;
};

/**
 * Compresses large static images (JPEG/PNG/WebP) in browser memory via Canvas
 * before upload so mobile connections send faster while leaving GIFs, SVGs,
 * small photos, and non-browser environments untouched.
 */
export async function compressImageFile(file: File, options: CompressOptions = {}): Promise<File> {
  const { maxDimension = 1920, quality = 0.82, minBytesToCompress = 220 * 1024 } = options;

  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    !file.type.startsWith("image/") ||
    file.type === "image/gif" ||
    file.type === "image/svg+xml" ||
    file.size <= minBytesToCompress
  ) {
    return file;
  }

  let objectUrl: string | null = null;
  try {
    objectUrl = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Image decode failed"));
      el.src = objectUrl!;
    });

    const srcWidth = img.naturalWidth || img.width;
    const srcHeight = img.naturalHeight || img.height;
    if (!srcWidth || !srcHeight) return file;

    const scale = Math.min(1, maxDimension / Math.max(srcWidth, srcHeight));
    const width = Math.max(1, Math.round(srcWidth * scale));
    const height = Math.max(1, Math.round(srcHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(img, 0, 0, width, height);

    const targetMime = file.type === "image/png" ? "image/webp" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), targetMime, quality);
    });

    if (!blob || blob.size === 0 || blob.size >= file.size) {
      return file;
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
    const ext = targetMime === "image/webp" ? "webp" : "jpg";
    return new File([blob], `${baseName}.${ext}`, {
      type: targetMime,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}
