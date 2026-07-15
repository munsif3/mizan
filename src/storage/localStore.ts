import type { AppData } from "../domain/types";
import { migrate } from "./schema";

export const STORAGE_KEY = "mizan_v2";
const LEGACY_KEY = "trackr_v1";
const BACKUP_PRODUCT = "mizan";
const BACKUP_VERSION = 1;

interface BackupEnvelope {
  product: typeof BACKUP_PRODUCT;
  backupVersion: typeof BACKUP_VERSION;
  exportedAt: string;
  appData: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRecognizedLegacyBackup(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const version = Number(value.schemaVersion);
  if (!Number.isInteger(version) || version < 1) return false;
  return Array.isArray(value.transactions)
    || Array.isArray(value.fixedCosts)
    || Array.isArray(value.fixedNonCard)
    || isRecord(value.settings)
    || isRecord(value.splits)
    || isRecord(value.income);
}

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
  const envelope: BackupEnvelope = {
    product: BACKUP_PRODUCT,
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appData: data,
  };
  return JSON.stringify(envelope, null, 2);
}

/** Parse a backup file (Mizan v2+ or trackr v1 JSON). Throws on unreadable input. */
export function parseBackup(text: string): AppData {
  const parsed: unknown = JSON.parse(text);
  if (isRecord(parsed) && parsed.product === BACKUP_PRODUCT) {
    if (parsed.backupVersion !== BACKUP_VERSION) {
      throw new Error("This backup was created by a newer Mizan backup format.");
    }
    if (!isRecognizedLegacyBackup(parsed.appData)) {
      throw new Error("This Mizan backup does not contain a recognizable household payload.");
    }
    return migrate(parsed.appData);
  }
  if (!isRecognizedLegacyBackup(parsed)) {
    throw new Error("This file is valid JSON, but it is not a recognizable Mizan backup.");
  }
  return migrate(parsed);
}
