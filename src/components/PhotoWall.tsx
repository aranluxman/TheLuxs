"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

/* ---------------------------------------------------------------- carousel */

/** How long each photo holds before the next one comes up. */
const SLIDE_MS = 5000;

/**
 * One photo at a time, advancing on its own.
 *
 * It pauses whenever someone is actually looking — pointer over it, keyboard
 * focus inside it, or the tab in the background — because a photo sliding away
 * mid-look is worse than no rotation at all. `prefers-reduced-motion` stops the
 * automatic advance entirely rather than merely removing the fade: for that
 * reader the movement *is* the problem, and the arrows still work.
 */
function Carousel({
  photos,
  onOpen,
}: {
  photos: PhotoWithUrl[];
  onOpen: (p: PhotoWithUrl) => void;
}) {
  const { byId } = useFamily();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // A photo removed from under us must not leave the index out past the end.
  const safeIndex = photos.length ? index % photos.length : 0;
  const photo = photos[safeIndex];

  const go = useCallback(
    (delta: number) =>
      setIndex((i) => (photos.length ? (i + delta + photos.length) % photos.length : 0)),
    [photos.length],
  );

  useEffect(() => {
    if (paused || photos.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const id = window.setInterval(() => {
      // Advancing a carousel nobody can see just burns signed-URL lifetime.
      if (document.visibilityState === "visible") setIndex((i) => i + 1);
    }, SLIDE_MS);
    return () => window.clearInterval(id);
  }, [paused, photos.length]);

  if (!photo) return null;

  const uploader = photo.uploaded_by ? byId[photo.uploaded_by] : null;

  return (
    <div
      className="photo-carousel aspect-[4/3] w-full sm:aspect-[16/9]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      role="region"
      aria-roledescription="carousel"
      aria-label={`Family photos, ${safeIndex + 1} of ${photos.length}`}
    >
      {/* Keyed on the photo id so React remounts on every change and the fade
          replays — without it the element persists and the animation runs once. */}
      <button
        key={photo.id}
        type="button"
        onClick={() => onOpen(photo)}
        className="photo-carousel-slide absolute inset-0 block h-full w-full"
        aria-label={photo.caption ? `Open: ${photo.caption}` : "Open this photo"}
      >
        {photo.url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={photo.url}
            alt={photo.caption ?? "Family photo"}
            className="h-full w-full object-cover"
            decoding="async"
          />
        ) : (
          <span className="skeleton block h-full w-full" />
        )}
      </button>

      {/* Sits above the slide, but only over the bottom strip, so most of the
          photo stays clickable. */}
      <div className="photo-carousel-scrim pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-3 p-3 sm:p-4">
        <div className="min-w-0 flex-1">
          {photo.caption ? (
            <p className="truncate text-sm font-medium text-white">{photo.caption}</p>
          ) : null}
          <p className="truncate text-xs text-white/70">
            {uploader ? `${uploader.name} · ` : ""}
            {format(parseISO(photo.created_at), "MMM d")}
          </p>
        </div>

        {photos.length > 1 ? (
          <div className="flex shrink-0 items-center gap-1.5" aria-hidden>
            {/* Capped: forty photos would otherwise become forty dots. */}
            {photos.slice(0, 8).map((p, i) => (
              <span key={p.id} className="photo-dot" data-active={i === safeIndex} />
            ))}
            {photos.length > 8 ? (
              <span className="ml-0.5 text-[10px] font-semibold text-white/70 tabular-nums">
                {safeIndex + 1}/{photos.length}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {photos.length > 1 ? (
        <>
          <CarouselArrow side="left" onClick={() => go(-1)} />
          <CarouselArrow side="right" onClick={() => go(1)} />
        </>
      ) : null}
    </div>
  );
}

function CarouselArrow({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous photo" : "Next photo"}
      className={`absolute top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-lg leading-none text-white backdrop-blur-sm transition-colors hover:bg-black/55 ${
        side === "left" ? "left-2" : "right-2"
      }`}
    >
      {side === "left" ? "\u2039" : "\u203a"}
    </button>
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
          <Carousel photos={photos} onOpen={setOpen} />
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
