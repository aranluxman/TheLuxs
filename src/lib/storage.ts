import { getSupabase } from "./supabase";

export const MEDIA_BUCKET = "family-media";

/** Matches the bucket's own limit, enforced here too so we fail before upload. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Signed URLs are short-lived; the app re-signs on each load. */
const SIGNED_URL_TTL = 60 * 60 * 8;

function extensionFor(file: Blob, fallback: string): string {
  const fromName = file instanceof File ? file.name.split(".").pop() : null;
  if (fromName && fromName.length <= 5 && /^[a-z0-9]+$/i.test(fromName)) return fromName;
  const fromMime = file.type.split("/")[1]?.split(";")[0];
  return fromMime && /^[a-z0-9]+$/i.test(fromMime) ? fromMime : fallback;
}

/**
 * Uploads into the private bucket and returns the object path. Paths carry a
 * random segment so one member's photo can never be guessed from another's.
 */
export async function uploadMedia(
  file: Blob,
  folder: "avatars" | "chat",
  fallbackExt = "bin",
): Promise<{ path: string } | { error: string }> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 25 MB.` };
  }

  const path = `${folder}/${crypto.randomUUID()}.${extensionFor(file, fallbackExt)}`;
  const { error } = await getSupabase()
    .storage.from(MEDIA_BUCKET)
    .upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  return error ? { error: error.message } : { path };
}

export async function signMediaUrl(path: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .storage.from(MEDIA_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  return error ? null : (data?.signedUrl ?? null);
}

/** Batched, because a chat page can reference a hundred objects at once. */
export async function signMediaUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return {};

  const { data, error } = await getSupabase()
    .storage.from(MEDIA_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL);

  if (error || !data) return {};

  const out: Record<string, string> = {};
  for (const row of data) {
    if (row.signedUrl && row.path) out[row.path] = row.signedUrl;
  }
  return out;
}

export async function removeMedia(paths: string[]): Promise<void> {
  const real = paths.filter(Boolean);
  if (real.length === 0) return;
  await getSupabase().storage.from(MEDIA_BUCKET).remove(real);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
