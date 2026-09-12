"use client";

import { useMemo, useRef, useState } from "react";
import { useShopping } from "@/hooks/useShopping";
import { format, parseISO } from "@/lib/dates";
import type { ShoppingItem } from "@/lib/types";
import { useFamily } from "./FamilyProvider";
import { Avatar, Button, Card, EmptyState, ErrorNote, SectionTitle, inputClass } from "./ui";

/* --------------------------------------------------------------------- Row */

function ItemRow({
  item,
  done,
  onToggle,
  onRemove,
}: {
  item: ShoppingItem;
  done: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { byId } = useFamily();
  const adder = item.added_by ? byId[item.added_by] : null;
  const ticker = item.completed_by ? byId[item.completed_by] : null;

  return (
    <li
      className="tick-row group hover:bg-sunk/50 flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors"
      data-done={done}
    >
      {/* The whole row up to the delete button is the checkbox's label, so the
          tap target is the width of the screen rather than a 20px square —
          this gets used one-handed, pushing a trolley. */}
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
        {/* A real checkbox, only visually replaced: it keeps the keyboard
            behaviour, the label association and the screen-reader semantics
            that a div dressed up as a tick box would have to reimplement and
            would get subtly wrong. */}
        <input
          type="checkbox"
          checked={done}
          onChange={onToggle}
          className="peer sr-only"
        />
        <span
          className="tick-box peer-focus-visible:ring-accent/50 peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2"
          data-done={done}
          aria-hidden
        >
          <svg viewBox="0 0 24 24">
            <path d="M5 12.5 10 17.5 19 7" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`tick-label block truncate text-sm ${
              done ? "text-faint line-through" : "font-medium"
            }`}
          >
            {item.name}
          </span>
          <span className="text-faint block truncate text-xs">
            {item.note ? `${item.note} · ` : ""}
            {done && ticker
              ? `got by ${ticker.name}${
                  item.completed_at ? ` · ${format(parseISO(item.completed_at), "MMM d")}` : ""
                }`
              : adder
                ? `added by ${adder.name}`
                : ""}
          </span>
        </span>
      </label>

      {/* The avatar is warmth, not information — "added by Mum" is already in
          the line above — so it is the first thing to go when space is tight. */}
      {adder ? (
        <span className="hidden shrink-0 opacity-70 sm:block">
          <Avatar member={adder} size="sm" />
        </span>
      ) : null}

      {/* Always visible rather than revealed on hover: there is no hover on a
          phone, and this list is used almost entirely on phones. */}
      <button
        onClick={onRemove}
        aria-label={`Remove ${item.name} from the list`}
        className="text-faint hover:bg-danger-soft hover:text-danger grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg leading-none transition-colors"
      >
        ×
      </button>
    </li>
  );
}

/* --------------------------------------------------------------------- Tab */

export function ShoppingTab() {
  const { currentMember } = useFamily();
  const { items, loading, error, addItem, setDone, removeItem, clearCompleted } = useShopping();

  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const { toBuy, done } = useMemo(() => {
    const open: ShoppingItem[] = [];
    const finished: ShoppingItem[] = [];
    for (const i of items) (i.completed_at ? finished : open).push(i);
    // Open items oldest first — the order they were thought of. Completed
    // items most recently ticked first, so the last thing you grabbed is on top.
    open.sort((a, b) => a.created_at.localeCompare(b.created_at));
    finished.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
    return { toBuy: open, done: finished };
  }, [items]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const ok = await addItem(name, note, currentMember?.id ?? null);
    setSaving(false);
    if (ok) {
      setName("");
      setNote("");
      // Straight back to the field: a list is written in a burst, not one
      // item per visit.
      nameRef.current?.focus();
    }
  }

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />

      <div>
        <p className="text-accent text-[11px] font-bold tracking-[0.14em] uppercase">
          Costco run
        </p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight">Shopping list</h2>
        <p className="text-muted mt-0.5 text-sm">
          Shared with everyone. Tick things off as you go and they move to Got it.
        </p>
      </div>

      {/* ------------------------------------------------------------- add */}
      <Card className="p-3 sm:p-4">
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="shop-name" className="sr-only">
            What do we need?
          </label>
          <input
            id="shop-name"
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What do we need?"
            maxLength={120}
            className={`${inputClass} min-h-11 flex-1`}
          />
          <label htmlFor="shop-note" className="sr-only">
            How many, or any note
          </label>
          {/* Quantity and Add share a row on a phone; the item name gets the
              full width because it is the part people actually type. */}
          <div className="flex gap-2">
            <input
              id="shop-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="How many?"
              maxLength={80}
              className={`${inputClass} min-h-11 flex-1 sm:w-32 sm:flex-none`}
            />
            <Button type="submit" disabled={saving || !name.trim()} className="shrink-0">
              {saving ? "Adding…" : "Add"}
            </Button>
          </div>
        </form>
      </Card>

      {/* ---------------------------------------------------------- to buy */}
      <section>
        <SectionTitle>
          To buy{toBuy.length ? ` · ${toBuy.length}` : ""}
        </SectionTitle>
        <Card>
          {loading ? (
            <div className="space-y-2 p-3" aria-label="Loading the list" role="status">
              <span className="skeleton block h-9 w-full rounded-xl" />
              <span className="skeleton block h-9 w-4/5 rounded-xl" />
            </div>
          ) : toBuy.length === 0 && done.length > 0 ? (
            /* Cleared, rather than never started. Ticking the last thing off a
               shop is the one genuine moment of completion in this app, and an
               empty state that says "Nothing on the list" reads as though the
               list were never there. */
            <div className="tick-cleared flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span
                className="bg-accent grid h-14 w-14 place-items-center rounded-full"
                aria-hidden
              >
                <svg viewBox="0 0 24 24" className="h-7 w-7" style={{ fill: "none" }}>
                  <path
                    d="M5 12.5 10 17.5 19 7"
                    style={{
                      stroke: "var(--color-on-ink)",
                      strokeWidth: 3,
                      strokeLinecap: "round",
                      strokeLinejoin: "round",
                    }}
                  />
                </svg>
              </span>
              <p className="text-base font-semibold">That&rsquo;s everything</p>
              <p className="text-muted text-xs">
                {done.length} {done.length === 1 ? "thing" : "things"} picked up. Nice one.
              </p>
            </div>
          ) : toBuy.length === 0 ? (
            <EmptyState
              icon="🛒"
              title="Nothing on the list"
              hint="Add what you need above and it appears on everyone's phone."
            />
          ) : (
            <ul className="p-2">
              {toBuy.map((i) => (
                <ItemRow
                  key={i.id}
                  item={i}
                  done={false}
                  onToggle={() => void setDone(i.id, true, currentMember?.id ?? null)}
                  onRemove={() => void removeItem(i.id)}
                />
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* -------------------------------------------------------- completed */}
      {done.length > 0 ? (
        <section>
          <div className="mb-1 flex items-center justify-between gap-2">
            {/* Collapsed by default: the point of ticking something off is that
                it stops competing for attention with what is still needed. */}
            <button
              onClick={() => setShowDone((v) => !v)}
              aria-expanded={showDone}
              className="text-muted hover:text-ink flex items-center gap-1.5 text-[11px] font-bold tracking-[0.14em] uppercase"
            >
              <span aria-hidden className={showDone ? "" : "-rotate-90"}>
                ▾
              </span>
              Got it · {done.length}
            </button>
            {showDone ? (
              <button
                onClick={() => void clearCompleted()}
                className="text-faint hover:text-danger text-xs font-medium"
              >
                Clear
              </button>
            ) : null}
          </div>

          {showDone ? (
            <Card>
              <ul className="p-2">
                {done.map((i) => (
                  <ItemRow
                    key={i.id}
                    item={i}
                    done
                    onToggle={() => void setDone(i.id, false, currentMember?.id ?? null)}
                    onRemove={() => void removeItem(i.id)}
                  />
                ))}
              </ul>
            </Card>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
