import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * These are inlined at build time. If the build ran without them we still want
 * a page that loads and explains itself, rather than a white screen, so the
 * client is created lazily and the app checks this flag first.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY, then rebuild.",
    );
  }
  client ??= createClient(url!, anonKey!, {
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return client;
}
