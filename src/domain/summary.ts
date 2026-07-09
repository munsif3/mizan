import { ownerOf } from "./accounts";
import { categoryInfo, spendingCategoryOptions } from "./categories";
import { addMonths, daysInMonth, isoDateOf, monthOf } from "./dates";
import {
  personalCategory,
  personalMemberId,
  type Account,
  type AppData,
  type CategoryKey,
  type FixedCost,
  type Member,
  type MemberId,
  type OwnerFilter,
  type Transaction,
} from "./types";

export interface CategoryRow {
  key: CategoryKey;
  name: string;
  value: number;
  color: string;
}

export interface MovementRow extends CategoryRow {
  previous: number;
  delta: number;
  details: { label: string; value: number }[];
}

export interface HistoryRow {
  month: string;
  spend: number;
  saved: number;
  rate: number;
}

/** One member's month: what they fronted, their own personal spend, and their settlement position. */
export interface MemberRow {
  member: Member;
  /** total spend this member fronted this month (all categories) */
  paid: number;
  /** this member's own personal-category spend */
  personal: number;
  /** settlement position: positive = owed money, negative = owes money */
  net: number;
}

/** A single balancing payment from one member to another. */
export interface Transfer {
  fromId: MemberId;
  toId: MemberId;
  fromName: string;
  toName: string;
  amount: number;
}

export interface MonthSummary {
  month: string;
  isCurrentMonth: boolean;
  dayNumber: number;
  daysInMonth: number;
  daysLeft: number;

  incomeTotal: number;
  cardSpend: number;
  fixedSpend: number;
  totalSpend: number;
  remaining: number;
  saveRate: number;

  targetSaveRate: number;
  targetSpend: number;
  dailyAllowance: number;
  spendPerDay: number;
  remainingDaily: number;
  projectedSpend: number;
  projectedSaved: number;
  projectedSaveRate: number;

  monthTransactions: Transaction[];
  monthFixed: FixedCost[];
  categoryRows: CategoryRow[];
  fullCategoryRows: CategoryRow[];
  maxCategoryValue: number;
  topCategory: CategoryRow;

  previousMonth: string;
  movementRows: MovementRow[];

  memberRows: MemberRow[];
  sharedSpend: number;
  householdShared: number;
  /** each member's equal share of the shared household spend (display figure) */
  fairShare: number;
  transfers: Transfer[];

  uncategorizedCount: number;
  /** fixed costs active now whose `until` falls within the next 2 months */
  endingSoon: FixedCost[];
}

/** Our share of a transaction after an optional split. */
export function netAmount(txn: Transaction): number {
  if (!txn.split) return txn.amount;
  const of = Math.max(1, Number(txn.split.of) || 1);
  const mine = Math.max(0, Number(txn.split.mine) || 0);
  return txn.amount * (mine / of);
}

/**
 * True for a transaction that counts as spend — i.e. not a credit (deposit,
 * salary, transfer in). The one place "what counts as spend" is defined;
 * every spend figure in this file, and any UI component that needs a spend
 * total, should go through this (or `spendTotal`) rather than re-testing
 * `txn.direction` inline.
 */
export function isSpend(txn: Transaction): boolean {
  return txn.direction !== "credit";
}

/** Sum of net amounts for the spend-only subset of a transaction list. */
export function spendTotal(transactions: Transaction[]): number {
  return transactions.filter(isSpend).reduce((sum, txn) => sum + netAmount(txn), 0);
}

export function fixedActive(fixed: FixedCost, month: string): boolean {
  return !fixed.until || month <= fixed.until;
}

/** Sorted months that have data, always including the current calendar month. */
export function monthsWithData(data: AppData, today: Date): string[] {
  const months = new Set(data.transactions.map((txn) => monthOf(txn.date)).filter(Boolean));
  months.add(isoDateOf(today).slice(0, 7));
  return [...months].sort();
}

function ownerMatches(txn: Transaction, owner: OwnerFilter, accounts: Account[]): boolean {
  if (owner === "all") return true;
  return ownerOf(txn.account, accounts) === owner || txn.category === personalCategory(owner);
}

function incomeOf(members: Member[]): number {
  return members.reduce((sum, member) => sum + (Number(member.income) || 0), 0);
}

/**
 * The member who fronted a transaction, or null when it's joint-funded and so
 * creates no inter-member debt. The account owner wins; only on a joint account
 * does a personal category name the payer.
 */
function effectivePayer(txn: Transaction, accounts: Account[], memberIds: Set<MemberId>): MemberId | null {
  const owner = ownerOf(txn.account, accounts);
  if (owner !== "joint" && memberIds.has(owner)) return owner;
  const personal = personalMemberId(txn.category);
  return personal && memberIds.has(personal) ? personal : null;
}

/**
 * Greedy minimal-transfer settlement: repeatedly send from the largest debtor
 * to the largest creditor. Deterministic (ties break by member order), emits at
 * most N-1 transfers, and drops sub-unit residue. `rows` nets should sum to ~0.
 */
export function settleUp(rows: { id: MemberId; name: string; net: number }[]): Transfer[] {
  const balances = rows.map((row, order) => ({ id: row.id, name: row.name, amount: row.net, order }));
  const transfers: Transfer[] = [];
  // Bound the loop defensively; each iteration zeroes at least one member.
  for (let guard = 0; guard < balances.length * balances.length + 1; guard += 1) {
    const debtor = balances
      .filter((b) => b.amount < -1)
      .sort((a, b) => a.amount - b.amount || a.order - b.order)[0];
    const creditor = balances
      .filter((b) => b.amount > 1)
      .sort((a, b) => b.amount - a.amount || a.order - b.order)[0];
    if (!debtor || !creditor) break;
    const amount = Math.min(-debtor.amount, creditor.amount);
    transfers.push({
      fromId: debtor.id,
      toId: creditor.id,
      fromName: debtor.name,
      toName: creditor.name,
      amount: Math.round(amount),
    });
    debtor.amount += amount;
    creditor.amount -= amount;
  }
  return transfers.filter((t) => t.amount >= 1);
}

function categoryTotalForMonth(data: AppData, category: CategoryKey, month: string): number {
  const transactions = spendTotal(
    data.transactions.filter((txn) => monthOf(txn.date) === month && txn.category === category),
  );
  const fixed = data.fixedCosts
    .filter((cost) => fixedActive(cost, month) && cost.category === category)
    .reduce((sum, cost) => sum + Number(cost.amount || 0), 0);
  return transactions + fixed;
}

export function computeMonthSummary(data: AppData, month: string, owner: OwnerFilter, today: Date): MonthSummary {
  const { targetSaveRate, members } = data.settings;
  const memberIds = new Set(members.map((m) => m.id));
  const incomeTotal = incomeOf(members);

  // Credits (deposits, salary, transfers in) are kept in monthTransactions for
  // display (the Transactions table shows the account's full history) but are
  // never spend — income stays the manual settings figure, not
  // statement-derived — so every money sum below uses the debit-only subset.
  const monthTransactionsAll = data.transactions.filter((txn) => monthOf(txn.date) === month);
  const monthTransactions = monthTransactionsAll.filter((txn) => ownerMatches(txn, owner, data.accounts));
  const monthSpendAll = monthTransactionsAll.filter(isSpend);
  const monthSpend = monthTransactions.filter(isSpend);
  const monthFixed = data.fixedCosts.filter((fixed) => fixedActive(fixed, month));

  const cardSpend = spendTotal(monthTransactions);
  const fixedSpend = monthFixed.reduce((sum, fixed) => sum + Number(fixed.amount || 0), 0);
  const totalSpend = cardSpend + fixedSpend;
  const remaining = incomeTotal - totalSpend;
  const saveRate = incomeTotal ? (remaining / incomeTotal) * 100 : 0;

  const totalDays = daysInMonth(month);
  const isCurrentMonth = month === isoDateOf(today).slice(0, 7);
  const dayNumber = isCurrentMonth ? today.getDate() : totalDays;
  const daysLeft = Math.max(0, totalDays - dayNumber);

  const targetSpend = incomeTotal * (1 - targetSaveRate / 100);
  const dailyAllowance = totalDays ? targetSpend / totalDays : 0;
  const spendPerDay = dayNumber ? totalSpend / dayNumber : 0;
  const remainingDaily = daysLeft ? Math.max(0, targetSpend - totalSpend) / daysLeft : Math.max(0, targetSpend - totalSpend);
  // Project by extrapolating only variable (card) spend; fixed costs hit once
  // per month and must not be multiplied by the days remaining.
  const projectedSpend = isCurrentMonth && dayNumber ? fixedSpend + (cardSpend / dayNumber) * totalDays : totalSpend;
  const projectedSaved = incomeTotal - projectedSpend;
  const projectedSaveRate = incomeTotal ? (projectedSaved / incomeTotal) * 100 : 0;

  const categoryTotals = new Map<CategoryKey, number>();
  for (const txn of monthSpend) {
    categoryTotals.set(txn.category, (categoryTotals.get(txn.category) ?? 0) + netAmount(txn));
  }
  for (const fixed of monthFixed) {
    categoryTotals.set(fixed.category, (categoryTotals.get(fixed.category) ?? 0) + Number(fixed.amount || 0));
  }
  const categoryRows: CategoryRow[] = [...categoryTotals.entries()]
    .map(([key, value]) => {
      const info = categoryInfo(key, members);
      return { key, name: info.label, value, color: info.color };
    })
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  const maxCategoryValue = Math.max(...categoryRows.map((row) => row.value), 1);
  const fullCategoryRows: CategoryRow[] = spendingCategoryOptions(members).map(
    (option) =>
      categoryRows.find((row) => row.key === option.key) ?? {
        key: option.key,
        name: option.label,
        value: 0,
        color: option.color,
      },
  );
  const topCategory = categoryRows[0] ?? {
    key: "uncategorized" as CategoryKey,
    name: "No spending yet",
    value: 0,
    color: "#7b8194",
  };

  const previousMonth = addMonths(month, -1);
  const hasPreviousData = data.transactions.some((txn) => monthOf(txn.date) === previousMonth);
  const movementRows: MovementRow[] = categoryRows.slice(0, 3).map((row) => {
    const previous = hasPreviousData ? categoryTotalForMonth(data, row.key, previousMonth) : 0;
    const details = [
      ...monthFixed
        .filter((fixed) => fixed.category === row.key)
        .map((fixed) => ({ label: fixed.label, value: Number(fixed.amount || 0) })),
      ...monthSpend
        .filter((txn) => txn.category === row.key)
        .sort((a, b) => netAmount(b) - netAmount(a))
        .slice(0, 3)
        .map((txn) => ({ label: txn.description, value: netAmount(txn) })),
    ].slice(0, 3);
    return { ...row, previous, delta: row.value - previous, details };
  });

  // Settlement is a whole-household figure: it always derives from the full
  // month's transactions, independent of the owner-tab filter above. Each
  // member's own personal spend on their own account is their own cost; only
  // shared spend that a member fronts is split equally, and one member fronting
  // another's personal spend ("cross") is owed back directly. Nets sum to zero.
  const personalByMember = new Map<MemberId, number>();
  const paidByMember = new Map<MemberId, number>();
  const sharedPaidByMember = new Map<MemberId, number>();
  const crossPaidByMember = new Map<MemberId, number>();
  const owedForPersonal = new Map<MemberId, number>();
  for (const id of memberIds) {
    personalByMember.set(id, categoryTotalForMonth(data, personalCategory(id), month));
  }
  for (const txn of monthSpendAll) {
    const payer = effectivePayer(txn, data.accounts, memberIds);
    if (!payer) continue;
    const value = netAmount(txn);
    paidByMember.set(payer, (paidByMember.get(payer) ?? 0) + value);
    const beneficiary = personalMemberId(txn.category);
    if (beneficiary && memberIds.has(beneficiary)) {
      if (beneficiary !== payer) {
        crossPaidByMember.set(payer, (crossPaidByMember.get(payer) ?? 0) + value);
        owedForPersonal.set(beneficiary, (owedForPersonal.get(beneficiary) ?? 0) + value);
      }
    } else {
      sharedPaidByMember.set(payer, (sharedPaidByMember.get(payer) ?? 0) + value);
    }
  }
  const totalSharedPaid = [...sharedPaidByMember.values()].reduce((sum, v) => sum + v, 0);
  const perMemberShare = members.length ? totalSharedPaid / members.length : 0;
  const memberRows: MemberRow[] = members.map((member) => {
    const shared = sharedPaidByMember.get(member.id) ?? 0;
    const cross = crossPaidByMember.get(member.id) ?? 0;
    const owed = owedForPersonal.get(member.id) ?? 0;
    return {
      member,
      paid: paidByMember.get(member.id) ?? 0,
      personal: personalByMember.get(member.id) ?? 0,
      net: shared - perMemberShare + cross - owed,
    };
  });
  const transfers = settleUp(memberRows.map((row) => ({ id: row.member.id, name: row.member.name, net: row.net })));

  const householdSharedTxns = monthSpendAll
    .filter((txn) => personalMemberId(txn.category) === null)
    .reduce((sum, txn) => sum + netAmount(txn), 0);
  const householdShared = householdSharedTxns + fixedSpend;
  const totalPersonal = [...personalByMember.values()].reduce((sum, v) => sum + v, 0);
  const sharedSpend = Math.max(0, totalSpend - totalPersonal);
  const fairShare = members.length ? householdShared / members.length : 0;

  const uncategorizedCount = data.transactions.filter((txn) => txn.category === "uncategorized" && isSpend(txn)).length;
  const horizon = addMonths(month, 2);
  const endingSoon = monthFixed.filter((fixed) => fixed.until && fixed.until <= horizon);

  return {
    month,
    isCurrentMonth,
    dayNumber,
    daysInMonth: totalDays,
    daysLeft,
    incomeTotal,
    cardSpend,
    fixedSpend,
    totalSpend,
    remaining,
    saveRate,
    targetSaveRate,
    targetSpend,
    dailyAllowance,
    spendPerDay,
    remainingDaily,
    projectedSpend,
    projectedSaved,
    projectedSaveRate,
    monthTransactions,
    monthFixed,
    categoryRows,
    fullCategoryRows,
    maxCategoryValue,
    topCategory,
    previousMonth: hasPreviousData ? previousMonth : "",
    movementRows,
    memberRows,
    sharedSpend,
    householdShared,
    fairShare,
    transfers,
    uncategorizedCount,
    endingSoon,
  };
}

export interface ReviewItem {
  merchant: string;
  count: number;
  total: number;
}

/** Uncategorized merchants grouped for the review queue, largest spend first. */
export function reviewQueue(transactions: Transaction[]): ReviewItem[] {
  const groups = new Map<string, ReviewItem>();
  for (const txn of transactions) {
    if (txn.category !== "uncategorized" || !isSpend(txn)) continue;
    const merchant = txn.description.replace(/\s+/g, " ").trim().toUpperCase();
    const item = groups.get(merchant) ?? { merchant, count: 0, total: 0 };
    item.count += 1;
    item.total += netAmount(txn);
    groups.set(merchant, item);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || a.merchant.localeCompare(b.merchant));
}

/**
 * Month-by-month spend/saved/rate. Uses current income for all months —
 * a documented simplification (see ARCHITECTURE.md).
 */
export function computeHistory(data: AppData, months: string[]): HistoryRow[] {
  const incomeTotal = incomeOf(data.settings.members);
  return months.map((month) => {
    const spend =
      spendTotal(data.transactions.filter((txn) => monthOf(txn.date) === month)) +
      data.fixedCosts
        .filter((fixed) => fixedActive(fixed, month))
        .reduce((sum, fixed) => sum + Number(fixed.amount || 0), 0);
    const saved = incomeTotal - spend;
    return { month, spend, saved, rate: incomeTotal ? (saved / incomeTotal) * 100 : 0 };
  });
}
