import { describe, expect, it } from "vitest";
import { computeAccountCoverage, coverageLabel, importedAccountCoverageCandidates } from "./accountCoverage";
import type { Account, Member } from "./types";

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
});
