"use client";

import { useRef, useState } from "react";
import { downscaleImage } from "@/lib/image";
import { MEMBER_COLORS, MEMBER_EMOJI } from "@/lib/palette";
import { useFamily } from "./FamilyProvider";
import { Avatar, Button, ErrorNote, Field, Modal, inputClass } from "./ui";

/**
 * Edit who you are: photo, name, colour, fallback emoji. Any member can be
 * edited from here — it doubles as the household's roster admin, which is why
 * there is a person switcher at the top.
 */
export function ProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { members, currentMember, updateMember, setMemberPhoto, clearMemberPhoto } =
    useFamily();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const target = members.find((m) => m.id === (editingId ?? currentMember?.id)) ?? null;

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !target) return;

    setError(null);
    setBusy(true);
    const shrunk = await downscaleImage(file, 640);
    const err = await setMemberPhoto(target.id, shrunk);
    if (err) setError(err);
    setBusy(false);
  }

  async function patch(field: "name" | "color" | "avatar_emoji", value: string) {
    if (!target) return;
    setError(null);
    const err = await updateMember(target.id, { [field]: value });
    if (err) setError(err);
  }

  return (
    <Modal open={open} onClose={onClose} title="Profiles">
      <ErrorNote message={error} />

      <div className="mb-5 flex flex-wrap gap-2">
        {members.map((m) => (
          <button
            key={m.id}
            onClick={() => setEditingId(m.id)}
            className={`flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm transition-colors ${
              target?.id === m.id ? "bg-sunk font-medium" : "hover:bg-sunk"
            }`}
          >
            <Avatar member={m} size="sm" />
            {m.name}
          </button>
        ))}
      </div>

      {target ? (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <Avatar member={target} size="lg" ring />
            <div className="flex flex-col gap-1.5">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={pickPhoto}
                className="hidden"
                aria-hidden
                tabIndex={-1}
              />
              <Button
                variant="ghost"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="py-1.5"
              >
                {busy ? "Uploading…" : target.avatar_url ? "Change photo" : "Upload a photo"}
              </Button>
              {target.avatar_url ? (
                <button
                  onClick={async () => {
                    setBusy(true);
                    const err = await clearMemberPhoto(target.id);
                    if (err) setError(err);
                    setBusy(false);
                  }}
                  className="text-faint hover:text-ink text-xs"
                >
                  Remove photo
                </button>
              ) : (
                <span className="text-faint text-xs">
                  Photos are resized and kept in private storage.
                </span>
              )}
            </div>
          </div>

          <Field label="Name">
            <input
              defaultValue={target.name}
              key={`name-${target.id}`}
              maxLength={40}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== target.name) void patch("name", v);
              }}
              className={inputClass}
            />
          </Field>

          <Field label="Colour" hint="Used for their calendar entries and chat bubbles.">
            <div className="flex flex-wrap gap-2">
              {MEMBER_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => void patch("color", c)}
                  className="h-7 w-7 rounded-full transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    boxShadow:
                      target.color === c ? "0 0 0 2px white, 0 0 0 4px currentColor" : undefined,
                  }}
                  aria-label={`Use colour ${c}`}
                  aria-pressed={target.color === c}
                />
              ))}
            </div>
          </Field>

          <Field label="Fallback emoji" hint="Shown when there's no photo.">
            <div className="flex flex-wrap gap-1.5">
              {MEMBER_EMOJI.map((e) => (
                <button
                  key={e}
                  onClick={() => void patch("avatar_emoji", e)}
                  className={`h-8 w-8 rounded-lg text-lg ${
                    target.avatar_emoji === e ? "bg-sunk ring-ink ring-2" : "hover:bg-sunk"
                  }`}
                  aria-pressed={target.avatar_emoji === e}
                >
                  {e}
                </button>
              ))}
            </div>
          </Field>
        </div>
      ) : null}

      <div className="mt-6 flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}
