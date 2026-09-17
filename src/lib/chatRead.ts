/**
 * "I have seen everything in this thread up to here" — one mark per member per
 * conversation, so the chat can show a dot on the conversations that have
 * moved on without you.
 *
 * Device-local by design. There is nowhere to put it that isn't: a `last_read`
 * column would be a per-member row that anyone holding the publishable key
 * could rewrite, and the app has no login to tie it to. The consequence is
 * visible and worth knowing: clearing a dot on the kitchen tablet leaves it lit
 * on your phone. The README says so, because it otherwise reads as a bug.
 *
 * Scoped by member id *inside* one storage key rather than by key-per-member.
 * The tablet in the kitchen is shared and people switch profiles on it; a flat
 * key would hand the next person the previous person's read state.
 */

export const CHAT_READ_KEY = "family-dashboard:chat-read";

/** `{ [memberId]: { [conversationKey]: newest created_at seen } }` */
type ReadMarks = Record<string, Record<string, string>>;

function readAll(): ReadMarks {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CHAT_READ_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as ReadMarks) : {};
  } catch {
    // Private mode, or someone else's JSON in our key. Dots simply come back.
    return {};
  }
}

export function readLastRead(memberId: string | null): Record<string, string> {
  if (!memberId) return {};
  return readAll()[memberId] ?? {};
}

/**
 * @param at the newest message's `created_at`, never `Date.now()`. These marks
 *           are compared against server timestamps, and a tablet whose clock
 *           runs forty seconds fast would mark threads read before the
 *           messages arrived and never show a dot again.
 */
export function writeLastRead(
  memberId: string,
  conversationKey: string,
  at: string,
): void {
  try {
    const all = readAll();
    const mine = all[memberId] ?? {};
    // Marks only ever move forward. Two tabs racing must not rewind one.
    if (mine[conversationKey] && mine[conversationKey] >= at) return;
    all[memberId] = { ...mine, [conversationKey]: at };
    window.localStorage.setItem(CHAT_READ_KEY, JSON.stringify(all));
  } catch {
    // Quota or private mode: the dot stays until the thread is opened again.
  }
}