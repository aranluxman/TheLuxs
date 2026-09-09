"use client";

import { useEffect, useRef, useState } from "react";
import { usePhotos } from "@/hooks/usePhotos";
import { format, parseISO } from "@/lib/dates";
import type { PhotoWithUrl } from "@/lib/types";
import { useFamily } from "./FamilyProvider";
import { Avatar, Button, Card, ErrorNote, SectionTitle, inputClass } from "./ui";

/**
 * The family photo wall, on the home screen.
 *
 * A strip of tiles rather than an album: it sits under the agenda, so it has
 * to be glanceable at a walk-past and must not push the day's schedule off
 * the fold. Tapping a tile opens it properly.
 */

/* -------------------------------------------------------------- lightbox */

function Lightbox({
  photo,
  onClose,
  onDelete,
}: {
  photo: PhotoWithUrl;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { byId } = useFamily();
  const uploader = photo.uploaded_by ? byId[photo.uploaded_by] : null;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={photo.caption ?? "Family photo"}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-3">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onDelete}
            className="rounded-full bg-white/10 px-3 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/20 hover:text-white"
          >
            Remove
          </button>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-xl leading-none text-white transition-colors hover:bg-white/20"
          >
            ×
          </button>
        </div>

        {photo.url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={photo.url}
            alt={photo.caption ?? "Family photo"}
            className="max-h-[70vh] w-full rounded-xl object-contain"
          />
        ) : (
          <p className="py-20 text-center text-sm text-white/70">Loading…</p>
        )}

        <div className="flex items-center gap-2.5 text-white/80">
          {uploader ? <Avatar member={uploader} size="sm" /> : null}
          <p className="min-w-0 flex-1 text-sm">
            {photo.caption ? <span className="text-white">{photo.caption}</span> : null}
            {photo.caption ? " · " : ""}
            <span className="text-white/60">
              {uploader ? `${uploader.name} · ` : ""}
              {format(parseISO(photo.created_at), "MMM d, yyyy")}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- wall */

export function PhotoWall() {
  const { currentMember } = useFamily();
  const { photos, loading, uploading, error, addPhotos, removePhoto } = usePhotos();

  const [caption, setCaption] = useState("");
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState<PhotoWithUrl | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function take(files: FileList | null) {
    if (!files || files.length === 0) return;
    await addPhotos([...files], caption, currentMember?.id ?? null);
    setCaption("");
    // Clearing the input matters: picking the same file twice in a row is a
    // no-op otherwise, because `change` never fires for an unchanged value.
    if (fileRef.current) fileRef.current.value = "";
  }

  const empty = !loading && photos.length === 0;

  return (
    <section>
      <SectionTitle
        action={
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="min-h-9 px-3 py-1.5 text-xs"
          >
            {uploading ? "Uploading…" : "＋ Add photos"}
          </Button>
        }
      >
        Family photos
      </SectionTitle>

      <ErrorNote message={error} />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => void take(e.target.files)}
      />

      <Card
        className={`p-3 transition-colors sm:p-4 ${
          dragging ? "border-accent bg-accent-soft" : ""
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void take(e.dataTransfer.files);
        }}
      >
        {/* One caption for the batch — it is almost always describing the
            occasion ("Sahana's meet") rather than the individual frame. */}
        <label htmlFor="photo-caption" className="sr-only">
          Caption for the next photos
        </label>
        <input
          id="photo-caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Caption (optional) — added to the next photos you pick"
          maxLength={140}
          className={`${inputClass} mb-3`}
        />

        {loading ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6" role="status" aria-label="Loading photos">
            <span className="skeleton block aspect-square rounded-lg" />
            <span className="skeleton block aspect-square rounded-lg" />
            <span className="skeleton block aspect-square rounded-lg" />
            <span className="skeleton hidden aspect-square rounded-lg sm:block" />
          </div>
        ) : empty ? (
          <div className="border-line flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
            <span className="bg-accent-soft grid h-12 w-12 place-items-center rounded-xl text-2xl" aria-hidden>
              🖼️
            </span>
            <p className="text-sm font-medium">No photos on the wall yet</p>
            <p className="text-muted max-w-xs text-xs">
              Drop them here, or pick some from your phone. Everyone in the house sees
              them straight away.
            </p>
            <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "Uploading…" : "Choose photos"}
            </Button>
          </div>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {photos.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => setOpen(p)}
                  className="photo-tile bg-sunk block aspect-square w-full overflow-hidden rounded-lg"
                  title={p.caption ?? "Open photo"}
                >
                  {p.url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={p.url}
                      alt={p.caption ?? "Family photo"}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span className="skeleton block h-full w-full" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {open ? (
        <Lightbox
          photo={open}
          onClose={() => setOpen(null)}
          onDelete={() => {
            void removePhoto(open.id);
            setOpen(null);
          }}
        />
      ) : null}
    </section>
  );
}
