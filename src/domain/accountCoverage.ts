import { addDays, addMonths, dayInMonth, monthOf } from "./dates";
import { accountActiveOn } from "./memberLifecycle";
import { spendTotal, type MonthSummary } from "./summary";
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

export interface UnmeasuredExposure {
  amount: number;
  throughDate: string;
  /**
   * The non-current accounts included in the bound. A missing row is also the
   * flag that the bound has no confirmed starting date, so callers must say
   * "at least" rather than presenting the amount as an upper limit.
   */
  accounts: AccountCoverageRow[];
}

/**
 * The date the next statement is expected to close, given confirmed coverage and
 * the account's rhythm. Absent cadence means monthly — the common case for a bank
 * statement, and the assumption that keeps existing households out of a permanent
 * false alarm. Returns null when the account is never automatically stale.
 */
function nextExpectedCoverage(
  throughDate: string,
  cadence: AccountCadence | undefined,
  statementDay: number | undefined,
): string | null {
  if (!throughDate) return null;
  const period = cadence?.period ?? "monthly";
  if (period === "manual") return null;
  if (period === "weekly") return addDays(throughDate, 7);
  // No explicit closing day: assume the same day next month.
  if (!cadence?.dueDay) {
    return dayInMonth(addMonths(monthOf(throughDate), 1), statementDay ?? Number(throughDate.slice(8, 10)));
  }
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

function median(values: number[]): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle] ?? 0
    : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

function validStatementDay(value: number): number | undefined {
  return Number.isInteger(value) && value >= 1 && value <= 28 ? value : undefined;
}

/** Infer the usual arrival day from confirmed coverage edges. */
export function inferStatementDay(confirmedDates: string[]): number | undefined {
  const days = confirmedDates
    .map((date) => Number(date.slice(8, 10)))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31);
  const inferred = median(days);
  return inferred ? Math.min(28, Math.max(1, Math.round(inferred))) : undefined;
}

/** The effective statement day, honoring an explicit Settings override. */
export function statementDayForAccount(account: Account): number | undefined {
  const explicit = validStatementDay(account.statementDay ?? 0);
  if (explicit) return explicit;
  const dates = account.coverage?.confirmedDates
    ?? (account.coverage?.source === "manual"
      ? []
      : account.coverage?.throughDate
        ? [account.coverage.throughDate]
        : []);
  return inferStatementDay(dates);
}

/**
 * Conservative, presentational-only bound for spending that may sit beyond the
 * confirmed edge of active account coverage.
 *
 * This deliberately returns a separate value instead of changing a
 * MonthSummary. It must never be added to recorded spend, projections, save
 * rates, or settlement.
 */
export function unmeasuredExposure(
  rows: AccountCoverageRow[],
  history: MonthSummary[],
  today: Date,
): UnmeasuredExposure {
  const accounts = rows.filter((row) => row.status !== "current");
  if (!accounts.length) return { amount: 0, throughDate: "", accounts: [] };

  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const completedMonths = history
    .filter((summary) => summary.month < currentMonth)
    .sort((left, right) => right.month.localeCompare(left.month))
    .slice(0, 3);

  const amount = accounts.reduce((total, row) => {
    const accountLabel = row.account.label.trim().toLocaleLowerCase();
    const dailySpend = median(completedMonths.map((summary) => {
      const accountTransactions = summary.monthTransactions.filter((transaction) =>
        transaction.accountId
          ? transaction.accountId === row.account.id
          : transaction.account.trim().toLocaleLowerCase() === accountLabel);
      return spendTotal(accountTransactions) / Math.max(1, summary.daysInMonth);
    }));

    const exposedDays = row.status === "missing"
      // With no confirmed edge there is no honest upper bound. Use only the
      // elapsed current month as a conservative floor; the returned missing row
      // tells the UI to label the result "at least".
      ? Math.max(1, today.getDate())
      : calendarAgeDays(row.throughDate, today) ?? 0;
    return total + dailySpend * exposedDays;
  }, 0);

  const throughDate = accounts
    .map((row) => row.throughDate)
    .filter(Boolean)
    .sort()[0] ?? "";

  return {
    amount: amount > 0 ? Math.ceil(amount / 1_000) * 1_000 : 0,
    throughDate,
    accounts,
  };
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
       const nextExpectedDate = nextExpectedCoverage(throughDate, account.cadence, statementDayForAccount(account));
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
