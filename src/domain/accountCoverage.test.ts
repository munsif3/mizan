import { describe, expect, it } from "vitest";
import {
  computeAccountCoverage,
  coverageLabel,
  inferStatementDay,
  importedAccountCoverageCandidates,
  statementDayForAccount,
  unmeasuredExposure,
  type AccountCoverageRow,
} from "./accountCoverage";
import type { MonthSummary } from "./summary";
import type { Account, Member, Transaction } from "./types";

const members: Member[] = [
  { id: "alex", name: "Alex", color: "#000000", portions: [] },
  { id: "sam", name: "Sam", color: "#ffffff", portions: [] },
];

function account(id: string, owner: string, throughDate = ""): Account {
  return {
    id, label: id, owner, beneficiaryDefault: "review", match: [],
    ...(throughDate ? { coverage: { throughDate, confirmedAt: `${throughDate}T12:00:00.000Z`, confirmedByUid: "u1", source: "manual" as const } } : {}),
  };
}

function transaction(accountId: string, date: string, amount: number, kind: Transaction["kind"] = "expense"): Transaction {
  return {
    id: `${accountId}-${date}-${amount}-${kind}`,
    date,
    description: "Recorded row",
    amount,
    category: "food",
    beneficiary: { type: "household" },
    account: accountId,
    accountId,
    note: "",
    source: "imported",
    direction: kind === "account_credit" ? "credit" : "debit",
    kind,
  };
}

function historyMonth(month: string, daysInMonth: number, transactions: Transaction[]): MonthSummary {
  return {
    month,
    daysInMonth,
    monthTransactions: transactions,
  } as MonthSummary;
}

function coverageRow(
  trackedAccount: Account,
  status: AccountCoverageRow["status"],
  throughDate = "",
): AccountCoverageRow {
  return {
    account: trackedAccount,
    ownerLabel: "Alex",
    throughDate,
    ageDays: throughDate ? 5 : null,
    nextExpectedDate: null,
    status,
  };
}

describe("account coverage", () => {
  it("keeps one behind account visible even when another is current", () => {
    // Sam's monthly statement closed in May and the next one never arrived.
    const rows = computeAccountCoverage(
      [account("Alex card", "alex", "2026-07-20"), account("Sam card", "sam", "2026-05-05")],
      members,
      new Date(2026, 6, 22),
    );
    expect(rows.map((row) => [row.account.id, row.status])).toEqual([
      ["Sam card", "stale"],
      ["Alex card", "current"],
    ]);
    expect(coverageLabel(rows)).toBe("1 account behind");
  });

  it("keeps a monthly account current all month instead of crying wolf from day 8", () => {
    // The old flat seven-day rule made every monthly-statement household
    // permanently behind from the 8th of every month — a false alarm they could
    // do nothing about, which trains them to ignore the signal entirely.
    const [row] = computeAccountCoverage(
      [account("Main", "alex", "2026-07-01")],
      members,
      new Date(2026, 6, 20),
    );
    expect(row?.status).toBe("current");
    expect(row?.ageDays).toBe(19);
    expect(row?.nextExpectedDate).toBe("2026-08-01");
  });

  it("marks a monthly account behind only once its next statement is genuinely overdue", () => {
    const main = account("Main", "alex", "2026-07-01");
    // Next statement closes 2026-08-01; a few days to actually fetch it is not "behind".
    expect(computeAccountCoverage([main], members, new Date(2026, 7, 5))[0]?.status).toBe("current");
    expect(computeAccountCoverage([main], members, new Date(2026, 7, 12))[0]?.status).toBe("stale");
  });

  it("holds a weekly account to its shorter cycle", () => {
    const weekly = { ...account("Weekly", "alex", "2026-07-01"), cadence: { period: "weekly" as const } };
    expect(computeAccountCoverage([weekly], members, new Date(2026, 6, 10))[0]?.status).toBe("current");
    expect(computeAccountCoverage([weekly], members, new Date(2026, 6, 20))[0]?.status).toBe("stale");
  });

  it("never marks a manually tracked account behind", () => {
    // Cash has no statement cycle, so there is nothing to be late for.
    const manual = { ...account("Cash", "alex", "2026-01-01"), cadence: { period: "manual" as const } };
    const [row] = computeAccountCoverage([manual], members, new Date(2026, 6, 22));
    expect(row?.status).toBe("current");
    expect(row?.nextExpectedDate).toBeNull();
  });

  it("follows an explicit closing day, clamped to short months", () => {
    const endOfMonth = {
      ...account("Card", "alex", "2026-01-31"),
      cadence: { period: "monthly" as const, dueDay: 31 },
    };
    expect(computeAccountCoverage([endOfMonth], members, new Date(2026, 1, 20))[0]?.nextExpectedDate)
      .toBe("2026-02-28");
  });

  it("still reports unconfirmed coverage as missing, whatever the cadence", () => {
    const [row] = computeAccountCoverage([account("New card", "alex")], members, new Date(2026, 6, 22));
    expect(row?.status).toBe("missing");
    expect(row?.nextExpectedDate).toBeNull();
  });

  it("excludes an account after its archive date", () => {
    const archived = { ...account("Old card", "sam"), inactiveFrom: "2026-07-15" };
    expect(computeAccountCoverage([archived], members, new Date(2026, 6, 22))).toEqual([]);
  });

  it("labels unresolved funding explicitly instead of treating it as joint or a former member", () => {
    const [row] = computeAccountCoverage(
      [account("Cash", "unassigned")],
      members,
      new Date(2026, 6, 22),
    );
    expect(row?.ownerLabel).toBe("Funding owner unassigned");
  });

  it("prefills explicit import confirmation without reviving archived accounts", () => {
    const candidates = importedAccountCoverageCandidates([
      { accountId: "card", date: "2026-07-18" },
      { accountId: "card", date: "2026-07-20" },
      { accountId: "closed", date: "2026-07-20" },
      { accountId: "card", date: "2026-07-23" },
    ], [
      { id: "card", label: "Main card", currency: "LKR", owner: "sam", beneficiaryDefault: "review", match: [] },
      { id: "closed", label: "Closed card", currency: "LKR", owner: "sam", beneficiaryDefault: "review", inactiveFrom: "2026-07-01", match: [] },
    ], "2026-07-22");

    expect(candidates).toEqual([{
      accountId: "card",
      label: "Main card",
      suggestedThroughDate: "2026-07-20",
    }]);
  });

  it("uses the median daily recorded spend from the latest three completed months", () => {
    const card = account("card", "alex", "2026-07-15");
    const current = account("current", "sam", "2026-07-20");
    const exposure = unmeasuredExposure([
      coverageRow(card, "stale", "2026-07-15"),
      coverageRow(current, "current", "2026-07-20"),
    ], [
      historyMonth("2026-03", 31, [transaction("card", "2026-03-10", 31_000)]),
      historyMonth("2026-04", 30, [transaction("card", "2026-04-10", 3_000)]),
      historyMonth("2026-05", 31, [transaction("card", "2026-05-10", 6_200)]),
      historyMonth("2026-06", 30, [transaction("card", "2026-06-10", 9_000)]),
      historyMonth("2026-07", 31, [transaction("card", "2026-07-10", 310_000)]),
    ], new Date(2026, 6, 20));

    // Latest completed months are Apr-Jun: 100, 200, and 300 per day.
    // Five exposed days at the median is 1,000.
    expect(exposure).toEqual({
      amount: 1_000,
      throughDate: "2026-07-15",
      accounts: [expect.objectContaining({ account: card, status: "stale" })],
    });
  });

  it("sums account bounds and rounds the household exposure up to the next thousand", () => {
    const first = account("first", "alex", "2026-07-17");
    const second = account("second", "sam", "2026-07-18");
    const exposure = unmeasuredExposure([
      coverageRow(first, "stale", "2026-07-17"),
      coverageRow(second, "stale", "2026-07-18"),
    ], [
      historyMonth("2026-06", 30, [
        transaction("first", "2026-06-10", 3_000),
        transaction("second", "2026-06-11", 6_000),
      ]),
    ], new Date(2026, 6, 20));

    // 3 days * 100 plus 2 days * 200 = 700, rounded up once after summing.
    expect(exposure.amount).toBe(1_000);
    expect(exposure.throughDate).toBe("2026-07-17");
  });

  it("flags never-confirmed accounts and uses elapsed-month history only as a floor", () => {
    const card = account("card", "alex");
    const exposure = unmeasuredExposure([
      coverageRow(card, "missing"),
    ], [
      historyMonth("2026-06", 30, [transaction("card", "2026-06-10", 3_000)]),
    ], new Date(2026, 6, 20));

    expect(exposure.amount).toBe(2_000);
    expect(exposure.throughDate).toBe("");
    expect(exposure.accounts[0]?.status).toBe("missing");
  });

  it("does not treat non-spend movements as unmeasured spending", () => {
    const card = account("card", "alex", "2026-07-10");
    const exposure = unmeasuredExposure([
      coverageRow(card, "stale", "2026-07-10"),
    ], [
      historyMonth("2026-06", 30, [
        transaction("card", "2026-06-10", 30_000, "internal_transfer"),
        transaction("card", "2026-06-11", 3_000, "expense"),
      ]),
    ], new Date(2026, 6, 20));

    expect(exposure.amount).toBe(1_000);
  });

  it("infers a statement arrival day from the median coverage edge and honors an override", () => {
    expect(inferStatementDay(["2026-01-03", "2026-02-04", "2026-03-03"])).toBe(3);
    expect(statementDayForAccount({
      ...account("card", "alex"),
      coverage: {
        throughDate: "2026-03-03",
        confirmedAt: "2026-03-04T00:00:00.000Z",
        confirmedByUid: "u1",
        source: "statement",
        confirmedDates: ["2026-01-03", "2026-02-04", "2026-03-03"],
      },
    })).toBe(3);
    expect(statementDayForAccount({ ...account("card", "alex"), statementDay: 17 })).toBe(17);
  });
});
