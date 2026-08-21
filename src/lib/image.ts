/**
 * Downscales a picked photo before upload. A phone camera shot is several
 * megabytes; an avatar is displayed at 56px. Shrinking client-side keeps the
 * bucket small and makes the chat load quickly on mobile data.
 */
export async function downscaleImage(
  file: File,
  maxEdge = 640,
  quality = 0.85,
): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  // Vector and animated formats lose meaning when rasterised to a still.
  if (file.type === "image/svg+xml" || file.type === "image/gif") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));

    if (scale === 1 && file.size < 400 * 1024) {
      bitmap.close();
      return file;
    }

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    // Keep whichever is smaller — re-encoding can inflate an already-tight file.
    return blob && blob.size < file.size ? blob : file;
  } catch {
    // Unsupported codec, or a browser without createImageBitmap: send as-is.
    return file;
  }
}
