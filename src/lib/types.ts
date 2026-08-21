export type Recurrence = "daily" | "weekly";
export type RsvpStatus = "going" | "maybe" | "not_going";

export interface FamilyMember {
  id: string;
  name: string;
  avatar_emoji: string;
  color: string;
  sort_order: number;
  created_at: string;
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
}

export interface Message {
  id: string;
  sender_id: string | null;
  message_text: string;
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
}
