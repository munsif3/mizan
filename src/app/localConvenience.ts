/**
 * Small helpers for non-authoritative, device-local convenience values (theme,
 * privacy toggle, last active household). Financial data never goes here.
 */

export function readLocalConvenience(key: string): string {
  return typeof localStorage === "undefined" ? "" : localStorage.getItem(key) ?? "";
}

export function writeLocalConvenience(key: string, value: string): void {
  if (typeof localStorage === "undefined") return;
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}
