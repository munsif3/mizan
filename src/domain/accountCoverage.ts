import { accountActiveOn } from "./memberLifecycle";
import type { Account, Member, Transaction } from "./types";

export interface AccountCoverageRow {
  account: Account;
  ownerLabel: string;
  throughDate: string;
  ageDays: number | null;
  status: "current" | "stale" | "missing";
}

export interface ImportedAccountCoverageCandidate {
  accountId: string;
  label: string;
  suggestedThroughDate: string;
}

export function importedAccountCoverageCandidates(
  transactions: Pick<Transaction, "accountId" | "date">[],
  accounts: Account[],
  today: string,
): ImportedAccountCoverageCandidate[] {
  const throughByAccount = new Map<string, string>();
  for (const transaction of transactions) {
    if (!transaction.accountId || transaction.date > today) continue;
    const account = accounts.find((item) => item.id === transaction.accountId);
    if (!account || !accountActiveOn(account, today)) continue;
    const previous = throughByAccount.get(account.id) ?? "";
    if (transaction.date > previous) throughByAccount.set(account.id, transaction.date);
  }
  return [...throughByAccount.entries()]
    .map(([accountId, suggestedThroughDate]) => ({
      accountId,
      label: accounts.find((account) => account.id === accountId)?.label ?? "Account",
      suggestedThroughDate,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function calendarAgeDays(throughDate: string, today: Date): number | null {
  if (!throughDate) return null;
  const through = Date.parse(`${throughDate}T00:00:00Z`);
  const current = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  if (!Number.isFinite(through)) return null;
  return Math.max(0, Math.floor((current - through) / 86_400_000));
}

export function computeAccountCoverage(
  accounts: Account[],
  members: Member[],
  today: Date,
  staleAfterDays = 7,
): AccountCoverageRow[] {
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const names = new Map(members.map((member) => [member.id, member.name]));
  return accounts
    .filter((account) => accountActiveOn(account, date))
    .map((account) => {
      const throughDate = account.coverage?.throughDate ?? "";
      const ageDays = calendarAgeDays(throughDate, today);
      return {
        account,
        ownerLabel: account.owner === "joint" ? "Household" : names.get(account.owner) ?? "Former member",
        throughDate,
        ageDays,
        status: ageDays === null ? "missing" as const : ageDays >= staleAfterDays ? "stale" as const : "current" as const,
      };
    })
    .sort((left, right) => {
      const rank = { missing: 0, stale: 1, current: 2 } as const;
      return rank[left.status] - rank[right.status]
        || (right.ageDays ?? Number.MAX_SAFE_INTEGER) - (left.ageDays ?? Number.MAX_SAFE_INTEGER)
        || left.account.label.localeCompare(right.account.label);
    });
}

export function coverageLabel(rows: AccountCoverageRow[]): string {
  if (!rows.length) return "No tracked accounts";
  const missing = rows.filter((row) => row.status === "missing").length;
  const stale = rows.filter((row) => row.status === "stale").length;
  if (missing) return `${missing} account${missing === 1 ? "" : "s"} not confirmed`;
  if (stale) return `${stale} account${stale === 1 ? "" : "s"} behind`;
  const through = rows.map((row) => row.throughDate).filter(Boolean).sort()[0];
  return through ? `Current through ${through}` : "Coverage incomplete";
}
