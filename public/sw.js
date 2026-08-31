/*
 * The smallest service worker that makes the app installable and survives a
 * dead kitchen wifi. Deliberately network-first: this dashboard is a live view
 * of a shared database, and a cache that wins over the network would show
 * yesterday's calendar. The cache exists only so that a reload with no
 * connection still paints the shell instead of the browser's error page.
 *
 * Supabase traffic is never touched — stale messages are worse than none.
 */
const CACHE = "family-dashboard-v1";
const SHELL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(SHELL))
      .catch(() => undefined)
      // A new worker should take over on the next load, not linger a version
      // behind until every tab is closed.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase, fonts, storage

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only same-origin successes are worth keeping, and only as a fallback.
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        // A navigation with nothing cached for that exact URL still gets the
        // shell: the app is a single page, so the shell is the whole app.
        if (request.mode === "navigate") {
          const shell = await caches.match(SHELL);
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});
