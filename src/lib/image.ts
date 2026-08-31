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

/**
 * Centre-crops a photo to a square and scales it to `edge` pixels — what an app
 * icon needs, since every launcher and every favicon slot is square and a
 * squashed family photo looks broken.
 *
 * Returns the JPEG to upload plus an inline copy: the data URL is what makes
 * the tab icon appear before the network answers, and what keeps it there when
 * the network never does.
 */
export async function squareCropImage(
  file: File | Blob,
  edge = 512,
  quality = 0.85,
): Promise<{ blob: Blob; dataUrl: string } | { error: string }> {
  if (!file.type.startsWith("image/")) {
    return { error: "That file isn't an image." };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { error: "That image couldn't be read — try a JPEG or PNG." };
  }

  try {
    // The crop box is the largest square that fits, taken from the centre.
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    const size = Math.min(edge, side);

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { error: "This browser can't resize images." };

    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) return { error: "This browser couldn't encode the image." };

    return { blob, dataUrl: canvas.toDataURL("image/jpeg", quality) };
  } finally {
    bitmap.close();
  }
}
