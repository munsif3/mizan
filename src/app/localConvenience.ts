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

export type PersistedView = "balance" | "sort" | "ledger" | "trend";

/**
 * Normalizes the cloud-backed last-view preference after the navigation
 * overhaul. The helper lives with the other convenience-state migrations,
 * while Firestore remains authoritative for the actual preference.
 */
export function migrateView(value: string): PersistedView {
  switch (value) {
    case "balance":
    case "sort":
    case "ledger":
    case "trend":
      return value;
    case "transactions":
      return "ledger";
    case "history":
      return "trend";
    case "home":
    default:
      return "balance";
  }
}
