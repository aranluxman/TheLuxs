"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { classifyDbError } from "@/lib/dbErrorHint";
import { MEMBER_STORAGE_KEY } from "@/lib/member";
import { isSupabaseConfigured } from "@/lib/supabase";
import { AppIconProvider } from "./AppIconProvider";
import { ServiceWorkerRegistrar } from "./ServiceWorkerRegistrar";
import { FamilyProvider, useFamily } from "./FamilyProvider";
import { GATE_GRID, GATE_LAYOUT, GateIntro, ProfileGate } from "./ProfileGate";
import { ThemeProvider } from "./ThemeProvider";
import { SetupScreen } from "./SetupScreen";

/**
 * Every tab lives behind this, and the picker does not need any of them, so
 * they are a separate download rather than part of the first load.
 */
const Shell = dynamic(() => import("./Shell").then((m) => m.Shell), {
  loading: () => <DashboardSkeleton />,
});

function DashboardSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 pt-8">
      <span className="skeleton h-9 w-48 rounded-xl" />
      <span className="skeleton h-32 w-full rounded-3xl" />
      <span
        className="skeleton h-48 w-full rounded-3xl"
        role="status"
        aria-label="Loading family dashboard"
      />
    </div>
  );
}

/**
 * What the static HTML contains, and so what paints first. A new device is about
 * to see the picker, so it gets the picker's real heading with placeholders for
 * the faces; a device that has already chosen someone gets the dashboard
 * skeleton. Which is which is known before React runs (`data-returning` on
 * <html>, set in the layout's inline script), so both are rendered and CSS shows
 * one — the markup is the same on the server and the client.
 */
function GateLoading() {
  return (
    <main className="flex flex-1 flex-col">
      <div className={`gate-first-visit ${GATE_LAYOUT}`}>
        <GateIntro
          orbit={
            <div className="orbit" aria-hidden>
              <span className="orbit-ring" />
              <span className="orbit-home">
                <span className="brand-mark !h-11 !w-11 text-base">F</span>
              </span>
            </div>
          }
        />
        <div
          className={GATE_GRID}
          role="status"
          aria-label="Loading family dashboard"
        >
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className="skeleton min-h-36 rounded-2xl" />
          ))}
        </div>
      </div>
      <div className="gate-returning flex flex-1 flex-col">
        <DashboardSkeleton />
      </div>
    </main>
  );
}

function MissingConfig() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-6 py-20">
      <div className="brand-mark mb-5" aria-hidden>F</div>
      <p className="text-accent text-[11px] font-bold tracking-[0.14em] uppercase">Setup needed</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Supabase isn&rsquo;t configured</h1>
      <p className="text-muted mt-3 text-sm">
        This build was made without <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="font-mono">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>. Add them to{" "}
        <code className="font-mono">.env.local</code> (or to your Cloudflare Pages build
        settings) and rebuild. The values are inlined at build time, so restarting alone
        will not pick them up.
      </p>
    </main>
  );
}

function DbErrorHint({ message }: { message: string }) {
  const code = (s: string) => <code className="font-mono">{s}</code>;
  switch (classifyDbError(message)) {
    case "key":
      return (
        <p className="text-muted mt-3 text-sm">
          Supabase rejected this build&rsquo;s API key. Copy the publishable key from the
          project in {code("NEXT_PUBLIC_SUPABASE_URL")} (Project Settings &rarr; API Keys) into{" "}
          {code("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")}, then rebuild and redeploy &mdash; the
          key is inlined at build time.
        </p>
      );
    case "schema":
      return (
        <p className="text-muted mt-3 text-sm">
          The tables are missing. Run the migrations in {code("supabase/migrations")} against
          this project, in order.
        </p>
      );
    case "network":
      return (
        <p className="text-muted mt-3 text-sm">
          The request never reached Supabase. Check the connection, and that the project
          isn&rsquo;t paused in the Supabase dashboard.
        </p>
      );
    default:
      return (
        <p className="text-muted mt-3 text-sm">
          Check the Supabase URL and key this build was made with, and that the migrations in{" "}
          {code("supabase/migrations")} have been run against that project.
        </p>
      );
  }
}

function Gate() {
  const { members, currentMember, loading, error } = useFamily();

  // Someone coming back goes straight to the dashboard once the member list
  // lands, so fetch its code alongside that request instead of after it.
  useEffect(() => {
    try {
      if (localStorage.getItem(MEMBER_STORAGE_KEY)) void import("./Shell");
    } catch {
      // Storage blocked: they will see the picker, which prefetches on tap.
    }
  }, []);

  if (loading) return <GateLoading />;

  if (error && members.length === 0) {
    return (
      <main className="mx-auto w-full max-w-lg px-6 py-20">
        <h1 className="text-xl font-semibold">Couldn&rsquo;t reach the database</h1>
        <p className="text-muted mt-3 text-sm">{error}</p>
        <DbErrorHint message={error} />
      </main>
    );
  }

  if (members.length === 0) return <SetupScreen />;
  if (!currentMember) return <ProfileGate />;
  return <Shell />;
}

export function App() {
  // The theme wraps even the misconfigured state — a white flash on a dark
  // tablet is the first thing anyone would notice, error page or not. The icon
  // provider sits just as high, because it owns the <link rel="icon"> tags and
  // those belong to the document, not to any one screen.
  return (
    <ThemeProvider>
      <AppIconProvider>
        <ServiceWorkerRegistrar />
        {isSupabaseConfigured ? (
          <FamilyProvider>
            <Gate />
          </FamilyProvider>
        ) : (
          <MissingConfig />
        )}
      </AppIconProvider>
    </ThemeProvider>
  );
}
