export type RsvpStatus = "going" | "maybe" | "not_going";

export interface FamilyMember {
  id: string;
  name: string;
  avatar_emoji: string;
  color: string;
  sort_order: number;
  created_at: string;
  /** Storage object path in the `family-media` bucket, or null for emoji-only. */
  avatar_path: string | null;
}

/** A member plus the short-lived signed URL for their photo. */
export interface MemberWithPhoto extends FamilyMember {
  avatar_url: string | null;
}

export interface FamilyEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  event_date: string;
  created_by: string | null;
  created_at: string;
}

export interface EventRsvp {
  event_id: string;
  member_id: string;
  status: RsvpStatus;
  updated_at: string;
}

export interface CalendarEntry {
  id: string;
  member_id: string | null;
  title: string;
  start_time: string;
  end_time: string | null;
  category: string;
  created_at: string;
  source_feed_id: string | null;
  source_uid: string | null;
  all_day: boolean;
}

export type AttachmentKind = "image" | "voice" | "file";

export interface Message {
  id: string;
  sender_id: string | null;
  message_text: string;
  created_at: string;
  attachment_path: string | null;
  attachment_kind: AttachmentKind | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  /** Seconds. Voice notes only. */
  attachment_duration: number | null;
  /** Set when someone removes the message; the row is kept as a tombstone. */
  deleted_at: string | null;
  deleted_by: string | null;
}

/**
 * The closed reaction palette. Widening this array is not enough on its own —
 * `family_message_reactions` has a matching check constraint, so the migration
 * has to agree before a new emoji will insert.
 */
export const REACTION_EMOJI = ["👍", "❤️", "😂"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

export interface MessageReaction {
  message_id: string;
  member_id: string;
  emoji: ReactionEmoji;
  created_at: string;
}

/** One emoji's tally on one message, resolved for rendering. */
export interface ReactionSummary {
  emoji: ReactionEmoji;
  memberIds: string[];
  mine: boolean;
}

export interface Quote {
  id: string;
  quote_text: string;
  author: string | null;
  is_active: boolean;
}

export interface LookingForward {
  member_id: string;
  note: string;
  target_date: string | null;
  updated_at: string;
}

export interface CalendarFeed {
  id: string;
  member_id: string | null;
  name: string;
  /**
   * Whether this feed has a live URL, as opposed to a one-off pasted import.
   *
   * The URL itself is deliberately absent: it is a *secret* calendar address,
   * and migration 0004 revokes SELECT on that column from the browser's role.
   * A generated column answers the only question the UI ever asked of it.
   */
  has_url: boolean;
  is_active: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  last_event_count: number | null;
  created_at: string;
}

/** Anything that can land on the aggregated calendar. */
export type AgendaKind = "event" | "entry";

export interface AgendaItem {
  id: string;
  kind: AgendaKind;
  title: string;
  subtitle?: string | null;
  /** Local `YYYY-MM-DD` the item belongs to. */
  day: string;
  /** Null for all-day items. */
  start: Date | null;
  end: Date | null;
  memberIds: string[];
  allDay?: boolean;
  /** Imported from a calendar feed — deleting it here would just resync back. */
  readOnly?: boolean;
}
