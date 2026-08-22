"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { MEMBER_COLORS, MEMBER_EMOJI } from "@/lib/palette";
import { useFamily } from "./FamilyProvider";
import { Button, ErrorNote, inputClass } from "./ui";

interface Draft {
  name: string;
  avatar_emoji: string;
  color: string;
}

const blank = (i: number): Draft => ({
  name: "",
  avatar_emoji: MEMBER_EMOJI[i % MEMBER_EMOJI.length],
  color: MEMBER_COLORS[i % MEMBER_COLORS.length],
});

/**
 * First run. Rather than shipping five fake people in the migration, the
 * family names itself here — then the rotation engine has an ordering to work
 * with and can generate the first fortnight of chores.
 */
export function SetupScreen() {
  const { reloadMembers, setCurrentMemberId } = useFamily();
  const [drafts, setDrafts] = useState<Draft[]>(() => [0, 1, 2, 3, 4].map(blank));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const named = drafts.filter((d) => d.name.trim().length > 0);

  async function save() {
    if (named.length < 2) {
      setError("Add at least two people so chores have someone to rotate between.");
      return;
    }
    setSaving(true);
    setError(null);

    const supabase = getSupabase();
    const { error: insertError } = await supabase.from("family_members").insert(
      named.map((d, i) => ({
        name: d.name.trim(),
        avatar_emoji: d.avatar_emoji,
        color: d.color,
        sort_order: i + 1,
      })),
    );

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    // Now that there is a roster, lay down the first four weeks of chores.
    const { error: rpcError } = await supabase.rpc("family_generate_chores", { p_days: 28 });
    if (rpcError) setError(rpcError.message);

    await reloadMembers();
    setCurrentMemberId(null); // straight into "who are you?"
    setSaving(false);
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12">
      <h1 className="text-2xl font-semibold">Set up your family</h1>
      <p className="text-muted mt-2 text-sm">
        Add everyone in the house. Chores rotate through this list in order, so whoever
        is first here starts the roster.
      </p>

      <div className="mt-8 space-y-3">
        {drafts.map((d, i) => (
          <div key={i} className="border-line bg-surface flex items-center gap-3 rounded-2xl border p-3">
            <select
              value={d.avatar_emoji}
              onChange={(e) => update(i, { avatar_emoji: e.target.value })}
              className="border-line h-11 w-14 rounded-xl border text-center text-lg"
              aria-label={`Avatar for person ${i + 1}`}
            >
              {MEMBER_EMOJI.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>

            <input
              value={d.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder={`Person ${i + 1}`}
              maxLength={40}
              className={inputClass}
              aria-label={`Name for person ${i + 1}`}
            />

            <div className="flex shrink-0 gap-1">
              {MEMBER_COLORS.slice(0, 5).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => update(i, { color: c })}
                  className="h-6 w-6 rounded-full transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    boxShadow: d.color === c ? "0 0 0 2px white, 0 0 0 4px currentColor" : undefined,
                  }}
                  aria-label={`Colour ${c} for person ${i + 1}`}
                  aria-pressed={d.color === c}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setDrafts((prev) => [...prev, blank(prev.length)])}
        className="text-muted hover:text-ink mt-3 text-sm"
      >
        + Add another person
      </button>

      <div className="mt-8">
        <ErrorNote message={error} />
        <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
          {saving ? "Setting up…" : `Create ${named.length || 0} profiles`}
        </Button>
      </div>
    </main>
  );
}
