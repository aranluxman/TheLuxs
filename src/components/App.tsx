"use client";

import { isSupabaseConfigured } from "@/lib/supabase";
import { FamilyProvider, useFamily } from "./FamilyProvider";
import { ProfileGate } from "./ProfileGate";
import { ThemeProvider } from "./ThemeProvider";
import { SetupScreen } from "./SetupScreen";
import { Shell } from "./Shell";

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

function Gate() {
  const { members, currentMember, loading, error } = useFamily();

  if (loading) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 pt-8">
        <span className="skeleton h-9 w-48 rounded-xl" />
        <span className="skeleton h-32 w-full rounded-3xl" />
        <span
          className="skeleton h-48 w-full rounded-3xl"
          role="status"
          aria-label="Loading family dashboard"
        />
      </main>
    );
  }

  if (error && members.length === 0) {
    return (
      <main className="mx-auto w-full max-w-lg px-6 py-20">
        <h1 className="text-xl font-semibold">Couldn&rsquo;t reach the database</h1>
        <p className="text-muted mt-3 text-sm">{error}</p>
        <p className="text-muted mt-3 text-sm">
          Check that the migration in <code className="font-mono">supabase/migrations</code>{" "}
          has been run against this project.
        </p>
      </main>
    );
  }

  if (members.length === 0) return <SetupScreen />;
  if (!currentMember) return <ProfileGate />;
  return <Shell />;
}

export function App() {
  // The theme wraps even the misconfigured state — a white flash on a dark
  // tablet is the first thing anyone would notice, error page or not.
  return (
    <ThemeProvider>
      {isSupabaseConfigured ? (
        <FamilyProvider>
          <Gate />
        </FamilyProvider>
      ) : (
        <MissingConfig />
      )}
    </ThemeProvider>
  );
}
