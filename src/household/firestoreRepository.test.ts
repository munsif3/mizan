import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase/firestore";
import type { Transaction } from "../domain/types";
import { emptyData } from "../storage/schema";
import { appDataToCloudCollections } from "./households";

const firestore = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join("/") }),
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join("/") }),
  getDoc: firestore.getDoc,
  getDocs: firestore.getDocs,
  onSnapshot: firestore.onSnapshot,
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  writeBatch: vi.fn(() => ({ set: vi.fn(), delete: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) })),
}));

import { FirestoreHouseholdRepository } from "./firestoreRepository";

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
    firestore.onSnapshot.mockReturnValue(() => undefined);
  });

  it("starts every collection read concurrently and preserves collection order", async () => {
    firestore.getDoc.mockResolvedValue(docSnapshot(cloud.settings));
    const reads = new Map<string, Deferred<ReturnType<typeof collectionSnapshot>>>();
    firestore.getDocs.mockImplementation((ref: { path: string }) => {
      const read = deferred<ReturnType<typeof collectionSnapshot>>();
      reads.set(ref.path, read);
      return read.promise;
    });

    const load = new FirestoreHouseholdRepository(db, "household-1", "user-1").load();
    await vi.waitFor(() => expect(firestore.getDocs).toHaveBeenCalledTimes(10));

    const early: Transaction = {
      id: "early",
      date: "2026-07-01",
      description: "EARLY",
      amount: 10,
      category: "uncategorized",
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

  it("keeps the legacy document fallback when split settings do not exist", async () => {
    const legacy = emptyData();
    legacy.settings.currency = "LKR";
    firestore.getDoc
      .mockResolvedValueOnce(docSnapshot(null))
      .mockResolvedValueOnce(docSnapshot({ appData: legacy }));

    const data = await new FirestoreHouseholdRepository(db, "household-1", "user-1").load();

    expect(data.settings.currency).toBe("LKR");
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it("rejects the complete load instead of returning partial financial data", async () => {
    firestore.getDoc.mockResolvedValue(docSnapshot(cloud.settings));
    firestore.getDocs.mockImplementation((ref: { path: string }) =>
      ref.path.endsWith("/accounts")
        ? Promise.reject(new Error("accounts unavailable"))
        : Promise.resolve(collectionSnapshot()),
    );

    await expect(new FirestoreHouseholdRepository(db, "household-1", "user-1").load())
      .rejects.toThrow("accounts unavailable");
    expect(firestore.getDocs).toHaveBeenCalledTimes(10);
  });

  it("skips only the listener snapshot represented by the completed initial load", async () => {
    firestore.getDoc.mockResolvedValue(docSnapshot(cloud.settings));
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

    snapshotListener?.(docSnapshot(cloud.settings));
    await Promise.resolve();
    expect(firestore.getDocs).toHaveBeenCalledTimes(readsAfterLoad);
    expect(onData).not.toHaveBeenCalled();

    snapshotListener?.(docSnapshot({ ...cloud.settings, updatedAt: "2026-07-12T01:00:00.000Z" }));
    await vi.waitFor(() => expect(onData).toHaveBeenCalledTimes(1));
    expect(firestore.getDocs).toHaveBeenCalledTimes(readsAfterLoad + 10);
  });
});
