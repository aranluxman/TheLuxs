"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { todayKey } from "@/lib/dates";
import type { ChoreExclusion, ChoreTemplate } from "@/lib/types";

/**
 * The chore roster itself: which jobs exist, and who is excused from each.
 * Changing an exclusion rewrites the chores that have not been done yet —
 * completed ones are left alone, because they are the household's record.
 */
export function useChoreSettings(ready = true) {
  const [templates, setTemplates] = useState<ChoreTemplate[]>([]);
  const [exclusions, setExclusions] = useState<ChoreExclusion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    const [t, x] = await Promise.all([
      supabase.from("family_chore_templates").select("*").order("sort_order"),
      supabase.from("family_chore_exclusions").select("*"),
    ]);

    if (t.error || x.error) {
      setError((t.error ?? x.error)!.message);
    } else {
      setTemplates((t.data ?? []) as ChoreTemplate[]);
      setExclusions((x.data ?? []) as ChoreExclusion[]);
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

  const isExcluded = useCallback(
    (templateId: string, memberId: string) =>
      exclusions.some((e) => e.template_id === templateId && e.member_id === memberId),
    [exclusions],
  );

  const toggleExclusion = useCallback(
    async (templateId: string, memberId: string, excluded: boolean) => {
      const supabase = getSupabase();
      setSaving(true);
      setError(null);

      // Optimistic, so the checkbox responds immediately.
      setExclusions((prev) =>
        excluded
          ? [...prev, { template_id: templateId, member_id: memberId }]
          : prev.filter((e) => !(e.template_id === templateId && e.member_id === memberId)),
      );

      const { error: err } = excluded
        ? await supabase
            .from("family_chore_exclusions")
            .upsert(
              { template_id: templateId, member_id: memberId },
              { onConflict: "template_id,member_id" },
            )
        : await supabase
            .from("family_chore_exclusions")
            .delete()
            .eq("template_id", templateId)
            .eq("member_id", memberId);

      if (err) {
        setError(err.message);
        await load();
        setSaving(false);
        return;
      }

      // Hand the upcoming chores out again under the new rules.
      const { error: rpcError } = await supabase.rpc("family_regenerate_future_chores", {
        p_from: todayKey(),
        p_days: 28,
      });
      if (rpcError) setError(rpcError.message);
      setSaving(false);
    },
    [load],
  );

  return { templates, exclusions, isExcluded, toggleExclusion, loading, saving, error, reload: load };
}
