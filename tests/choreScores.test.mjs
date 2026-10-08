import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync('src/lib/choreScores.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleExports = {};
new Function('exports', compiled)(moduleExports);
const { choreYearWindow, annualChoreScores } = moduleExports;
const tick = (done_at, points = 1, done_by = 'member') => ({ done_at, points, done_by });

test('points accumulate across weeks, with weighted points and legacy defaults', () => {
  const { start, end } = choreYearWindow(new Date(2026, 6, 1));
  assert.deepEqual(annualChoreScores([
    tick(new Date(2026, 0, 5).toISOString(), 2),
    tick(new Date(2026, 5, 10).toISOString(), null),
    tick(new Date(2026, 6, 1).toISOString(), 1, null),
  ], start, end), { member: 3 });
});

test('January 1 resets scores even when ISO week spans the year boundary', () => {
  const before = choreYearWindow(new Date(2026, 11, 31, 23, 59, 59));
  const after = choreYearWindow(new Date(2027, 0, 1));
  const ticks = [tick(before.start, 2), tick(new Date(2026, 11, 31, 23, 59, 59).toISOString()), tick(after.start, 2), tick(after.end, 10)];
  assert.deepEqual(annualChoreScores(ticks, before.start, before.end), { member: 3 });
  assert.deepEqual(annualChoreScores(ticks, after.start, after.end), { member: 2 });
  assert.equal(after.year, 2027);
});

test('annual totals include more than 1000 chores', () => {
  const { start, end } = choreYearWindow(new Date(2026, 0, 1));
  assert.deepEqual(annualChoreScores(Array.from({ length: 2001 }, () => tick(start)), start, end), { member: 2001 });
});

test('Supabase query requests the calendar year plus the active weekend period', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const { start, end } = choreYearWindow(new Date(2027, 0, 1));
  let requested;
  const client = createClient('https://example.supabase.co', 'test-publishable-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url) => {
      requested = new URL(url);
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  const result = await client.from('family_chore_ticks').select('*')
    .or(`and(done_at.gte.${start},done_at.lt.${end}),period_key.eq.2026-W53`)
    .order('id').range(1000, 1999);
  assert.equal(result.error, null);
  assert.equal(requested.searchParams.get('or'), `(and(done_at.gte.${start},done_at.lt.${end}),period_key.eq.2026-W53)`);
  assert.equal(requested.searchParams.get('offset'), '1000');
  assert.equal(requested.searchParams.get('limit'), '1000');
});
