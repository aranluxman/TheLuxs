// Fetches and parses iCalendar feeds, merging every household member's
// calendar into `family_calendar_entries`.
//
// This runs server-side for two reasons: calendar providers almost never send
// CORS headers, so the browser cannot fetch a webcal URL directly; and
// recurrence expansion needs a real RRULE implementation.
//
// POST body — one of:
//   { "feed_id": "<uuid>" }                       re-sync a stored feed
//   { "member_id": "<uuid>", "name": "...",       import pasted .ics text
//     "ics": "BEGIN:VCALENDAR..." }               (stored as a one-off feed)
//   { "sync_all": true }                          re-sync every active URL feed

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import ICAL from "https://esm.sh/ical.js@2.2.0";

const WINDOW_BACK_DAYS = 30;
const WINDOW_FORWARD_DAYS = 365;
/** Guards against a malformed infinite RRULE. */
const MAX_OCCURRENCES_PER_EVENT = 400;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ParsedEvent {
  uid: string;
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  location: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** webcal:// is just https:// with a different scheme sticker on it. */
function normaliseUrl(raw: string): string {
  return raw.trim().replace(/^webcal:\/\//i, "https://");
}

function parseIcs(ics: string, from: Date, to: Date): ParsedEvent[] {
  const comp = new ICAL.Component(ICAL.parse(ics));
  const out: ParsedEvent[] = [];

  for (const vevent of comp.getAllSubcomponents("vevent")) {
    let event: InstanceType<typeof ICAL.Event>;
    try {
      event = new ICAL.Event(vevent);
    } catch {
      continue; // malformed VEVENT — skip rather than fail the whole feed
    }
    if (!event.startDate) continue;

    const uid = event.uid ?? `${event.summary ?? "event"}-${event.startDate.toUnixTime()}`;
    const title = (event.summary ?? "(untitled)").slice(0, 120);
    const location = event.location ? String(event.location).slice(0, 200) : null;
    const allDay = Boolean(event.startDate.isDate);

    if (!event.isRecurring()) {
      const start = event.startDate.toJSDate();
      if (start >= from && start <= to) {
        out.push({
          uid,
          title,
          start,
          end: event.endDate ? event.endDate.toJSDate() : null,
          allDay,
          location,
        });
      }
      continue;
    }

    // Expand the series, but only across the window we actually display.
    const iterator = event.iterator();
    let count = 0;
    for (let next = iterator.next(); next; next = iterator.next()) {
      if (++count > MAX_OCCURRENCES_PER_EVENT) break;
      const start = next.toJSDate();
      if (start > to) break;
      if (start < from) continue;

      let end: Date | null = null;
      try {
        end = event.getOccurrenceDetails(next).endDate?.toJSDate() ?? null;
      } catch {
        end = null;
      }
      out.push({ uid, title, start, end, allDay, location });
    }
  }

  return out;
}

async function syncFeed(
  supabase: ReturnType<typeof createClient>,
  feed: { id: string; member_id: string | null; url: string },
  icsOverride?: string,
): Promise<{ feed_id: string; count: number; error?: string }> {
  const from = new Date(Date.now() - WINDOW_BACK_DAYS * 86_400_000);
  const to = new Date(Date.now() + WINDOW_FORWARD_DAYS * 86_400_000);

  let events: ParsedEvent[];
  try {
    let ics = icsOverride;
    if (!ics) {
      const res = await fetch(normaliseUrl(feed.url), {
        headers: { Accept: "text/calendar, text/plain, */*" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`Feed responded ${res.status} ${res.statusText}`);
      ics = await res.text();
    }
    if (!ics.includes("BEGIN:VCALENDAR")) {
      throw new Error("That doesn't look like an iCalendar feed.");
    }
    events = parseIcs(ics, from, to);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase
      .from("family_calendar_feeds")
      .update({ last_error: message.slice(0, 500), last_synced_at: new Date().toISOString() })
      .eq("id", feed.id);
    return { feed_id: feed.id, count: 0, error: message };
  }

  // Replace this feed's slice of the window wholesale. Simpler than diffing,
  // and correct when events are cancelled upstream.
  await supabase
    .from("family_calendar_entries")
    .delete()
    .eq("source_feed_id", feed.id)
    .gte("start_time", from.toISOString())
    .lte("start_time", to.toISOString());

  // One UID can legitimately recur; de-dupe on (uid, start) to match the index.
  const seen = new Set<string>();
  const rows = events
    .filter((e) => {
      const key = `${e.uid}|${e.start.toISOString()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((e) => ({
      member_id: feed.member_id,
      title: e.title,
      start_time: e.start.toISOString(),
      end_time: e.end ? e.end.toISOString() : null,
      category: "imported",
      source_feed_id: feed.id,
      source_uid: e.uid.slice(0, 500),
      all_day: e.allDay,
    }));

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from("family_calendar_entries")
      .insert(rows.slice(i, i + 500));
    if (error) {
      await supabase
        .from("family_calendar_feeds")
        .update({ last_error: error.message.slice(0, 500) })
        .eq("id", feed.id);
      return { feed_id: feed.id, count: 0, error: error.message };
    }
  }

  await supabase
    .from("family_calendar_feeds")
    .update({
      last_synced_at: new Date().toISOString(),
      last_error: null,
      last_event_count: rows.length,
    })
    .eq("id", feed.id);

  return { feed_id: feed.id, count: rows.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected a JSON body" }, 400);
  }

  try {
    // Pasted .ics — record it as a one-off feed (empty url = not re-syncable).
    if (typeof body.ics === "string" && body.ics.length > 0) {
      const { data, error } = await supabase
        .from("family_calendar_feeds")
        .insert({
          member_id: (body.member_id as string) ?? null,
          name: ((body.name as string) || "Imported calendar").slice(0, 120),
          url: "",
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 400);

      const result = await syncFeed(supabase, data as never, body.ics);
      return json({ results: [result] });
    }

    let feeds: { id: string; member_id: string | null; url: string }[] = [];

    if (body.sync_all === true) {
      const { data, error } = await supabase
        .from("family_calendar_feeds")
        .select("id, member_id, url")
        .eq("is_active", true)
        .neq("url", "");
      if (error) return json({ error: error.message }, 400);
      feeds = (data ?? []) as typeof feeds;
    } else if (typeof body.feed_id === "string") {
      const { data, error } = await supabase
        .from("family_calendar_feeds")
        .select("id, member_id, url")
        .eq("id", body.feed_id)
        .single();
      if (error) return json({ error: error.message }, 400);
      if (!data.url) return json({ error: "That was a one-off import — re-paste to refresh." }, 400);
      feeds = [data as (typeof feeds)[number]];
    } else {
      return json({ error: "Pass feed_id, sync_all, or ics" }, 400);
    }

    const results = [];
    for (const feed of feeds) results.push(await syncFeed(supabase, feed));
    return json({ results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
