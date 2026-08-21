"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { FamilyMember } from "@/lib/types";

const STORAGE_KEY = "family-dashboard:member-id";

interface FamilyContextValue {
  members: FamilyMember[];
  byId: Record<string, FamilyMember>;
  currentMember: FamilyMember | null;
  setCurrentMemberId: (id: string | null) => void;
  reloadMembers: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

const FamilyContext = createContext<FamilyContextValue | null>(null);

export function FamilyProvider({ children }: { children: React.ReactNode }) {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  // Read straight from storage on the first client render. During the static
  // prerender there is no window, so this starts null and the gate shows the
  // loading state anyway — nothing rendered depends on it until members load.
  const [currentId, setCurrentId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private mode / storage disabled — the picker just shows every time.
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadMembers = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    const { data, error: err } = await getSupabase()
      .from("family_members")
      .select("*")
      .order("sort_order")
      .order("created_at");

    if (err) setError(err.message);
    else {
      setMembers((data ?? []) as FamilyMember[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await reloadMembers();
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadMembers]);

  const setCurrentMemberId = useCallback((id: string | null) => {
    setCurrentId(id);
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Non-fatal: the choice just will not survive a reload.
    }
  }, []);

  const byId = useMemo(
    () => Object.fromEntries(members.map((m) => [m.id, m])),
    [members],
  );

  // A member removed on another device should not stay selected here.
  const currentMember = currentId ? (byId[currentId] ?? null) : null;

  const value = useMemo(
    () => ({
      members,
      byId,
      currentMember,
      setCurrentMemberId,
      reloadMembers,
      loading,
      error,
    }),
    [members, byId, currentMember, setCurrentMemberId, reloadMembers, loading, error],
  );

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}

export function useFamily(): FamilyContextValue {
  const ctx = useContext(FamilyContext);
  if (!ctx) throw new Error("useFamily must be used inside <FamilyProvider>");
  return ctx;
}
