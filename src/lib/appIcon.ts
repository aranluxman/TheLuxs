/**
 * The household's own app icon: a family photo, uploaded from inside the app,
 * standing in for the default house mark.
 *
 * Three places show it, and they have different rules:
 *
 *   • the header, in-app         — plain <img>, easy
 *   • the browser tab            — <link rel="icon">, swapped at runtime
 *   • the iOS home screen        — <link rel="apple-touch-icon">, read by
 *                                  Safari at "Add to Home Screen" time
 *
 * An Android launcher icon comes from the manifest, which is a static file in
 * the export, so an installed Android app keeps the default mark. That is a
 * limitation of shipping without a server, not an oversight.
 *
 * iOS will not follow a `data:` URL for a touch icon, so the signed storage URL
 * is used there; the tab icon prefers the cached data URL because it is
 * available before the network is.
 */

/** `{ path, dataUrl }` — the last icon this device saw, for a flash-free boot. */
export const APP_ICON_CACHE_KEY = "family-dashboard:app-icon";

/** Row key in `family_settings`. */
export const APP_ICON_SETTING = "app_icon";

/** 512 is the largest size anything here asks for; bigger is wasted bytes. */
export const APP_ICON_EDGE = 512;

export interface CachedAppIcon {
  /** Storage object path, or null when the icon is device-local only. */
  path: string | null;
  dataUrl: string;
}

export function readCachedAppIcon(): CachedAppIcon | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(APP_ICON_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedAppIcon>;
    return typeof parsed?.dataUrl === "string"
      ? { path: parsed.path ?? null, dataUrl: parsed.dataUrl }
      : null;
  } catch {
    return null;
  }
}

export function writeCachedAppIcon(icon: CachedAppIcon): void {
  try {
    window.localStorage.setItem(APP_ICON_CACHE_KEY, JSON.stringify(icon));
  } catch {
    // Quota or private mode: the icon still applies for this session.
  }
}

export function clearCachedAppIcon(): void {
  try {
    window.localStorage.removeItem(APP_ICON_CACHE_KEY);
  } catch {
    /* nothing to undo */
  }
}

/** Marks the links this module created, so it can replace its own work. */
const OURS = "data-family-icon";

/**
 * Holds a default link's original `rel` while a custom icon is in place.
 *
 * Parking rather than removing is what keeps the tab icon honest. React owns
 * the default links, and it re-creates them after hydration whether they were
 * removed or edited — so a one-shot sweep loses to the very next render, and
 * the family photo ends up competing with `/icons/icon-512.png`. Hence the
 * observer below: every icon link that appears while a custom icon is active
 * is parked as it arrives, and ours are pushed back to the end of the head.
 */
const PARKED = "data-family-parked";

/** No browser knows this relation, so a parked link stops being an icon. */
const INERT_REL = "family-parked-icon";

let observer: MutationObserver | null = null;

function isIconLink(link: HTMLLinkElement): boolean {
  return link.rel.toLowerCase().includes("icon") && !link.hasAttribute(OURS);
}

function park(link: HTMLLinkElement): void {
  if (link.hasAttribute(PARKED)) return;
  link.setAttribute(PARKED, link.rel);
  link.rel = INERT_REL;
}

function parkAllDefaults(): void {
  for (const link of document.head.querySelectorAll<HTMLLinkElement>("link")) {
    if (isIconLink(link)) park(link);
  }
}

function watchForDefaults(): void {
  if (observer) return;
  observer = new MutationObserver((records) => {
    let parked = false;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLLinkElement && isIconLink(node)) {
          park(node);
          parked = true;
        }
      }
    }
    // Ours belong last: document order is the tie-breaker when a browser has
    // two candidates it likes equally.
    if (parked) {
      for (const link of document.head.querySelectorAll(`link[${OURS}]`)) {
        document.head.appendChild(link);
      }
    }
  });
  observer.observe(document.head, { childList: true });
}

function unparkAll(): void {
  observer?.disconnect();
  observer = null;

  const seen = new Set<string>();
  for (const link of document.head.querySelectorAll<HTMLLinkElement>(`link[${PARKED}]`)) {
    link.rel = link.getAttribute(PARKED) ?? "icon";
    link.removeAttribute(PARKED);
    // React may have re-inserted a copy of every default while the photo was
    // in place. Restoring them all would leave the head full of duplicates.
    const key = `${link.rel}|${link.href}`;
    if (seen.has(key)) link.remove();
    else seen.add(key);
  }
}

/**
 * Points the tab and home-screen icons at the household photo.
 *
 * @param dataUrl inline copy, used for the tab — survives being offline
 * @param href    signed https URL, used for iOS, which ignores data URLs
 */
export function applyAppIconLinks(dataUrl: string | null, href?: string | null): void {
  if (typeof document === "undefined") return;
  const head = document.head;

  for (const link of head.querySelectorAll(`link[${OURS}]`)) link.remove();

  if (!dataUrl && !href) {
    unparkAll();
    return;
  }

  parkAllDefaults();
  watchForDefaults();

  const add = (rel: string, url: string) => {
    const link = document.createElement("link");
    link.setAttribute(OURS, "");
    link.rel = rel;
    link.href = url;
    head.appendChild(link);
  };

  const tab = dataUrl ?? href!;
  add("icon", tab);
  add("shortcut icon", tab);
  add("apple-touch-icon", href ?? tab);
}
