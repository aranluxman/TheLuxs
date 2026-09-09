"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { ShoppingItem } from "@/lib/types";

/**
 * The shared shopping list.
 *
 * One list for the household, kept in step across phones over Realtime — the
 * point of the feature is that ticking the milk in aisle four greys it out on
 * everyone else's screen before they double back for it.
 *
 * `completed_at` is the entire state machine: null is still to buy, set is
 * done, and clearing it puts the item back. Nothing is deleted on tick, so
 * undo is free and the completed section is a real record of the trip.
 */
export function useShopping(ready = true) {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error: err } = await getSupabase()
      .from("family_shopping_items")
      .select("*")
      .order("created_at");

    if (err) setError(err.message);
    else {
      setItems((data ?? []) as ShoppingItem[]);
      setError(null);
    }
    setLoading(false);
  }, []);

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
    if (!isSupabaseConfigured || !ready) return;
    const supabase = getSupabase();
    const channel = supabase
      .channel("family-shopping")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "family_shopping_items" },
        (payload) => {
          const row = payload.new as ShoppingItem;
          // The adder already has it locally; do not double up.
          setItems((prev) => (prev.some((i) => i.id === row.id) ? prev : [...prev, row]));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "family_shopping_items" },
        (payload) => {
          const row = payload.new as ShoppingItem;
          setItems((prev) => prev.map((i) => (i.id === row.id ? row : i)));
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "family_shopping_items" },
        (payload) => {
          // Needs FULL replica identity, which migration 0007 sets.
          const row = payload.old as Partial<ShoppingItem>;
          if (!row.id) return;
          setItems((prev) => prev.filter((i) => i.id !== row.id));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ready]);

  const addItem = useCallback(
    async (name: string, note: string, addedBy: string | null) => {
      const trimmed = name.trim();
      if (!trimmed) return false;

      const { data, error: err } = await getSupabase()
        .from("family_shopping_items")
        .insert({
          name: trimmed.slice(0, 120),
          note: note.trim() ? note.trim().slice(0, 80) : null,
          added_by: addedBy,
        })
        .select()
        .single();

      if (err) {
        setError(err.message);
        return false;
      }
      const row = data as ShoppingItem;
      setItems((prev) => (prev.some((i) => i.id === row.id) ? prev : [...prev, row]));
      return true;
    },
    [],
  );

  /**
   * Tick or untick. Written optimistically because the whole interaction is
   * one tap while walking, and a round trip's worth of lag on a supermarket
   * connection makes the list feel broken.
   */
  const setDone = useCallback(
    async (id: string, done: boolean, byMemberId: string | null) => {
      const previous = items.find((i) => i.id === id);
      if (!previous) return;

      const patch = done
        ? { completed_at: new Date().toISOString(), completed_by: byMemberId }
        : { completed_at: null, completed_by: null };

      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

      const { data, error: err } = await getSupabase()
        .from("family_shopping_items")
        .update(patch)
        .eq("id", id)
        .select()
        .maybeSingle();

      if (err || !data) {
        setItems((prev) => prev.map((i) => (i.id === id ? previous : i)));
        setError(err?.message ?? "That did not save.");
        return;
      }
      setItems((prev) => prev.map((i) => (i.id === id ? (data as ShoppingItem) : i)));
    },
    [items],
  );

  const removeItem = useCallback(async (id: string) => {
    const { error: err } = await getSupabase()
      .from("family_shopping_items")
      .delete()
      .eq("id", id);
    if (err) {
      setError(err.message);
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  /** Clears the completed section — the "trip is over" button. */
  const clearCompleted = useCallback(async () => {
    const done = items.filter((i) => i.completed_at).map((i) => i.id);
    if (done.length === 0) return;

    const { error: err } = await getSupabase()
      .from("family_shopping_items")
      .delete()
      .in("id", done);
    if (err) {
      setError(err.message);
      return;
    }
    setItems((prev) => prev.filter((i) => !i.completed_at));
  }, [items]);

  return { items, loading, error, addItem, setDone, removeItem, clearCompleted, reload: load };
}
