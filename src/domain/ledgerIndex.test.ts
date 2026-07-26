import { describe, expect, it } from "vitest";
import { monthOf } from "./dates";
import { ledgerIndexFor } from "./ledgerIndex";
import { netAmount } from "./transactionMath";
import type { Transaction } from "./types";

function transaction(
  id: string,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id,
    date: "2026-07-01",
    description: id,
    amount: 1_000,
    category: "uncategorized",
    beneficiary: { type: "unassigned" },
    account: "Everyday Card",
    note: "",
    source: "imported",
    direction: "debit",
    kind: "expense",
    ...overrides,
  };
}

describe("ledgerIndexFor", () => {
  it("indexes months and durable commitment, holding, and account ids without changing row order", () => {
    const transactions = [
      transaction("first", {
        date: "2026-06-30",
        commitmentId: "rent",
        holdingId: "fund",
        accountId: "card",
      }),
      transaction("second", {
        date: "2026-07-01",
        commitmentId: "rent",
        accountId: "card",
      }),
      transaction("third", {
        date: "2026-07-15",
        holdingId: "fund",
        accountId: "cash",
      }),
    ];
    const index = ledgerIndexFor(transactions);

    expect(index.forMonth("2026-07").map((row) => row.id)).toEqual(["second", "third"]);
    expect(index.forCommitment("rent").map((row) => row.id)).toEqual(["first", "second"]);
    expect(index.forHolding("fund").map((row) => row.id)).toEqual(["first", "third"]);
    expect(index.forAccount({ kind: "id", value: "card" }).map((row) => row.id)).toEqual(["first", "second"]);
    expect(index.forCommitment("missing")).toEqual([]);
  });

  it("normalizes account labels, effective amounts, and dates for lookups", () => {
    const transactions = [
      transaction("split", {
        date: "2026-07-02",
        account: "  Family   VISA ",
        amount: 100.008,
        split: { mine: 1, of: 2 },
      }),
      transaction("whole", {
        date: "2026-07-02",
        account: "family visa",
        amount: 50.004,
      }),
      transaction("other-day", {
        date: "2026-07-03",
        account: "Family Visa",
        amount: 50,
      }),
    ];
    const index = ledgerIndexFor(transactions);

    expect(index.forAccount({ kind: "label", value: " FAMILY visa " }).map((row) => row.id))
      .toEqual(["split", "whole", "other-day"]);
    expect(index.forAmountOnDate(50, "2026-07-02T09:30:00Z").map((row) => row.id))
      .toEqual(["split", "whole"]);
    expect(index.forAmountOnDate(50, "2026-07-03").map((row) => row.id))
      .toEqual(["other-day"]);
  });

  it("keeps account-id and display-label namespaces separate", () => {
    const transactions = [
      transaction("linked", { accountId: "family", account: "Old label" }),
      transaction("label-only", { account: "family" }),
    ];
    const index = ledgerIndexFor(transactions);

    expect(index.forAccount({ kind: "id", value: "family" }).map((row) => row.id)).toEqual(["linked"]);
    expect(index.forAccount({ kind: "label", value: "family" }).map((row) => row.id)).toEqual(["label-only"]);
  });

  it("returns an ordered candidate superset at minor-unit tolerance boundaries", () => {
    const transactions = [
      transaction("below", { amount: 99.9951 }),
      transaction("exact", { amount: 100 }),
      transaction("above", { amount: 100.0049 }),
      transaction("outside-nearby-bucket", { amount: 100.014 }),
      transaction("far", { amount: 100.03 }),
      transaction("other-date", { amount: 100, date: "2026-07-02" }),
    ];
    const candidates = ledgerIndexFor(transactions).forAmountNearOnDate(100, "2026-07-01", 0.005);

    expect(candidates.map((row) => row.id)).toEqual([
      "below",
      "exact",
      "above",
      "outside-nearby-bucket",
    ]);
    expect(candidates).not.toContain(transactions[4]);
    expect(candidates).not.toContain(transactions[5]);
  });

  it("is equivalent to direct filtering across every supported lookup", () => {
    const months = ["2026-05", "2026-06", "2026-07"];
    const transactions = Array.from({ length: 36 }, (_, index) => transaction(`row-${index}`, {
      date: `${months[index % months.length]}-${String((index % 27) + 1).padStart(2, "0")}`,
      amount: 100 + (index % 4) * 25,
      account: index % 2 ? "Main Card" : "Cash",
      ...(index % 3 === 0 ? { accountId: `account-${index % 2}` } : {}),
      ...(index % 4 === 0 ? { commitmentId: `commitment-${index % 3}` } : {}),
      ...(index % 5 === 0 ? { holdingId: `holding-${index % 2}` } : {}),
    }));
    const index = ledgerIndexFor(transactions);

    for (const month of months) {
      expect(index.forMonth(month)).toEqual(
        transactions.filter((row) => monthOf(row.date) === month),
      );
    }
    for (const commitmentId of ["commitment-0", "commitment-1", "commitment-2"]) {
      expect(index.forCommitment(commitmentId)).toEqual(
        transactions.filter((row) => row.commitmentId === commitmentId),
      );
    }
    for (const holdingId of ["holding-0", "holding-1"]) {
      expect(index.forHolding(holdingId)).toEqual(
        transactions.filter((row) => row.holdingId === holdingId),
      );
    }
    for (const row of transactions.slice(0, 8)) {
      expect(index.forAmountOnDate(netAmount(row), row.date)).toEqual(
        transactions.filter((candidate) =>
          candidate.date === row.date
          && Math.round(netAmount(candidate) * 100) === Math.round(netAmount(row) * 100)),
      );
    }
  });

  it("reuses one index per array revision and rebuilds for a replacement array", () => {
    const firstRevision = [transaction("first")];
    const sameRevision = ledgerIndexFor(firstRevision);

    expect(ledgerIndexFor(firstRevision)).toBe(sameRevision);

    const nextRevision = [...firstRevision, transaction("second")];
    const nextIndex = ledgerIndexFor(nextRevision);
    expect(nextIndex).not.toBe(sameRevision);
    expect(nextIndex.forMonth("2026-07").map((row) => row.id)).toEqual(["first", "second"]);
  });

  it("defends against a row replacement inside a reused array", () => {
    const transactions = [transaction("row", { date: "2026-06-01" })];
    const first = ledgerIndexFor(transactions);
    transactions[0] = transaction("row", { date: "2026-07-01" });

    const rebuilt = ledgerIndexFor(transactions);

    expect(rebuilt).not.toBe(first);
    expect(rebuilt.forMonth("2026-06")).toEqual([]);
    expect(rebuilt.forMonth("2026-07").map((row) => row.id)).toEqual(["row"]);
  });
});
