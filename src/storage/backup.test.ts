import { describe, expect, it } from "vitest";
import { emptyData } from "./schema";
import {
  backupRequiresPassword,
  parseBackup,
  parseEncryptedBackup,
  serializeBackup,
  validateBackupPassword,
} from "./backup";

describe("encrypted backups", () => {
  it("round-trips household data without placing plaintext figures in the export", async () => {
    const data = emptyData();
    data.settings.currency = "LKR";
    data.transactions.push({
      id: "secret-transaction",
      date: "2026-07-22",
      description: "PRIVATE MERCHANT",
      amount: 12_345,
      category: "food",
      beneficiary: { type: "unassigned" },
      account: "Private card",
      note: "",
      source: "manual",
      direction: "debit",
      kind: "expense",
    });

    const encoded = await serializeBackup(data, "correct horse battery staple");
    expect(backupRequiresPassword(encoded)).toBe(true);
    expect(encoded).not.toContain("PRIVATE MERCHANT");
    expect(encoded).not.toContain("secret-transaction");
    const restored = await parseEncryptedBackup(encoded, "correct horse battery staple");
    expect(restored.transactions).toEqual(data.transactions);
    expect(restored.settings.currency).toBe("LKR");
  });

  it("rejects weak export passwords, wrong passwords, and altered ciphertext", async () => {
    expect(() => validateBackupPassword("too short")).toThrow(/12 characters/i);
    const encoded = await serializeBackup(emptyData(), "long enough password");
    await expect(parseEncryptedBackup(encoded, "different password")).rejects.toThrow(/incorrect|altered/i);
    const parsed = JSON.parse(encoded) as { encryption: { ciphertext: string } };
    parsed.encryption.ciphertext = `${parsed.encryption.ciphertext.slice(0, -4)}AAAA`;
    await expect(parseEncryptedBackup(JSON.stringify(parsed), "long enough password")).rejects.toThrow(/incorrect|altered/i);
  });

  it("retains explicit plaintext legacy import compatibility", () => {
    const legacy = JSON.stringify({ schemaVersion: 16, transactions: [], settings: {} });
    expect(backupRequiresPassword(legacy)).toBe(false);
    expect(parseBackup(legacy).transactions).toEqual([]);
  });
});
