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
  it("keeps one stale member visible even when another account is current", () => {
    const rows = computeAccountCoverage(
      [account("Alex card", "alex", "2026-07-20"), account("Sam card", "sam", "2026-07-05")],
      members,
      new Date(2026, 6, 22),
    );
    expect(rows.map((row) => [row.account.id, row.status])).toEqual([
      ["Sam card", "stale"],
      ["Alex card", "current"],
    ]);
    expect(coverageLabel(rows)).toBe("1 account behind");
  });

  it("excludes an account after its archive date", () => {
    const archived = { ...account("Old card", "sam"), inactiveFrom: "2026-07-15" };
    expect(computeAccountCoverage([archived], members, new Date(2026, 6, 22))).toEqual([]);
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
