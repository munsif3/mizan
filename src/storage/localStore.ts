import type { AppData } from "../domain/types";
import { migrate } from "./schema";

const STORAGE_KEY = "mizan_v2";
/** trackr's key — read once for seamless migration when served from the same origin. */
const LEGACY_KEY = "trackr_v1";

export function loadData(): AppData {
  if (typeof localStorage === "undefined") return migrate(null);
  const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
  try {
    return migrate(stored ? JSON.parse(stored) : null);
  } catch {
    return migrate(null);
  }
}

export function saveData(data: AppData): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function clearData(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function serializeBackup(data: AppData): string {
  return JSON.stringify(data, null, 2);
}

/** Parse a backup file (Mizan v2 or trackr v1 JSON). Throws on unreadable input. */
export function parseBackup(text: string): AppData {
  return migrate(JSON.parse(text));
}
