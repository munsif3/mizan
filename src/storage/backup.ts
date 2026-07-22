import type { AppData } from "../domain/types";
import { assertBackupPlaintext, assertBackupText } from "../security/resourceLimits";
import { migrate } from "./schema";

const BACKUP_PRODUCT = "mizan";
const PLAINTEXT_BACKUP_VERSION = 1;
const ENCRYPTED_BACKUP_VERSION = 2;
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const BACKUP_AAD = new TextEncoder().encode("mizan-backup-v2");

interface PlaintextBackupEnvelope {
  product: typeof BACKUP_PRODUCT;
  backupVersion: typeof PLAINTEXT_BACKUP_VERSION;
  exportedAt: string;
  appData: unknown;
}

interface EncryptedBackupEnvelope {
  product: typeof BACKUP_PRODUCT;
  backupVersion: typeof ENCRYPTED_BACKUP_VERSION;
  exportedAt: string;
  encryption: {
    algorithm: "AES-256-GCM";
    kdf: "PBKDF2-SHA-256";
    iterations: typeof PBKDF2_ITERATIONS;
    salt: string;
    iv: string;
    ciphertext: string;
  };
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

function plaintextEnvelope(data: AppData, exportedAt = new Date().toISOString()): PlaintextBackupEnvelope {
  return {
    product: BACKUP_PRODUCT,
    backupVersion: PLAINTEXT_BACKUP_VERSION,
    exportedAt,
    appData: data,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function deriveBackupKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as BufferSource, iterations: PBKDF2_ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function parseJson(text: string): unknown {
  assertBackupText(text);
  return JSON.parse(text) as unknown;
}

function isEncryptedEnvelope(value: unknown): value is EncryptedBackupEnvelope {
  if (!isRecord(value) || value.product !== BACKUP_PRODUCT || value.backupVersion !== ENCRYPTED_BACKUP_VERSION) return false;
  const encryption = value.encryption;
  return isRecord(encryption)
    && encryption.algorithm === "AES-256-GCM"
    && encryption.kdf === "PBKDF2-SHA-256"
    && encryption.iterations === PBKDF2_ITERATIONS
    && typeof encryption.salt === "string"
    && typeof encryption.iv === "string"
    && typeof encryption.ciphertext === "string";
}

export function validateBackupPassword(password: string): void {
  if (password.length < 12) throw new Error("Use a backup password of at least 12 characters.");
}

/** Serialize a password-encrypted, authenticated backup. Plaintext export is intentionally not exposed. */
export async function serializeBackup(data: AppData, password: string): Promise<string> {
  validateBackupPassword(password);
  const exportedAt = new Date().toISOString();
  const plaintext = JSON.stringify(plaintextEnvelope(data, exportedAt));
  assertBackupPlaintext(plaintext);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveBackupKey(password, salt);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as unknown as BufferSource,
      additionalData: BACKUP_AAD as unknown as BufferSource,
      tagLength: 128,
    },
    key,
    new TextEncoder().encode(plaintext) as unknown as BufferSource,
  );
  const envelope: EncryptedBackupEnvelope = {
    product: BACKUP_PRODUCT,
    backupVersion: ENCRYPTED_BACKUP_VERSION,
    exportedAt,
    encryption: {
      algorithm: "AES-256-GCM",
      kdf: "PBKDF2-SHA-256",
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    },
  };
  return JSON.stringify(envelope, null, 2);
}

export function backupRequiresPassword(text: string): boolean {
  return isEncryptedEnvelope(parseJson(text));
}

/** Parse supported plaintext Mizan/Trackr backups retained for migration compatibility. */
export function parseBackup(text: string): AppData {
  const parsed = parseJson(text);
  if (isEncryptedEnvelope(parsed)) throw new Error("This backup is encrypted and requires its backup password.");
  if (isRecord(parsed) && parsed.product === BACKUP_PRODUCT) {
    if (parsed.backupVersion !== PLAINTEXT_BACKUP_VERSION) {
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

export async function parseEncryptedBackup(text: string, password: string): Promise<AppData> {
  const parsed = parseJson(text);
  if (!isEncryptedEnvelope(parsed)) throw new Error("This is not a supported encrypted Mizan backup.");
  try {
    const salt = base64ToBytes(parsed.encryption.salt);
    const iv = base64ToBytes(parsed.encryption.iv);
    if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) throw new Error("invalid encryption parameters");
    const key = await deriveBackupKey(password, salt);
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as unknown as BufferSource,
        additionalData: BACKUP_AAD as unknown as BufferSource,
        tagLength: 128,
      },
      key,
      base64ToBytes(parsed.encryption.ciphertext) as unknown as BufferSource,
    );
    const plaintext = new TextDecoder().decode(decrypted);
    assertBackupPlaintext(plaintext);
    return parseBackup(plaintext);
  } catch {
    throw new Error("The backup password is incorrect, or the encrypted file was altered.");
  }
}
