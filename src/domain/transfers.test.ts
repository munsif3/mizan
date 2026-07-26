import { describe, expect, it } from "vitest";
import { accountForTransaction } from "./accounts";
import { maximumCardinalityMinCostMatch } from "./matching";
import { netAmount } from "./transactionMath";
import { detectTransferCandidates, type TransferCandidate } from "./transfers";
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

function naiveTransferCandidates(
  transactions: Transaction[],
  accounts: Account[],
  windowDays: number,
  includeConfirmed: boolean,
  rankCompatibleDescriptions: boolean,
): TransferCandidate[] {
  const accountIdOf = (row: Transaction) => {
    const account = accountForTransaction(row, accounts);
    return account && account.owner !== "unassigned" ? account.id : undefined;
  };
  const eligible = (row: Transaction, direction: Transaction["direction"]) =>
    row.direction === direction
    && !row.linkedTransferId
    && (
      row.kind === (direction === "debit" ? "expense" : "account_credit")
      || (includeConfirmed && row.kind === "internal_transfer")
    )
    && Boolean(accountIdOf(row));
  const tokenSet = (description: string) => new Set(
    description.toUpperCase().split(/[^A-Z0-9]+/).filter((word) => word.length >= 3),
  );
  const compatible = (a: string, b: string) => {
    const left = tokenSet(a);
    const right = tokenSet(b);
    if (!left.size || !right.size) return true;
    for (const token of left) if (right.has(token)) return true;
    return false;
  };
  const daysBetween = (a: string, b: string) => {
    const left = Date.parse(`${a}T00:00:00Z`);
    const right = Date.parse(`${b}T00:00:00Z`);
    if (Number.isNaN(left) || Number.isNaN(right)) return Number.POSITIVE_INFINITY;
    return Math.abs(Math.round((left - right) / 86_400_000));
  };
  const debits = transactions.filter((row) => eligible(row, "debit"));
  const credits = transactions.filter((row) => eligible(row, "credit"));
  const possible: Array<{ left: string; right: string; cost: number; value: TransferCandidate }> = [];
  for (const debit of debits) {
    for (const credit of credits) {
      if (accountIdOf(credit) === accountIdOf(debit)) continue;
      if (debit.rejectedTransferIds?.includes(credit.id) || credit.rejectedTransferIds?.includes(debit.id)) continue;
      if (Math.abs(netAmount(credit) - netAmount(debit)) > 0.005) continue;
      const daysApart = daysBetween(debit.date, credit.date);
      if (daysApart > windowDays) continue;
      possible.push({
        left: debit.id,
        right: credit.id,
        cost: daysApart * 100 + (rankCompatibleDescriptions && !compatible(debit.description, credit.description) ? 25 : 0),
        value: { debit, credit, daysApart },
      });
    }
  }
  return maximumCardinalityMinCostMatch(possible).sort(
    (a, b) => a.daysApart - b.daysApart || netAmount(b.debit) - netAmount(a.debit) || a.debit.id.localeCompare(b.debit.id),
  );
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

  it("finds the matching leg when a later statement import completes the pair", () => {
    const firstImport = txn({
      id: "d",
      account: "HNB Savings",
      direction: "debit",
      date: "2026-07-01",
      kind: "internal_transfer",
      description: "ONLINE TRANSFER OUT",
    });
    const laterImport = txn({
      id: "c",
      account: "NTB Current",
      direction: "credit",
      date: "2026-07-05",
      description: "CASH DEPOSIT",
    });
    expect(detectTransferCandidates([firstImport], ACCOUNTS, undefined, true)).toHaveLength(0);
    expect(detectTransferCandidates([firstImport, laterImport], ACCOUNTS, undefined, true)).toHaveLength(1);
  });

  it("does not re-suggest rejected or already linked pairs", () => {
    const debit = txn({
      id: "d",
      account: "HNB Savings",
      direction: "debit",
      rejectedTransferIds: ["c"],
    });
    const credit = txn({ id: "c", account: "NTB Current", direction: "credit" });
    expect(detectTransferCandidates([debit, credit], ACCOUNTS)).toHaveLength(0);
    expect(detectTransferCandidates([
      { ...debit, rejectedTransferIds: undefined, linkedTransferId: "c", kind: "internal_transfer" },
      { ...credit, linkedTransferId: "d", kind: "internal_transfer" },
    ], ACCOUNTS, undefined, true)).toHaveLength(0);
  });

  it("matches the whole-ledger reference across month boundaries, split amounts, and ambiguous pairs", () => {
    const transactions = [
      txn({
        id: "d-split",
        account: "HNB Savings",
        direction: "debit",
        date: "2026-07-31",
        amount: 200.0078125,
        split: { mine: 1, of: 2 },
        description: "ONLINE TRANSFER SCHOOL",
      }),
      txn({
        id: "d-other",
        account: "Cash",
        direction: "debit",
        date: "2026-08-02",
        amount: 100.00390625,
        description: "CASH MOVE",
      }),
      txn({
        id: "c-compatible",
        account: "NTB Current",
        direction: "credit",
        date: "2026-08-01",
        amount: 100.0078125,
        description: "SCHOOL TRANSFER",
      }),
      txn({
        id: "c-incompatible",
        account: "NTB Current",
        direction: "credit",
        date: "2026-08-02",
        amount: 100.00390625,
        description: "CASH DEPOSIT",
      }),
      txn({
        id: "c-outside-tolerance",
        account: "NTB Current",
        direction: "credit",
        date: "2026-08-01",
        amount: 100.01171875,
      }),
      txn({
        id: "c-outside-window",
        account: "NTB Current",
        direction: "credit",
        date: "2026-08-20",
        amount: 100.00390625,
      }),
      txn({
        id: "c-same-account",
        account: "HNB Savings",
        direction: "credit",
        date: "2026-08-01",
        amount: 100.00390625,
      }),
    ];

    for (const [windowDays, includeConfirmed, rankDescriptions] of [
      [5, false, true],
      [1.5, false, true],
      [5, false, false],
      [400, false, true],
    ] as const) {
      const actual = detectTransferCandidates(
        transactions,
        ACCOUNTS,
        windowDays,
        includeConfirmed,
        rankDescriptions,
      );
      const reference = naiveTransferCandidates(
        transactions,
        ACCOUNTS,
        windowDays,
        includeConfirmed,
        rankDescriptions,
      );
      expect(actual.map(({ debit, credit, daysApart }) => [debit.id, credit.id, daysApart]))
        .toEqual(reference.map(({ debit, credit, daysApart }) => [debit.id, credit.id, daysApart]));
    }
  });

  it("preserves the reference behavior and result ordering for confirmed, rejected, and unusual-window rows", () => {
    const transactions = [
      txn({
        id: "d-confirmed",
        account: "HNB Savings",
        direction: "debit",
        date: "not-a-date",
        kind: "internal_transfer",
        amount: 75,
      }),
      txn({
        id: "d-default",
        account: "Cash",
        direction: "debit",
        date: "2026-07-10",
        amount: 125,
      }),
      txn({
        id: "c-confirmed",
        account: "NTB Current",
        direction: "credit",
        date: "also-not-a-date",
        kind: "internal_transfer",
        amount: 75,
      }),
      txn({
        id: "c-default",
        account: "HNB Savings",
        direction: "credit",
        date: "2026-07-10",
        amount: 125,
      }),
      txn({
        id: "c-rejected",
        account: "NTB Current",
        direction: "credit",
        date: "2026-07-10",
        amount: 125,
        rejectedTransferIds: ["d-default"],
      }),
    ];

    for (const windowDays of [0, Number.POSITIVE_INFINITY, Number.NaN, -1]) {
      const actual = detectTransferCandidates(transactions, ACCOUNTS, windowDays, true);
      const reference = naiveTransferCandidates(transactions, ACCOUNTS, windowDays, true, true);
      expect(actual.map(({ debit, credit, daysApart }) => [debit.id, credit.id, daysApart]))
        .toEqual(reference.map(({ debit, credit, daysApart }) => [debit.id, credit.id, daysApart]));
    }
  });
});
