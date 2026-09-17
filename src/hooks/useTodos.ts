"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Todo } from "@/lib/types";

/**
 * Add one task, without subscribing to the board.
 *
 * The hook below uses this, and so does the chat's "make this a task" button —
 * which needs to create a todo but has no use for the list, and should not open
 * a second Realtime subscription to get one. Realtime carries the new row to
 * anyone who does have the board open.
 */
export async function createTodo(
  title: string,
  assigneeIds: string[],
  dueOn: string | null,
  createdBy: string | null,
  estimateMinutes: number | null = null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = title.trim();
  if (!trimmed) return { ok: false, error: "A task needs a name." };
  if (!isSupabaseConfigured) return { ok: false, error: "Not connected." };

  const { error } = await getSupabase().from("family_todos").insert({
    title: trimmed.slice(0, 140),
    assignee_ids: assigneeIds,
    due_on: dueOn || null,
    estimate_minutes: estimateMinutes,
    created_by: createdBy,
  });

  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * The To Do's board.
 *
 * Deliberately the same shape as `useShopping`: load once, keep in step over
 * Realtime, write optimistically. The two features are the same problem — a
 * shared list of things, ticked off by whoever gets to them — and having them
 * behave differently would be a difference with no reason behind it.
 *
 * `done_at` is the whole state machine. Ticking never deletes, so unticking is
 * free and a finished board is a record of the week rather than a blank screen.
 */
export function useTodos(ready = true) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error: err } = await getSupabase()
      .from("family_todos")
      .select("*")
      .order("created_at");

    if (err) setError(err.message);
    else {
      setTodos((data ?? []) as Todo[]);
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
      .channel("family-todos")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "family_todos" },
        (payload) => {
          const row = payload.new as Todo;
          // Whoever added it already has it locally; do not double up.
          setTodos((prev) => (prev.some((t) => t.id === row.id) ? prev : [...prev, row]));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "family_todos" },
        (payload) => {
          const row = payload.new as Todo;
          setTodos((prev) => prev.map((t) => (t.id === row.id ? row : t)));
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "family_todos" },
        (payload) => {
          // Needs FULL replica identity, which migration 0014 sets.
          const row = payload.old as Partial<Todo>;
          if (!row.id) return;
          setTodos((prev) => prev.filter((t) => t.id !== row.id));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ready]);

  /**
   * @param assigneeIds who it is for. Empty is the whole house.
   * @returns the new task's id, or null if it did not save. The id is what
   *          lets the board highlight where the task actually landed — it
   *          sorts by due date, so it is rarely at the bottom of the list.
   */
  const addTodo = useCallback(
    async (
      title: string,
      assigneeIds: string[],
      dueOn: string | null,
      createdBy: string | null,
      estimateMinutes: number | null = null,
    ) => {
      const trimmed = title.trim();
      if (!trimmed) return null;

      const { data, error: err } = await getSupabase()
        .from("family_todos")
        .insert({
          title: trimmed.slice(0, 140),
          assignee_ids: assigneeIds,
          due_on: dueOn || null,
          estimate_minutes: estimateMinutes,
          created_by: createdBy,
        })
        .select()
        .single();

      if (err) {
        setError(err.message);
        return null;
      }
      const row = data as Todo;
      setTodos((prev) => (prev.some((t) => t.id === row.id) ? prev : [...prev, row]));
      return row.id;
    },
    [],
  );

  /**
   * Tick or untick, written optimistically: the whole interaction is one tap,
   * and a round trip's worth of lag makes a checklist feel broken.
   */
  const setDone = useCallback(
    async (id: string, done: boolean, byMemberId: string | null) => {
      const previous = todos.find((t) => t.id === id);
      if (!previous) return;

      const patch = done
        ? { done_at: new Date().toISOString(), done_by: byMemberId }
        : { done_at: null, done_by: null };

      setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

      const { data, error: err } = await getSupabase()
        .from("family_todos")
        .update(patch)
        .eq("id", id)
        .select()
        .maybeSingle();

      if (err || !data) {
        setTodos((prev) => prev.map((t) => (t.id === id ? previous : t)));
        setError(err?.message ?? "That did not save.");
        return;
      }
      setTodos((prev) => prev.map((t) => (t.id === id ? (data as Todo) : t)));
    },
    [todos],
  );

  /**
   * Edit a task in place.
   *
   * Only the four fields a person can see and change on the card; `created_by`
   * and `created_at` are deliberately absent, and migration 0015's column
   * grants are what actually enforce that. Not optimistic: an edit is a
   * considered action behind a form with a Save button, so there is nothing to
   * hide a round trip behind, and showing an un-saved title as saved is worse
   * than a moment's wait.
   */
  const editTodo = useCallback(
    async (
      id: string,
      patch: {
        title?: string;
        assignee_ids?: string[];
        due_on?: string | null;
        estimate_minutes?: number | null;
      },
    ) => {
      const clean: Record<string, unknown> = { ...patch };
      if (typeof patch.title === "string") {
        const trimmed = patch.title.trim();
        if (!trimmed) {
          setError("A task needs a name.");
          return false;
        }
        clean.title = trimmed.slice(0, 140);
      }

      const { data, error: err } = await getSupabase()
        .from("family_todos")
        .update(clean)
        .eq("id", id)
        .select()
        .maybeSingle();

      if (err || !data) {
        setError(err?.message ?? "That did not save.");
        return false;
      }
      setTodos((prev) => prev.map((t) => (t.id === id ? (data as Todo) : t)));
      setError(null);
      return true;
    },
    [],
  );

  const removeTodo = useCallback(async (id: string) => {
    const { error: err } = await getSupabase().from("family_todos").delete().eq("id", id);
    if (err) {
      setError(err.message);
      return;
    }
    setTodos((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /** Clears the finished section once the week is over. */
  const clearDone = useCallback(async () => {
    const finished = todos.filter((t) => t.done_at).map((t) => t.id);
    if (finished.length === 0) return;

    const { error: err } = await getSupabase()
      .from("family_todos")
      .delete()
      .in("id", finished);
    if (err) {
      setError(err.message);
      return;
    }
    setTodos((prev) => prev.filter((t) => !t.done_at));
  }, [todos]);

  return {
    todos,
    loading,
    error,
    addTodo,
    editTodo,
    setDone,
    removeTodo,
    clearDone,
    reload: load,
  };
}
