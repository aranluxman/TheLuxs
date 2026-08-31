"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { removeMedia, signMediaUrl, uploadMedia } from "@/lib/storage";
import { squareCropImage } from "@/lib/image";
import {
  APP_ICON_EDGE,
  APP_ICON_SETTING,
  applyAppIconLinks,
  clearCachedAppIcon,
  readCachedAppIcon,
  writeCachedAppIcon,
} from "@/lib/appIcon";

/**
 * Where the current icon lives.
 *   family — in the database, so every device in the house shows it
 *   device — in this browser only, because migration 0005 has not been run
 */
export type AppIconScope = "family" | "device";

interface AppIconContextValue {
  /** Best URL to render the icon with, or null for the default mark. */
  iconUrl: string | null;
  scope: AppIconScope;
  busy: boolean;
  error: string | null;
  setIcon: (file: File | Blob) => Promise<void>;
  clearIcon: () => Promise<void>;
}

const AppIconContext = createContext<AppIconContextValue | null>(null);

/** Supabase's way of saying "that table isn't there" — the migration is pending. */
function isMissingSettingsTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("family_settings") && (msg.includes("does not exist") || msg.includes("schema cache"));
}

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function AppIconProvider({ children }: { children: React.ReactNode }) {
  // Seeded from the cache so the header shows the household's photo on the
  // first paint rather than flashing the default and then swapping. Lazy, and
  // never updated: this is what the device knew at startup, which is exactly
  // what the sync below wants to compare against.
  const [cached] = useState(readCachedAppIcon);
  const [dataUrl, setDataUrl] = useState<string | null>(cached?.dataUrl ?? null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(cached?.path ?? null);
  // Without a database there is nowhere to share an icon to, and that is known
  // at build time.
  const [scope, setScope] = useState<AppIconScope>(
    isSupabaseConfigured ? "family" : "device",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the tab and home-screen icons in step with whatever is on screen.
  useEffect(() => {
    applyAppIconLinks(dataUrl, signedUrl);
  }, [dataUrl, signedUrl]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let cancelled = false;

    (async () => {
      const { data, error: err } = await getSupabase()
        .from("family_settings")
        .select("value")
        .eq("key", APP_ICON_SETTING)
        .maybeSingle();

      if (cancelled) return;

      if (err) {
        // No settings table yet: the icon simply stays on this device.
        if (isMissingSettingsTable(err)) setScope("device");
        return;
      }

      const stored = (data?.value ?? null) as { path?: string | null } | null;
      const storedPath = stored?.path ?? null;

      if (!storedPath) {
        // The family cleared it. A device-only icon (no path) is not theirs to
        // clear, so it stays.
        if (cached?.path) {
          clearCachedAppIcon();
          setDataUrl(null);
          setPath(null);
        }
        return;
      }

      const url = await signMediaUrl(storedPath);
      if (cancelled || !url) return;

      setPath(storedPath);
      setSignedUrl(url);

      // Re-cache when the photo changed on another device, so the next cold
      // start paints it immediately.
      if (storedPath !== cached?.path) {
        setDataUrl(url);
        const inline = await toDataUrl(url);
        if (cancelled) return;
        if (inline) {
          setDataUrl(inline);
          writeCachedAppIcon({ path: storedPath, dataUrl: inline });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cached]);

  const setIcon = useCallback(
    async (file: File | Blob) => {
      // What to put back if the save fails: whatever is on screen now, which
      // is not necessarily what the device started with.
      const previousDataUrl = dataUrl;
      setError(null);
      setBusy(true);
      try {
        const cropped = await squareCropImage(file, APP_ICON_EDGE);
        if ("error" in cropped) {
          setError(cropped.error);
          return;
        }

        // Show it straight away — the upload is confirmation, not permission.
        setDataUrl(cropped.dataUrl);

        if (!isSupabaseConfigured) {
          setPath(null);
          setSignedUrl(null);
          setScope("device");
          writeCachedAppIcon({ path: null, dataUrl: cropped.dataUrl });
          return;
        }

        const uploaded = await uploadMedia(cropped.blob, "branding", "jpg");
        if ("error" in uploaded) {
          setError(uploaded.error);
          setDataUrl(previousDataUrl);
          return;
        }

        const { error: err } = await getSupabase()
          .from("family_settings")
          .upsert(
            { key: APP_ICON_SETTING, value: { path: uploaded.path } },
            { onConflict: "key" },
          );

        if (err) {
          await removeMedia([uploaded.path]);
          if (!isMissingSettingsTable(err)) {
            setError(err.message);
            setDataUrl(previousDataUrl);
            return;
          }
          // Migration pending: keep the icon, just on this device.
          setScope("device");
          setPath(null);
          setSignedUrl(null);
          writeCachedAppIcon({ path: null, dataUrl: cropped.dataUrl });
          return;
        }

        const previous = path;
        if (previous && previous !== uploaded.path) await removeMedia([previous]);

        setScope("family");
        setPath(uploaded.path);
        setSignedUrl(await signMediaUrl(uploaded.path));
        writeCachedAppIcon({ path: uploaded.path, dataUrl: cropped.dataUrl });
      } finally {
        setBusy(false);
      }
    },
    [dataUrl, path],
  );

  const clearIcon = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      if (isSupabaseConfigured && path) {
        const { error: err } = await getSupabase()
          .from("family_settings")
          .upsert({ key: APP_ICON_SETTING, value: {} }, { onConflict: "key" });

        if (err && !isMissingSettingsTable(err)) {
          setError(err.message);
          return;
        }
        await removeMedia([path]);
      }

      clearCachedAppIcon();
      setDataUrl(null);
      setSignedUrl(null);
      setPath(null);
    } finally {
      setBusy(false);
    }
  }, [path]);

  const value = useMemo(
    () => ({
      // The inline copy wins for display: it is already decoded, and it does
      // not expire the way a signed URL does.
      iconUrl: dataUrl ?? signedUrl,
      scope,
      busy,
      error,
      setIcon,
      clearIcon,
    }),
    [dataUrl, signedUrl, scope, busy, error, setIcon, clearIcon],
  );

  return <AppIconContext.Provider value={value}>{children}</AppIconContext.Provider>;
}

export function useAppIcon(): AppIconContextValue {
  const ctx = useContext(AppIconContext);
  if (!ctx) throw new Error("useAppIcon must be used inside <AppIconProvider>");
  return ctx;
}
