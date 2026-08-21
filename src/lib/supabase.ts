import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

/**
 * Supabase is moving from the legacy JWT `anon` key to `sb_publishable_…` keys.
 * Both work here; the publishable one wins if both are set. Each branch names
 * `process.env.X` statically because that is what lets Next inline the value at
 * build time — a computed lookup would come back undefined in the browser.
 */
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * These are inlined at build time. If the build ran without them we still want
 * a page that loads and explains itself, rather than a white screen, so the
 * client is created lazily and the app checks this flag first.
 */
export const isSupabaseConfigured = Boolean(url && key);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then rebuild.",
    );
  }
  client ??= createClient(url!, key!, {
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return client;
}
