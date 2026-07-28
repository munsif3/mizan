import { addDays, addMonths, dayInMonth, monthOf } from "./dates";
import { accountActiveOn } from "./memberLifecycle";
import type { Account, AccountCadence, Member, Transaction } from "./types";

/**
 * Days after a statement cycle closes before the account counts as behind. A
 * statement does not appear the instant its period ends, and the household still
 * has to fetch it, so the deadline is the cycle end plus this.
 */
const COVERAGE_GRACE_DAYS = 5;

export interface AccountCoverageRow {
  account: Account;
  ownerLabel: string;
  throughDate: string;
  ageDays: number | null;
  /** When the next statement is expected. Null for manual accounts, which never go stale. */
  nextExpectedDate: string | null;
  status: "current" | "stale" | "missing";
}

/**
 * The date the next statement is expected to close, given confirmed coverage and
 * the account's rhythm. Absent cadence means monthly — the common case for a bank
 * statement, and the assumption that keeps existing households out of a permanent
 * false alarm. Returns null when the account is never automatically stale.
 */
function nextExpectedCoverage(throughDate: string, cadence: AccountCadence | undefined): string | null {
  if (!throughDate) return null;
  const period = cadence?.period ?? "monthly";
  if (period === "manual") return null;
  if (period === "weekly") return addDays(throughDate, 7);
  // No explicit closing day: assume the same day next month.
  if (!cadence?.dueDay) return dayInMonth(addMonths(monthOf(throughDate), 1), Number(throughDate.slice(8, 10)));
  // An explicit closing day: the next occurrence strictly after the covered date.
  const thisMonth = dayInMonth(monthOf(throughDate), cadence.dueDay);
  return thisMonth > throughDate ? thisMonth : dayInMonth(addMonths(monthOf(throughDate), 1), cadence.dueDay);
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

/**
 * Freshness per active account, judged against each account's own statement
 * rhythm rather than a flat week. A monthly account confirmed through the 1st is
 * current all month; it is only behind once its next statement is genuinely
 * overdue. Crying wolf every month trains the household to ignore the signal.
 */
export function computeAccountCoverage(
  accounts: Account[],
  members: Member[],
  today: Date,
  graceDays = COVERAGE_GRACE_DAYS,
): AccountCoverageRow[] {
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const names = new Map(members.map((member) => [member.id, member.name]));
  return accounts
    .filter((account) => accountActiveOn(account, date))
    .map((account) => {
      const throughDate = account.coverage?.throughDate ?? "";
      const ageDays = calendarAgeDays(throughDate, today);
      const nextExpectedDate = nextExpectedCoverage(throughDate, account.cadence);
      const overdue = nextExpectedDate !== null && date > addDays(nextExpectedDate, graceDays);
      return {
        account,
        ownerLabel: account.owner === "joint"
          ? "Household"
          : account.owner === "unassigned"
            ? "Funding owner unassigned"
            : names.get(account.owner) ?? "Former member",
        throughDate,
        ageDays,
        nextExpectedDate,
        status: ageDays === null ? "missing" as const : overdue ? "stale" as const : "current" as const,
      };
    })
    .sort((left, right) => {
      const rank = { missing: 0, stale: 1, current: 2 } as const;
      return rank[left.status] - rank[right.status]
        || (right.ageDays ?? Number.MAX_SAFE_INTEGER) - (left.ageDays ?? Number.MAX_SAFE_INTEGER)
        || left.account.label.localeCompare(right.account.label);
    });
}

/**
 * Whether the household's evidence is behind for the selected month. Registered
 * accounts are the authority when they exist, so freshness follows each account's
 * own statement rhythm; without any registry, fall back to the age of the newest
 * recorded row. One definition, so Home and the efficiency engine cannot disagree
 * about whether the household is up to date.
 */
export function dataIsBehind(
  coverageRows: AccountCoverageRow[],
  month: { isCurrentMonth: boolean; dataAgeDays: number | null; dayNumber: number },
): boolean {
  if (!month.isCurrentMonth) return false;
  if (coverageRows.length) return coverageRows.some((row) => row.status !== "current");
  return month.dataAgeDays === null ? month.dayNumber > 3 : month.dataAgeDays >= 7;
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
