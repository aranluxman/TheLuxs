"use client";

import { useChoreSettings } from "@/hooks/useChoreSettings";
import { useFamily } from "./FamilyProvider";
import { Avatar, Button, ErrorNote, Modal } from "./ui";

/**
 * Who does what. Unticking someone takes them out of that chore's rotation
 * entirely — the remaining people then share it evenly, rather than the job
 * being skipped on their turn.
 */
export function ChoreSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { members } = useFamily();
  const { templates, isExcluded, toggleExclusion, saving, error } = useChoreSettings(open);

  return (
    <Modal open={open} onClose={onClose} title="Who does which chore">
      <ErrorNote message={error} />
      <p className="text-muted mb-4 text-xs">
        Untick anyone who shouldn&rsquo;t be given a job. The rest of the household
        keeps rotating through it. Chores already ticked off stay as they are.
      </p>

      <div className="space-y-4">
        {templates.map((t) => (
          <div key={t.id} className="border-line rounded-2xl border p-3">
            <div className="mb-2.5 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">{t.title}</h3>
              <span className="text-faint text-[11px] capitalize">
                {t.recurrence_type === "weekly" ? "once a week" : "every day"}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const excluded = isExcluded(t.id, m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => toggleExclusion(t.id, m.id, !excluded)}
                    disabled={saving}
                    aria-pressed={!excluded}
                    className={`flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-xs font-medium transition-opacity disabled:opacity-50 ${
                      excluded ? "bg-sunk text-faint line-through" : "bg-sunk text-ink"
                    }`}
                    title={excluded ? `${m.name} is excused` : `${m.name} is in the rotation`}
                  >
                    <span className={excluded ? "opacity-40 grayscale" : ""}>
                      <Avatar member={m} size="sm" />
                    </span>
                    {m.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={onClose} disabled={saving}>
          {saving ? "Updating rota…" : "Done"}
        </Button>
      </div>
    </Modal>
  );
}
