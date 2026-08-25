-- ============================================================================
--  Family Dashboard — let a chore change hands
--
--  0008 revoked UPDATE on `family_chore_ticks` outright, on the reasoning that
--  a tick is inserted or deleted and "someone else actually did it" is an
--  untick followed by a re-tick. That was right when a chore belonged to one
--  named person and the tick was a yes/no.
--
--  The board is a scoreboard now: chores are unassigned, and you record who
--  did one by tapping their face on the card. Correcting a mis-tap is
--  therefore an ordinary, frequent action rather than a rare repair — and as
--  two statements it is a delete that can succeed followed by an insert that
--  fails, which loses the tick altogether and takes a point off somebody who
--  earned it.
--
--  One `insert … on conflict do update` cannot half-happen. So UPDATE comes
--  back, narrowed to the two columns that describe who gets the point:
--
--    done_by   the new owner
--    done_at   re-stamped, because the row now records a different event
--
--  `chore_key` and `period_key` stay unwritable. They are the primary key —
--  making them mutable would let one statement move a tick onto a different
--  chore, or into a different day or week, which is how a score gets
--  fabricated after the fact.
--
--  Idempotent: safe to re-run.
-- ============================================================================

-- Re-attribution is a real update, so it needs a policy as well as the grant;
-- 0008 deliberately left the table with none.
drop policy if exists family_chore_ticks_reassign on public.family_chore_ticks;
create policy family_chore_ticks_reassign on public.family_chore_ticks
  for update to anon, authenticated using (true) with check (true);

-- The grant is the part Postgres actually enforces. Column-level, so the
-- policy above cannot be talked into moving a row between periods.
grant update (done_by, done_at) on public.family_chore_ticks
  to anon, authenticated;
