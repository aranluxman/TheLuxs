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
import { removeMedia, signMediaUrls, uploadMedia } from "@/lib/storage";
import type { FamilyMember, MemberWithPhoto } from "@/lib/types";

const STORAGE_KEY = "family-dashboard:member-id";

interface FamilyContextValue {
  members: MemberWithPhoto[];
  byId: Record<string, MemberWithPhoto>;
  currentMember: MemberWithPhoto | null;
  setCurrentMemberId: (id: string | null) => void;
  reloadMembers: () => Promise<void>;
  updateMember: (
    id: string,
    patch: Partial<Pick<FamilyMember, "name" | "color" | "avatar_emoji">>,
  ) => Promise<string | null>;
  setMemberPhoto: (id: string, file: Blob) => Promise<string | null>;
  clearMemberPhoto: (id: string) => Promise<string | null>;
  loading: boolean;
  error: string | null;
}

const FamilyContext = createContext<FamilyContextValue | null>(null);

export function FamilyProvider({ children }: { children: React.ReactNode }) {
  const [members, setMembers] = useState<MemberWithPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as FamilyMember[];
    // The bucket is private, so photos need signing. One batched call covers
    // the whole household.
    const signed = await signMediaUrls(
      rows.map((r) => r.avatar_path).filter((p): p is string => Boolean(p)),
    );

    setMembers(
      rows.map((r) => ({
        ...r,
        avatar_url: r.avatar_path ? (signed[r.avatar_path] ?? null) : null,
      })),
    );
    setError(null);
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

  const updateMember = useCallback(
    async (
      id: string,
      patch: Partial<Pick<FamilyMember, "name" | "color" | "avatar_emoji">>,
    ) => {
      const { error: err } = await getSupabase()
        .from("family_members")
        .update(patch)
        .eq("id", id);
      if (err) return err.message;
      await reloadMembers();
      return null;
    },
    [reloadMembers],
  );

  const setMemberPhoto = useCallback(
    async (id: string, file: Blob) => {
      const previous = members.find((m) => m.id === id)?.avatar_path ?? null;

      const uploaded = await uploadMedia(file, "avatars", "jpg");
      if ("error" in uploaded) return uploaded.error;

      const { error: err } = await getSupabase()
        .from("family_members")
        .update({ avatar_path: uploaded.path })
        .eq("id", id);

      if (err) {
        // Don't leave the orphan behind if the row never picked it up.
        await removeMedia([uploaded.path]);
        return err.message;
      }

      if (previous) await removeMedia([previous]);
      await reloadMembers();
      return null;
    },
    [members, reloadMembers],
  );

  const clearMemberPhoto = useCallback(
    async (id: string) => {
      const previous = members.find((m) => m.id === id)?.avatar_path ?? null;
      const { error: err } = await getSupabase()
        .from("family_members")
        .update({ avatar_path: null })
        .eq("id", id);
      if (err) return err.message;
      if (previous) await removeMedia([previous]);
      await reloadMembers();
      return null;
    },
    [members, reloadMembers],
  );

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
      updateMember,
      setMemberPhoto,
      clearMemberPhoto,
      loading,
      error,
    }),
    [
      members,
      byId,
      currentMember,
      setCurrentMemberId,
      reloadMembers,
      updateMember,
      setMemberPhoto,
      clearMemberPhoto,
      loading,
      error,
    ],
  );

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}

export function useFamily(): FamilyContextValue {
  const ctx = useContext(FamilyContext);
  if (!ctx) throw new Error("useFamily must be used inside <FamilyProvider>");
  return ctx;
}
