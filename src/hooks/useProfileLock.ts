"use client";

import { useCallback, useEffect, useState } from "react";
import { describeDevice, getDeviceToken } from "@/lib/device";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

export interface PinStatus {
  member_id: string;
  has_pin: boolean;
  locked: boolean;
}

export interface UnlockResult {
  ok: boolean;
  error?: string;
  /** Set when the profile is in a cooldown; seconds until it lifts. */
  retryAfterSeconds?: number;
  /** How many tries remain before a cooldown starts. */
  attemptsLeft?: number;
}

/**
 * Profile PINs and remembered devices.
 *
 * Every operation is a `security definer` RPC — see migration 0006. The client
 * deliberately holds no hash and no lock state of its own: it asks, and the
 * database decides. That is what stops the gate being bypassed by editing
 * anything in the browser.
 */
export function useProfileLock() {
  const [status, setStatus] = useState<Record<string, PinStatus>>({});
  // Starts false when there is nothing to load, so the effect below never has
  // to correct it synchronously on its first pass.
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error: err } = await getSupabase().rpc("family_pin_status");
    if (err) setError(err.message);
    else {
      const next: Record<string, PinStatus> = {};
      for (const row of (data ?? []) as PinStatus[]) next[row.member_id] = row;
      setStatus(next);
      setError(null);
    }
    setLoading(false);
  }, []);

  // Same shape as the other data hooks here: the load runs inside an async
  // IIFE with a cancelled guard, rather than being called straight from the
  // effect body.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await reload();
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  /** Has this browser already been trusted for this member? */
  const isTrustedHere = useCallback(async (memberId: string) => {
    const token = getDeviceToken();
    if (!token) return false;
    const { data, error: err } = await getSupabase().rpc("family_device_trusted", {
      p_member_id: memberId,
      p_device_token: token,
    });
    if (err) return false;
    return data === true;
  }, []);

  /** Check the PIN and, on success, remember this browser for this member. */
  const unlock = useCallback(
    async (memberId: string, pin: string): Promise<UnlockResult> => {
      const { data, error: err } = await getSupabase().rpc("family_unlock_profile", {
        p_member_id: memberId,
        p_pin: pin,
        p_device_token: getDeviceToken(),
        p_device_label: describeDevice(),
      });
      if (err) return { ok: false, error: err.message };

      const r = (data ?? {}) as Record<string, unknown>;
      if (r.ok === true) {
        await reload();
        return { ok: true };
      }
      return {
        ok: false,
        error: typeof r.error === "string" ? r.error : undefined,
        retryAfterSeconds:
          typeof r.retry_after_seconds === "number" ? r.retry_after_seconds : undefined,
        attemptsLeft: typeof r.attempts_left === "number" ? r.attempts_left : undefined,
      };
    },
    [reload],
  );

  /** Create a first PIN, or change one by supplying the current PIN. */
  const setPin = useCallback(
    async (memberId: string, pin: string, currentPin?: string): Promise<UnlockResult> => {
      const { data, error: err } = await getSupabase().rpc("family_set_pin", {
        p_member_id: memberId,
        p_pin: pin,
        p_current_pin: currentPin ?? null,
      });
      if (err) return { ok: false, error: err.message };

      const r = (data ?? {}) as Record<string, unknown>;
      if (r.ok !== true) {
        return { ok: false, error: typeof r.error === "string" ? r.error : "That did not work." };
      }
      // Setting a PIN clears every trusted device, including this one, so the
      // device is re-trusted straight away rather than asking again on the
      // very next tap.
      await unlock(memberId, pin);
      await reload();
      return { ok: true };
    },
    [reload, unlock],
  );

  /** Stop this browser remembering this member. */
  const forgetThisDevice = useCallback(async (memberId: string) => {
    const token = getDeviceToken();
    if (!token) return;
    await getSupabase().rpc("family_forget_device", {
      p_member_id: memberId,
      p_device_token: token,
    });
  }, []);

  return { status, loading, error, reload, isTrustedHere, unlock, setPin, forgetThisDevice };
}
