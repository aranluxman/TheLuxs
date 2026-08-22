export type Recurrence = "daily" | "weekly";
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

export interface ChoreTemplate {
  id: string;
  title: string;
  description: string | null;
  recurrence_type: Recurrence;
  rotation_offset: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface Chore {
  id: string;
  template_id: string | null;
  title: string;
  description: string | null;
  recurrence_type: Recurrence;
  assigned_member_id: string | null;
  is_completed: boolean;
  completed_at: string | null;
  completed_by: string | null;
  /** `YYYY-MM-DD` */
  due_date: string;
  period_key: string;
  created_at: string;
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

export interface ChoreExclusion {
  template_id: string;
  member_id: string;
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
  /** Empty string means a one-off pasted import rather than a live URL. */
  url: string;
  is_active: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  last_event_count: number | null;
  created_at: string;
}

/** Anything that can land on the aggregated calendar. */
export type AgendaKind = "event" | "entry" | "chore";

export interface AgendaItem {
  id: string;
  kind: AgendaKind;
  title: string;
  subtitle?: string | null;
  /** Local `YYYY-MM-DD` the item belongs to. */
  day: string;
  /** Null for all-day items such as chore deadlines. */
  start: Date | null;
  end: Date | null;
  memberIds: string[];
  done?: boolean;
  allDay?: boolean;
  /** Imported from a calendar feed — deleting it here would just resync back. */
  readOnly?: boolean;
}
