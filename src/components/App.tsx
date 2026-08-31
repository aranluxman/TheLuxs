"use client";

import { isSupabaseConfigured } from "@/lib/supabase";
import { AppIconProvider } from "./AppIconProvider";
import { ServiceWorkerRegistrar } from "./ServiceWorkerRegistrar";
import { FamilyProvider, useFamily } from "./FamilyProvider";
import { ProfileGate } from "./ProfileGate";
import { ThemeProvider } from "./ThemeProvider";
import { SetupScreen } from "./SetupScreen";
import { Shell } from "./Shell";

function MissingConfig() {
  return (
    <main className="mx-auto w-full max-w-lg px-6 py-20">
      <h1 className="text-xl font-semibold">Supabase isn&rsquo;t configured</h1>
      <p className="text-muted mt-3 text-sm">
        This build was made without <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="font-mono">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>. Add them to{" "}
        <code className="font-mono">.env.local</code> (or to your Cloudflare Pages build
        settings) and rebuild — they are inlined at build time, so restarting alone
        will not pick them up.
      </p>
    </main>
  );
}

function Gate() {
  const { members, currentMember, loading, error } = useFamily();

  if (loading) {
    return (
      <main className="text-muted flex flex-1 items-center justify-center text-sm">
        Loading…
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
