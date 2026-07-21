import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase/firestore";
import type { Transaction } from "../domain/types";
import { emptyData } from "../storage/schema";
import { appDataToCloudCollections } from "./households";

const firestore = vi.hoisted(() => ({
  batchDelete: vi.fn(),
  batchSet: vi.fn(),
  batchUpdate: vi.fn(),
  batchCommit: vi.fn(),
  deleteField: vi.fn(() => "DELETE_FIELD"),
  deleteDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
  runTransaction: vi.fn(),
  setDoc: vi.fn(),
  transactionSet: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  collection: (base: { path?: string }, ...parts: string[]) => ({ path: [base?.path, ...parts].filter(Boolean).join("/") }),
  deleteDoc: firestore.deleteDoc,
  deleteField: firestore.deleteField,
  doc: (base: { path?: string }, ...parts: string[]) => ({ path: [base?.path, ...parts].filter(Boolean).join("/") }),
  getDoc: firestore.getDoc,
  getDocs: firestore.getDocs,
  onSnapshot: firestore.onSnapshot,
  runTransaction: firestore.runTransaction,
  setDoc: firestore.setDoc,
  serverTimestamp: vi.fn(() => "SERVER_TIMESTAMP"),
  updateDoc: vi.fn(),
  writeBatch: firestore.writeBatch,
}));

import {
  FirestoreHouseholdRepository,
  loadUserProfile,
  promoteFirestoreHouseholdOwner,
  revokeFirestoreHouseholdAccess,
} from "./firestoreRepository";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function docSnapshot(data: unknown | null) {
  return {
    exists: () => data !== null,
    data: () => data,
  };
}

function collectionSnapshot(items: Array<{ id: string; data: unknown }> = []) {
  return {
    docs: items.map((item) => ({ id: item.id, data: () => item.data })),
  };
}

describe("Firestore household loading", () => {
  const db = {} as Firestore;
  const cloud = appDataToCloudCollections(emptyData(), "user-1", "2026-07-12T00:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    firestore.setDoc.mockResolvedValue(undefined);
    firestore.transactionSet.mockReset();
    firestore.runTransaction.mockImplementation(async (_db: unknown, update: (transaction: unknown) => Promise<unknown>) => update({
      get: firestore.getDoc,
      set: firestore.transactionSet,
      delete: vi.fn(),
    }));
    firestore.writeBatch.mockImplementation(() => ({
      set: firestore.batchSet,
      update: firestore.batchUpdate,
      delete: firestore.batchDelete,
      commit: firestore.batchCommit.mockResolvedValue(undefined),
    }));
    firestore.onSnapshot.mockReturnValue(() => undefined);
    firestore.getDoc.mockImplementation((ref: { path: string }) => {
      if (ref.path.endsWith("snapshotManifest/current")) return Promise.resolve(docSnapshot(null));
      if (ref.path.endsWith("settings/current")) return Promise.resolve(docSnapshot(cloud.settings));
      return Promise.resolve(docSnapshot(null));
    });
  });

  it("starts every collection read concurrently and preserves collection order", async () => {
    const reads = new Map<string, Deferred<ReturnType<typeof collectionSnapshot>>>();
    firestore.getDocs.mockImplementation((ref: { path: string }) => {
      const read = deferred<ReturnType<typeof collectionSnapshot>>();
      reads.set(ref.path, read);
      return read.promise;
    });

    const load = new FirestoreHouseholdRepository(db, "household-1", "user-1").load();
    await vi.waitFor(() => expect(firestore.getDocs).toHaveBeenCalledTimes(11));

    const early: Transaction = {
      id: "early",
      date: "2026-07-01",
      description: "EARLY",
      amount: 10,
      category: "uncategorized",
      beneficiary: { type: "unassigned" },
      account: "",
      note: "",
      source: "manual",
      direction: "debit",
      kind: "expense",
    };
    const late: Transaction = { ...early, id: "late", date: "2026-07-02", description: "LATE" };
    for (const [path, read] of reads) {
      read.resolve(
        path.endsWith("/transactions")
          ? collectionSnapshot([
              { id: late.id, data: { ...late, __order: 1 } },
              { id: early.id, data: { ...early, __order: 0 } },
            ])
          : collectionSnapshot(),
      );
    }

    const data = await load;
    expect(data.transactions.map((item) => item.id)).toEqual(["early", "late"]);
  });

  it("keeps the split-collection fallback until a revision manifest is published", async () => {
    const split = { ...cloud.settings, currency: "LKR" };
    firestore.getDoc.mockImplementation((ref: { path: string }) => Promise.resolve(
      docSnapshot(ref.path.endsWith("settings/current") ? split : null),
    ));
    firestore.getDocs.mockResolvedValue(collectionSnapshot());

    const data = await new FirestoreHouseholdRepository(db, "household-1", "user-1").load();

    expect(data.settings.currency).toBe("LKR");
    expect(firestore.getDocs).toHaveBeenCalledTimes(11);
  });

  it("loads independent beneficiary and payer filters from the user profile", async () => {
    firestore.getDoc.mockResolvedValue(docSnapshot({
      activeHouseholdId: "household-1",
      privacy: true,
      lastView: "transactions",
      lastMonth: "2026-07",
      categoryFilter: "food",
      beneficiaryFilter: "member:ana",
      payerFilter: "joint",
      lastCheckInByHousehold: {},
      updatedAt: "2026-07-12T00:00:00.000Z",
    }));

    const loaded = await loadUserProfile(db, "user-1");
    expect(loaded).toMatchObject({
      categoryFilter: "food",
      beneficiaryFilter: "member:ana",
      payerFilter: "joint",
    });
  });

  it("resets the ambiguous legacy owner filter instead of guessing two meanings", async () => {
    firestore.getDoc.mockResolvedValue(docSnapshot({
      activeHouseholdId: "household-1",
      privacy: false,
      lastView: "transactions",
      lastMonth: "2026-07",
      categoryFilter: "food",
      ownerFilter: "ana",
      lastCheckInByHousehold: {},
      updatedAt: "2026-07-12T00:00:00.000Z",
    }));

    const loaded = await loadUserProfile(db, "user-1");
    expect(loaded.beneficiaryFilter).toBe("all");
    expect(loaded.payerFilter).toBe("all");
    expect(loaded).not.toHaveProperty("ownerFilter");
  });

  it("rejects the complete load instead of returning partial financial data", async () => {
    firestore.getDocs.mockImplementation((ref: { path: string }) =>
      ref.path.endsWith("/accounts")
        ? Promise.reject(new Error("accounts unavailable"))
        : Promise.resolve(collectionSnapshot()),
    );

    await expect(new FirestoreHouseholdRepository(db, "household-1", "user-1").load())
      .rejects.toThrow("accounts unavailable");
    expect(firestore.getDocs).toHaveBeenCalledTimes(11);
  });

  it("skips only the listener snapshot represented by the completed initial load", async () => {
    const manifest = { schemaVersion: 1, activeRevision: "rev_1", updatedAt: "2026-07-12T00:00:00.000Z", updatedBy: "user-1" };
    firestore.getDoc.mockImplementation((ref: { path: string }) => Promise.resolve(
      docSnapshot(ref.path.endsWith("snapshotManifest/current") ? manifest : ref.path.endsWith("snapshots/rev_1") ? cloud.settings : null),
    ));
    firestore.getDocs.mockResolvedValue(collectionSnapshot());
    let snapshotListener: ((snapshot: ReturnType<typeof docSnapshot>) => void) | undefined;
    firestore.onSnapshot.mockImplementation((_ref: unknown, onData: typeof snapshotListener) => {
      snapshotListener = onData;
      return () => undefined;
    });
    const repository = new FirestoreHouseholdRepository(db, "household-1", "user-1");
    await repository.load();
    const onData = vi.fn();
    repository.subscribe(onData, vi.fn(), { skipInitial: true });
    const readsAfterLoad = firestore.getDocs.mock.calls.length;

    snapshotListener?.(docSnapshot(manifest));
    await Promise.resolve();
    expect(firestore.getDocs).toHaveBeenCalledTimes(readsAfterLoad);
    expect(onData).not.toHaveBeenCalled();

    snapshotListener?.(docSnapshot({ ...manifest, updatedAt: "2026-07-12T01:00:00.000Z" }));
    await vi.waitFor(() => expect(onData).toHaveBeenCalledTimes(1));
    expect(firestore.getDocs).toHaveBeenCalledTimes(readsAfterLoad + 11);
  });

  it("rejects a stale save instead of overwriting a newer household revision", async () => {
    let manifest = { schemaVersion: 1, activeRevision: "rev_1", versionToken: "write_1", updatedAt: "2026-07-12T00:00:00.000Z", updatedBy: "user-1" };
    firestore.getDoc.mockImplementation((ref: { path: string }) => Promise.resolve(
      docSnapshot(ref.path.endsWith("snapshotManifest/current") ? manifest : ref.path.endsWith("snapshots/rev_1") ? cloud.settings : null),
    ));
    firestore.getDocs.mockResolvedValue(collectionSnapshot());
    const repository = new FirestoreHouseholdRepository(db, "household-1", "user-1");
    await repository.load();

    // Deliberately retain the revision and timestamp: the unique write token,
    // not wall-clock precision, must detect the competing commit.
    manifest = { ...manifest, versionToken: "write_2", updatedBy: "user-2" };

    await expect(repository.save(emptyData())).rejects.toThrow(/changed on another device/i);
    expect(firestore.transactionSet).not.toHaveBeenCalled();
  });

  it("publishes a large replacement only after every staged snapshot batch succeeds", async () => {
    const events: string[] = [];
    firestore.writeBatch.mockImplementation(() => ({
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn(async () => { events.push("batch"); }),
    }));
    firestore.transactionSet.mockImplementation((ref: { path: string }) => { events.push(ref.path); });
    const data = emptyData();
    data.transactions = Array.from({ length: 500 }, (_, index): Transaction => ({
      id: `txn-${index}`,
      date: "2026-07-01",
      description: `ROW ${index}`,
      amount: index + 1,
      category: "food",
      beneficiary: { type: "household" },
      account: "",
      note: "",
      source: "imported",
      direction: "debit",
      kind: "expense",
    }));

    await new FirestoreHouseholdRepository(db, "household-1", "user-1").save(data);

    expect(events.slice(0, -1)).toEqual(["batch", "batch"]);
    expect(events.at(-1)).toBe("households/household-1/snapshotManifest/current");
  });

  it("does not publish a manifest when a staged replacement batch fails", async () => {
    let batchNumber = 0;
    firestore.writeBatch.mockImplementation(() => {
      batchNumber += 1;
      return {
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        commit: batchNumber === 2 ? vi.fn().mockRejectedValue(new Error("batch failed")) : vi.fn().mockResolvedValue(undefined),
      };
    });
    const data = emptyData();
    data.transactions = Array.from({ length: 500 }, (_, index): Transaction => ({
      id: `txn-${index}`,
      date: "2026-07-01",
      description: `ROW ${index}`,
      amount: index + 1,
      category: "food",
      beneficiary: { type: "household" },
      account: "",
      note: "",
      source: "imported",
      direction: "debit",
      kind: "expense",
    }));

    await expect(new FirestoreHouseholdRepository(db, "household-1", "user-1").save(data)).rejects.toThrow("batch failed");
    expect(firestore.transactionSet).not.toHaveBeenCalled();
  });

  it("prunes obsolete snapshot revisions after a full publish, keeping recent ones", async () => {
    const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    const deleted: string[] = [];
    firestore.writeBatch.mockImplementation(() => ({
      set: vi.fn(),
      update: vi.fn(),
      delete: (ref: { path: string }) => { deleted.push(ref.path); },
      commit: vi.fn().mockResolvedValue(undefined),
    }));
    firestore.getDocs.mockImplementation((ref: { path: string }) => {
      if (ref.path.endsWith("/snapshots")) {
        return Promise.resolve(collectionSnapshot([
          { id: "rev_stale", data: { updatedAt: stale } },
          { id: "rev_recent", data: { updatedAt: recent } },
        ]));
      }
      if (ref.path.includes("/snapshots/rev_stale/")) {
        return Promise.resolve(collectionSnapshot([{ id: "doc_1", data: {} }]));
      }
      return Promise.resolve(collectionSnapshot());
    });

    // First save has no active revision, so it publishes a full snapshot and
    // then prunes.
    await new FirestoreHouseholdRepository(db, "household-1", "user-1").save(emptyData());

    expect(deleted).toContain("households/household-1/snapshots/rev_stale/transactions/doc_1");
    expect(deleted).toContain("households/household-1/snapshots/rev_stale");
    expect(deleted.every((path) => !path.includes("rev_recent"))).toBe(true);
  });

  it("promotes a recovery owner and can make them primary", async () => {
    const meta = {
      id: "household-1", name: "Home", ownerUid: "user-1", inviteCode: "household-1_invite",
      createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      membersByUid: {
        "user-1": { role: "owner", displayName: "Owner", email: "owner@example.com", joinedAt: "2026-07-01T00:00:00.000Z" },
        "user-2": { role: "member", displayName: "Member", email: "member@example.com", joinedAt: "2026-07-02T00:00:00.000Z" },
      },
    };
    firestore.getDoc.mockResolvedValue(docSnapshot(meta));

    await promoteFirestoreHouseholdOwner(db, "household-1", "user-2", true);

    expect(firestore.batchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: "households/household-1/meta/current" }),
      expect.objectContaining({ "membersByUid.user-2.role": "owner", ownerUid: "user-2" }),
    );
    expect(firestore.batchSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: "users/user-2/households/household-1" }),
      expect.objectContaining({ role: "owner" }),
      { merge: true },
    );
  });

  it("revokes access without deleting budget data and rotates the invite", async () => {
    const meta = {
      id: "household-1", name: "Home", ownerUid: "user-1", inviteCode: "household-1_invite",
      createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      membersByUid: {
        "user-1": { role: "owner", displayName: "Owner", email: "owner@example.com", joinedAt: "2026-07-01T00:00:00.000Z" },
        "user-2": { role: "member", displayName: "Member", email: "member@example.com", joinedAt: "2026-07-02T00:00:00.000Z" },
      },
    };
    firestore.getDoc.mockResolvedValue(docSnapshot(meta));

    await revokeFirestoreHouseholdAccess(db, "household-1", "user-2");

    expect(firestore.batchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: "households/household-1/meta/current" }),
      expect.objectContaining({ "membersByUid.user-2": "DELETE_FIELD" }),
    );
    expect(firestore.batchDelete).toHaveBeenCalledWith(
      expect.objectContaining({ path: "users/user-2/households/household-1" }),
    );
  });
});
