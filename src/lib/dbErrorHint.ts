/**
 * Turns a Supabase / PostgREST error message into a hint the person looking at
 * the error screen can act on. The raw message is still shown above it; this
 * is only the "what to do about it" line, so it errs towards naming the place
 * to look rather than guessing at a fix.
 */
export type DbErrorKind = "key" | "schema" | "network" | "unknown";

export function classifyDbError(message: string): DbErrorKind {
  const m = message.toLowerCase();

  // Rejected before the request reaches Postgres: a deleted, rotated, mistyped
  // or other-project key. "Unregistered API key" is the publishable-key form;
  // the others come from the legacy JWT anon key.
  if (
    m.includes("api key") ||
    m.includes("apikey") ||
    m.includes("jwt") ||
    m.includes("jws") ||
    m.includes("invalid signature")
  ) {
    return "key";
  }

  // The key worked but the tables are not there: migrations have not been run.
  if (
    m.includes("does not exist") ||
    m.includes("could not find the table") ||
    m.includes("schema cache")
  ) {
    return "schema";
  }

  if (
    m.includes("failed to fetch") ||
    m.includes("load failed") ||
    m.includes("network")
  ) {
    return "network";
  }

  return "unknown";
}
