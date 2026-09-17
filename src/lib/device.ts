/**
 * A stable per-device secret.
 *
 * Trusting a device means proving, on a later visit, that this browser is the
 * same one that got the PIN right. A random token in `localStorage` is exactly
 * that proof: it never leaves this browser except to be checked, the server
 * stores only its SHA-256, and clearing site data simply means typing the PIN
 * once more.
 *
 * It is deliberately not derived from anything about the device. A fingerprint
 * would be guessable by whoever is holding the phone, which is the one person
 * this is meant to stop.
 */
const DEVICE_KEY = "family-dashboard:device-id";

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // base64url, so it survives being a plain string everywhere it travels.
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * The token for this browser, minted on first use.
 *
 * Returns null when storage is unavailable (private mode, storage disabled).
 * The caller treats that as "this device cannot be remembered" and asks for
 * the PIN every time, which is the safe way to fail.
 */
export function getDeviceToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing && existing.length >= 20) return existing;
    const fresh = randomToken();
    window.localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return null;
  }
}

/** A human label for the trusted-device list. Best effort, never identifying. */
export function describeDevice(): string {
  if (typeof navigator === "undefined") return "A device";
  const ua = navigator.userAgent;
  const platform =
    /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android phone"
    : /Macintosh/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows PC"
    : "A device";
  return platform;
}
