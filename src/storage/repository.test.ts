import { describe, expect, it, vi } from "vitest";
import {
  clearLegacyLocalData,
  hasLegacyLocalData,
  loadLegacyLocalData,
  STORAGE_KEY,
} from "./legacyBrowserData";
import { parseBackup, serializeBackup } from "./backup";
import { emptyData } from "./schema";
import { saveAuthoritativeData, type DataRepository } from "./repository";

describe("legacy local data migration helpers", () => {
  it("detects, loads, and clears the old browser financial payload", () => {
    clearLegacyLocalData();
    expect(hasLegacyLocalData()).toBe(false);
    expect(loadLegacyLocalData()).toBeNull();

    const data = emptyData();
    data.settings.members = [{ id: "owner", name: "Owner", color: "#5b8cff", portions: [{ id: "por_owner", label: "Monthly income", amount: 1000, currency: "USD", taxRate: 0, taxWithheld: true, window: null, schedule: { frequency: "monthly" }, budgetTreatment: "ordinary" }] }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

    expect(hasLegacyLocalData()).toBe(true);
    expect(loadLegacyLocalData()).toEqual(data);

    clearLegacyLocalData();
    expect(hasLegacyLocalData()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("round-trips versioned backups and keeps recognizing prior raw exports", () => {
    const data = emptyData();
    data.settings.currency = "LKR";
    expect(parseBackup(serializeBackup(data))).toEqual(data);
    expect(parseBackup(JSON.stringify(data))).toEqual(data);
  });

  it("rejects unrelated JSON instead of converting it into an empty household", () => {
    expect(() => parseBackup("{}")).toThrow("not a recognizable Mizan backup");
    expect(() => parseBackup("[]")).toThrow("not a recognizable Mizan backup");
    expect(() => parseBackup(JSON.stringify({ product: "mizan", backupVersion: 2, appData: emptyData() })))
      .toThrow("newer Mizan backup format");
  });
});

describe("authoritative household writes", () => {
  it("waits for an already-queued save before committing the destructive snapshot", async () => {
    let finishPending!: () => void;
    const pending = new Promise<void>((resolve) => {
      finishPending = resolve;
    });
    const nextData = emptyData();
    const repository: DataRepository = {
      mode: "cloud",
      load: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const accept = vi.fn();

    const write = saveAuthoritativeData(repository, pending, nextData, accept);
    await Promise.resolve();
    expect(repository.save).not.toHaveBeenCalled();

    finishPending();
    await write;

    expect(repository.save).toHaveBeenCalledWith(nextData);
    expect(accept).toHaveBeenCalledWith(nextData);
  });

  it("restores the server snapshot and rethrows when the destructive save fails", async () => {
    const localData = emptyData();
    localData.transactions = [{
      id: "local", date: "2026-07-01", description: "LOCAL", amount: 1, category: "food",
      beneficiary: { type: "household" }, account: "", note: "", source: "manual", direction: "debit", kind: "expense",
    }];
    const serverData = emptyData();
    serverData.settings.currency = "LKR";
    const failure = new Error("offline");
    const repository: DataRepository = {
      mode: "cloud",
      load: vi.fn().mockResolvedValue(serverData),
      save: vi.fn().mockRejectedValue(failure),
    };
    const accept = vi.fn();

    await expect(saveAuthoritativeData(repository, Promise.resolve(), localData, accept)).rejects.toBe(failure);
    expect(repository.load).toHaveBeenCalledOnce();
    expect(accept).toHaveBeenCalledWith(serverData);
    expect(accept).not.toHaveBeenCalledWith(localData);
  });
});
