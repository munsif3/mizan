import { describe, expect, it } from "vitest";
import { detectTransferCandidates } from "./transfers";
import { defaultKind, type Account, type MovementKind, type Transaction } from "./types";

const ACCOUNTS: Account[] = [
  { id: "hnb", label: "HNB Savings", owner: "alex", beneficiaryDefault: "review", match: [] },
  { id: "ntb", label: "NTB Current", owner: "alex", beneficiaryDefault: "review", match: [] },
  { id: "cash", label: "Cash", owner: "joint", beneficiaryDefault: "review", match: [] },
];

function txn(overrides: Partial<Transaction> & { id: string; account: string; direction: "debit" | "credit" }): Transaction {
  const { kind, ...rest } = overrides;
  return {
    date: "2026-07-01",
    description: "TRANSFER",
    amount: 100_000,
    category: "uncategorized",
    beneficiary: { type: "unassigned" },
    note: "",
    source: "imported",
    kind: (kind ?? defaultKind(overrides.direction)) as MovementKind,
    ...rest,
  };
}

describe("detectTransferCandidates", () => {
  it("pairs a same-amount debit and credit across two owned accounts", () => {
    const candidates = detectTransferCandidates(
      [
        txn({ id: "d", account: "HNB Savings", direction: "debit", date: "2026-07-01" }),
        txn({ id: "c", account: "NTB Current", direction: "credit", date: "2026-07-02" }),
      ],
      ACCOUNTS,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.debit.id).toBe("d");
    expect(candidates[0]!.credit.id).toBe("c");
    expect(candidates[0]!.daysApart).toBe(1);
  });

  it("does not pair legs on the same account", () => {
    const candidates = detectTransferCandidates(
      [
        txn({ id: "d", account: "HNB Savings", direction: "debit" }),
        txn({ id: "c", account: "HNB Savings", direction: "credit" }),
      ],
      ACCOUNTS,
    );
    expect(candidates).toHaveLength(0);
  });

  it("pairs a personal contribution into a registered joint account", () => {
    const candidates = detectTransferCandidates(
      [
        txn({ id: "d", account: "HNB Savings", direction: "debit" }),
        txn({ id: "c", account: "Cash", direction: "credit" }),
      ],
      ACCOUNTS,
    );
    expect(candidates).toHaveLength(1);
  });

  it("does not pair an unregistered account", () => {
    const candidates = detectTransferCandidates(
      [
        txn({ id: "d", account: "HNB Savings", direction: "debit" }),
        txn({ id: "c", account: "Unknown Elsewhere", direction: "credit" }),
      ],
      ACCOUNTS,
    );
    expect(candidates).toHaveLength(0);
  });

  it("does not pair amounts that differ or dates outside the window", () => {
    const differentAmount = detectTransferCandidates(
      [
        txn({ id: "d", account: "HNB Savings", direction: "debit", amount: 100_000 }),
        txn({ id: "c", account: "NTB Current", direction: "credit", amount: 99_000 }),
      ],
      ACCOUNTS,
    );
    expect(differentAmount).toHaveLength(0);

    const farApart = detectTransferCandidates(
      [
        txn({ id: "d", account: "HNB Savings", direction: "debit", date: "2026-07-01" }),
        txn({ id: "c", account: "NTB Current", direction: "credit", date: "2026-07-20" }),
      ],
      ACCOUNTS,
    );
    expect(farApart).toHaveLength(0);
  });

  it("ignores legs already classified as a non-default movement", () => {
    const candidates = detectTransferCandidates(
      [
        txn({ id: "d", account: "HNB Savings", direction: "debit", kind: "internal_transfer" }),
        txn({ id: "c", account: "NTB Current", direction: "credit" }),
      ],
      ACCOUNTS,
    );
    expect(candidates).toHaveLength(0);
  });

  it("uses each leg at most once", () => {
    const candidates = detectTransferCandidates(
      [
        txn({ id: "d1", account: "HNB Savings", direction: "debit", date: "2026-07-01" }),
        txn({ id: "d2", account: "HNB Savings", direction: "debit", date: "2026-07-01" }),
        txn({ id: "c1", account: "NTB Current", direction: "credit", date: "2026-07-01" }),
      ],
      ACCOUNTS,
    );
    expect(candidates).toHaveLength(1);
  });
});
