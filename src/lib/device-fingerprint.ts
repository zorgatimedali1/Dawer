const STORAGE_KEY = 'cf_device';

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}

/**
 * A stable, sync device hash (16 hex chars) derived from cheap browser
 * signals. The server prefers it over the rotating anonymous id when keying
 * spin claims, so a farm that regenerates ids still collides on one identity.
 * Nothing here is secret or personal: it is only ever hashed again server-side.
 */
export function deviceHashFor(): string {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
  } catch {
    // Storage unavailable — derive from signals alone below.
  }

  const signals = [
    navigator.userAgent,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    navigator.language ?? '',
    String(navigator.hardwareConcurrency ?? ''),
    String((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? ''),
  ].join('|');

  const hash =
    fnv1a(signals).toString(16).padStart(8, '0') + fnv1a(`${signals}::salt`).toString(16).padStart(8, '0');

  try {
    window.localStorage.setItem(STORAGE_KEY, hash);
  } catch {
    // Storage unavailable — the derived value is still deterministic per device.
  }

  return hash;
}
