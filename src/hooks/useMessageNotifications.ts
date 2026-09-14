"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrefs } from "@/hooks/usePrefs";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Message } from "@/lib/types";

export type NotificationPermissionState = "unsupported" | NotificationPermission;

/** What the browser will currently let us do. Safe to call on the server. */
export function notificationPermission(): NotificationPermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/**
 * A short, quiet blip. Deliberately synthesised rather than a bundled audio
 * file: it is two hundred milliseconds of sine wave, and shipping an asset —
 * plus a `<audio>` element and its load states — to play it would be the
 * larger part of the feature.
 */
function blip() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.22);
    osc.onended = () => void ctx.close();
  } catch {
    // Autoplay policy, or no audio device. The notification still shows.
  }
}

/**
 * "Somebody sent a message."
 *
 * Lives in the shell rather than in the chat tab, which is the whole point:
 * the chat's own subscription only exists while the chat is on screen, and the
 * message you want to be told about is by definition one that arrived while
 * you were looking at something else.
 *
 * Two things come out of it. A system notification, when the device has been
 * given permission and has the setting on — and, always, a dot on the Chat tab,
 * because permission may be denied, the browser may not support notifications
 * at all, and a household should still be able to see that the chat has moved.
 *
 * Direct messages are filtered the same way the chat filters them: every
 * browser is sent every row (there is no login — see migration 0006), and this
 * drops the ones that are not ours as a courtesy rather than as a boundary. A
 * notification for someone else's DM would make that leak visible and loud.
 */
export function useMessageNotifications(meId: string | null, chatOpen: boolean) {
  const { prefs } = usePrefs();
  const [unread, setUnread] = useState(false);
  const [chatWasOpen, setChatWasOpen] = useState(chatOpen);

  /** Resolves a sender id to a name for the notification body. */
  const namesRef = useRef<Record<string, string>>({});
  const setNames = useCallback((names: Record<string, string>) => {
    namesRef.current = names;
  }, []);

  // Read inside the subscription callback, which is created once per member.
  // Without the refs, toggling a setting would tear the channel down and
  // rebuild it — and drop whatever arrived in between.
  const settings = useRef({ notify: prefs.notifyMessages, sound: prefs.notifySound });
  const chatOpenRef = useRef(chatOpen);

  // Written in an effect rather than during render: a ref assigned mid-render
  // is not a thing React guarantees anything about, and these are only ever
  // read from a callback that runs long after the commit.
  useEffect(() => {
    settings.current = { notify: prefs.notifyMessages, sound: prefs.notifySound };
  }, [prefs.notifyMessages, prefs.notifySound]);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
  }, [chatOpen]);

  // Opening the chat is what clears the dot. Adjusted during render on the
  // transition rather than in an effect: it is state derived from a prop
  // changing, which React asks to be written exactly this way — an effect here
  // would paint the dot once and then immediately re-render without it.
  if (chatOpen !== chatWasOpen) {
    setChatWasOpen(chatOpen);
    if (chatOpen) setUnread(false);
  }

  useEffect(() => {
    if (!isSupabaseConfigured || !meId) return;
    const supabase = getSupabase();

    const channel = supabase
      .channel("family-message-alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "family_messages" },
        (payload) => {
          const row = payload.new as Message;
          if (row.sender_id === meId) return;
          // The group thread, or a DM addressed to me. Anything else is not
          // mine to be told about.
          if (row.recipient_id && row.recipient_id !== meId) return;

          setUnread(true);

          // No notification for a message you are watching arrive.
          if (chatOpenRef.current && !document.hidden) return;
          if (!settings.current.notify) return;
          if (notificationPermission() !== "granted") return;

          const who = row.sender_id ? (namesRef.current[row.sender_id] ?? "Someone") : "Someone";
          const body =
            row.message_text.trim() ||
            (row.attachment_kind === "image"
              ? "Sent a photo"
              : row.attachment_kind === "voice"
                ? "Sent a voice note"
                : "Sent an attachment");

          try {
            new Notification(row.recipient_id ? `${who} · just you two` : who, {
              body: body.slice(0, 140),
              // One notification per thread replaces the last rather than
              // stacking: a phone with nine banners from one conversation is
              // worse than one that says what the latest is.
              tag: `family-chat:${row.conversation_key ?? "group"}`,
              icon: "/icons/icon-192.png",
            });
            if (settings.current.sound) blip();
          } catch {
            // Some browsers refuse a constructed Notification outside a service
            // worker. The dot above is the fallback, and it has already been set.
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [meId]);

  return { unread, setNames };
}

/**
 * Ask for permission, from a click.
 *
 * Browsers require a user gesture, and Safari rejects the promise form on some
 * versions — hence the callback branch. Returns what the answer was so the
 * settings screen can say it plainly rather than guessing.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  try {
    const result = await new Promise<NotificationPermission>((resolve) => {
      const maybe = Notification.requestPermission((p) => resolve(p));
      if (maybe && typeof maybe.then === "function") void maybe.then(resolve);
    });
    return result;
  } catch {
    return Notification.permission;
  }
}
