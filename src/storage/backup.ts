import type { AppData } from "../domain/types";
import { migrate } from "./schema";

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

export function serializeBackup(data: AppData): string {
  const envelope: BackupEnvelope = {
    product: BACKUP_PRODUCT,
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appData: data,
  };
  return JSON.stringify(envelope, null, 2);
}

/** Parse current envelopes and supported pre-envelope Mizan/Trackr backups. */
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
