import type { AppData } from "../domain/types";
import { migrate } from "./schema";

export const STORAGE_KEY = "mizan_v2";
export const LEGACY_KEY = "trackr_v1";

function readLegacyPayload(): unknown {
  if (typeof localStorage === "undefined") return null;
  const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
  return stored ? JSON.parse(stored) : null;
}

export function hasLegacyLocalData(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) !== null || localStorage.getItem(LEGACY_KEY) !== null;
}

export function loadLegacyLocalData(): AppData | null {
  try {
    const payload = readLegacyPayload();
    return payload ? migrate(payload) : null;
  } catch {
    return null;
  }
}

export function clearLegacyLocalData(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_KEY);
}

export function serializeBackup(data: AppData): string {
  return JSON.stringify(data, null, 2);
}

/** Parse a backup file (Mizan v2+ or trackr v1 JSON). Throws on unreadable input. */
export function parseBackup(text: string): AppData {
  return migrate(JSON.parse(text));
}
