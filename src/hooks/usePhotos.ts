"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { downscaleImage } from "@/lib/image";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { removeMedia, signMediaUrls, uploadMedia } from "@/lib/storage";
import type { FamilyPhoto, PhotoWithUrl } from "@/lib/types";

/**
 * How many photos the wall holds in memory. The wall is a strip on the home
 * screen, not an album — showing the most recent handful is the feature, and
 * a household that has been posting for a year should not pay for a year of
 * signed URLs to render six tiles.
 */
/*
 * The wall used to be a grid, where 24 thumbnails already overflowed a phone
 * screen. It is a carousel now — it shows one at a time and rotates — so the
 * cap is about how much history is worth holding in memory and re-signing every
 * few hours, not about how much fits. 120 is roughly a year of occasional
 * photos and still one modest query.
 */
const PAGE_SIZE = 120;

/**
 * Signed URLs last 8 hours (see `SIGNED_URL_TTL`). The kitchen tablet is never
 * reloaded, so without a refresh every tile would 403 partway through the day.
 * Re-signing on a 7-hour cycle keeps every URL comfortably inside its window —
 * the same arrangement the chat makes for its attachments.
 */
const RESIGN_INTERVAL_MS = 7 * 60 * 60 * 1000;

/**
 * The longest edge a wall photo is stored at. Chat images are shrunk to 640px
 * because they render in a bubble; these are opened full-screen in the
 * lightbox, so they get room to be looked at — while still being a fraction of
 * the several megabytes a phone camera hands over.
 */
const MAX_EDGE = 1600;

export function usePhotos(ready = true) {
  const [photos, setPhotos] = useState<PhotoWithUrl[]>([]);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirrors the rows for reads inside callbacks, so the realtime effect does
  // not have to depend on `photos` and tear down its subscription on every
  // upload. Synced in an effect rather than during render: a ref written while
  // rendering is not a value React has committed to, and under Strict Mode's
  // double render it can be written from a tree that is then thrown away.
  //
  // That makes it one commit stale inside an event that fires in the same tick
  // as a state update, so nothing that must be exact reads it — the dedupe
  // below repeats its check inside the functional updater, which does see the
  // latest state.
  const rowsRef = useRef<PhotoWithUrl[]>([]);
  useEffect(() => {
    rowsRef.current = photos;
  }, [photos]);

  /** Attaches a signed URL to each row. One batched call covers the page. */
  const withUrls = useCallback(async (rows: FamilyPhoto[]): Promise<PhotoWithUrl[]> => {
    const signed = await signMediaUrls(rows.map((r) => r.storage_path));
    return rows.map((r) => ({ ...r, url: signed[r.storage_path] ?? null }));
  }, []);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error: err } = await getSupabase()
      .from("family_photos")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setPhotos(await withUrls((data ?? []) as FamilyPhoto[]));
    setError(null);
    setLoading(false);
  }, [withUrls]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, load]);

  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      void (async () => {
        const current = rowsRef.current;
        if (current.length === 0) return;
        const resigned = await withUrls(current);
        // Merged by id rather than assigned wholesale: a photo could have
        // arrived over Realtime while the signing round trip was in flight,
        // and replacing the array outright would drop it.
        const urls = new Map(resigned.map((r) => [r.id, r.url]));
        setPhotos((prev) =>
          prev.map((p) => (urls.has(p.id) ? { ...p, url: urls.get(p.id) ?? null } : p)),
        );
      })();
    }, RESIGN_INTERVAL_MS);
    return () => clearInterval(id);
  }, [ready, withUrls]);

  useEffect(() => {
    if (!isSupabaseConfigured || !ready) return;
    const supabase = getSupabase();
    const channel = supabase
      .channel("family-photos")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "family_photos" },
        (payload) => {
          const row = payload.new as FamilyPhoto;
          // The uploader already has it locally; do not double up.
          if (rowsRef.current.some((p) => p.id === row.id)) return;
          void (async () => {
            const [signed] = await withUrls([row]);
            setPhotos((prev) =>
              prev.some((p) => p.id === row.id)
                ? prev
                : [signed, ...prev].slice(0, PAGE_SIZE),
            );
          })();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "family_photos" },
        (payload) => {
          // Only the caption is updatable — migration 0009 revokes the rest —
          // so the existing signed URL stays valid.
          const row = payload.new as FamilyPhoto;
          setPhotos((prev) =>
            prev.map((p) => (p.id === row.id ? { ...p, ...row } : p)),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "family_photos" },
        (payload) => {
          // Needs FULL replica identity, which migration 0009 sets.
          const row = payload.old as Partial<FamilyPhoto>;
          if (!row.id) return;
          setPhotos((prev) => prev.filter((p) => p.id !== row.id));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ready, withUrls]);

  /**
   * Upload one or more picked files. Each is downscaled in the browser first,
   * so a phone album's worth of 4MB originals does not become 4MB in the
   * bucket and 4MB down the wire every time the home screen paints.
   *
   * Files are handled one at a time on purpose: `Promise.all` over a
   * multi-select would put ten simultaneous uploads on a phone connection and
   * make all of them slow, and a partial failure would be impossible to
   * report usefully.
   */
  const addPhotos = useCallback(
    async (files: File[], caption: string, memberId: string | null) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (images.length === 0) {
        if (files.length > 0) setError("Only image files can go on the wall.");
        return;
      }

      setUploading(true);
      setError(null);

      for (const file of images) {
        const shrunk = await downscaleImage(file, MAX_EDGE, 0.86);
        const uploaded = await uploadMedia(shrunk, "photos", "jpg");
        if ("error" in uploaded) {
          setError(uploaded.error);
          break;
        }

        const { data, error: err } = await getSupabase()
          .from("family_photos")
          .insert({
            storage_path: uploaded.path,
            // One caption covers the batch — it is almost always describing
            // the occasion rather than the individual frame.
            caption: caption.trim() ? caption.trim().slice(0, 140) : null,
            uploaded_by: memberId,
          })
          .select()
          .single();

        if (err) {
          // The upload already succeeded, so a failed insert would strand the
          // object in the bucket with nothing pointing at it.
          await removeMedia([uploaded.path]);
          setError(err.message);
          break;
        }

        const [signed] = await withUrls([data as FamilyPhoto]);
        setPhotos((prev) =>
          prev.some((p) => p.id === signed.id)
            ? prev
            : [signed, ...prev].slice(0, PAGE_SIZE),
        );
      }

      setUploading(false);
    },
    [withUrls],
  );

  /**
   * Take a photo down. The row goes first: an object removed while a row still
   * pointed at it would render as a permanently broken tile on every other
   * device, whereas an orphaned object is invisible.
   */
  const removePhoto = useCallback(async (id: string) => {
    const target = rowsRef.current.find((p) => p.id === id);
    if (!target) return;

    const { error: err } = await getSupabase().from("family_photos").delete().eq("id", id);
    if (err) {
      setError(err.message);
      return;
    }
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    await removeMedia([target.storage_path]);
  }, []);

  return { photos, loading, uploading, error, addPhotos, removePhoto, reload: load };
}
