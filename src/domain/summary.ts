import { ownerOfTransaction } from "./accounts";
import { beneficiaryEquals } from "./beneficiaries";
import { categoryInfo, spendingCategoryOptions } from "./categories";
import { pruneSharedContributions } from "./contributions";
import { addMonths, daysInMonth, isoDateOf, monthOf } from "./dates";
import { resolveMonthIncome, type PortionResolution } from "./income";
import { SPEND_KINDS } from "./movements";
import { netAmount } from "./transactionMath";
import {
  type AppData,
  type CategoryKey,
  type FixedCost,
  type Member,
  type MemberId,
  type MerchantRule,
  type SpendBeneficiary,
  type Transaction,
} from "./types";

interface CategoryRow {
  key: CategoryKey;
  name: string;
  value: number;
  color: string;
}

interface MovementRow extends CategoryRow {
  previous: number;
  delta: number;
  details: { label: string; value: number }[];
}

export interface HistoryRow {
  month: string;
  income: number;
  spend: number;
  saved: number;
  rate: number;
}

/** Totals partitioned by the people or household that consumed the spend. */
interface BeneficiaryAmounts {
  household: number;
  byMember: Record<MemberId, number>;
  unassigned: number;
  total: number;
}

/** One merchant inside a purpose row, using the same beneficiary columns. */
interface SpendingAttributionMerchantRow extends BeneficiaryAmounts {
  merchant: string;
}

/** One purpose/category in the Who spent what matrix. */
interface SpendingAttributionPurposeRow extends BeneficiaryAmounts {
  key: CategoryKey;
  name: string;
  color: string;
  merchants: SpendingAttributionMerchantRow[];
}

/** A member's consumption, funding, and member-to-member settlement position. */
interface SpendingAttributionMemberRow {
  member: Member;
  /** Recorded spend whose beneficiary is this member. */
  personalSpend: number;
  /** This member's equal share of recorded household-beneficiary spend. */
  sharedResponsibility: number;
  /** personalSpend + sharedResponsibility; excludes unresolved spend and commitments. */
  recordedResponsibility: number;
  /** Recorded spend funded by this member after confirmed contribution reallocation. */
  amountFronted: number;
  /** Household-beneficiary spend funded by this member. */
  sharedFronted: number;
  /** Other members' personal spend funded by this member. */
  personalFrontedForOthers: number;
  /** Positive means the member is owed; negative means the member owes. */
  settlementNet: number;
}

/** Planning-only commitments, deliberately kept outside recorded funding and settlement. */
interface FixedCommitmentAttribution extends BeneficiaryAmounts {
  purposeRows: SpendingAttributionPurposeRow[];
}

/** Pure month read model behind the Who spent what experience. */
export interface SpendingAttribution {
  /** Recorded transaction spend only; excludes fixed commitments. */
  recordedSpend: number;
  householdSpend: number;
  unassignedBeneficiarySpend: number;
  /** Recorded spend traceable to a current member's registered account/contribution. */
  memberFundedSpend: number;
  /** Recorded spend from joint or unregistered accounts. */
  jointOrUnregisteredFunding: number;
  purposeRows: SpendingAttributionPurposeRow[];
  memberRows: SpendingAttributionMemberRow[];
  fixedCommitments: FixedCommitmentAttribution;
  transfers: Transfer[];
}

/** Compatibility projection of the richer attribution member statement. */
interface MemberRow {
  member: Member;
  /** total spend this member fronted this month (all categories) */
  paid: number;
  /** recorded spend whose beneficiary is this member */
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
  /** Most recent transaction date in the selected household month. */
  latestTransactionDate: string;
  /** Calendar days since that transaction for the current month; null for past months or no data. */
  dataAgeDays: number | null;

  incomeTotal: number;
  incomeItems: PortionResolution[];
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

  /** Spend missing either a purpose or a beneficiary in the selected month. */
  unresolvedCount: number;
  /** Spend missing purpose or beneficiary across every month. */
  reviewQueueCount: number;
  /** fixed costs active now whose `until` falls within the next 2 months */
  endingSoon: FixedCost[];
  /** Exact category/amount matches that may represent the same payment twice. */
  possibleFixedCostDuplicates: FixedCost[];
  attribution: SpendingAttribution;
}

export { netAmount } from "./transactionMath";

/**
 * The movement kinds that count as spend. Everything else — account hops,
 * lending, repayments, investments, plain credits — is money that moved but was
 * not spent, so it stays out of every spend/save-rate figure.
 */
/**
 * True for a transaction that counts as spend. The one place "what counts as
 * spend" is defined; every spend figure in this file, and any UI component that
 * needs a spend total, should go through this (or `spendTotal`) rather than
 * re-testing `txn.kind` inline. Falls back to `direction` for any row without a
 * kind (shouldn't happen post-migration, but stays defensive).
 */
export function isSpend(txn: Transaction): boolean {
  return txn.direction !== "credit" && (txn.kind ? SPEND_KINDS.has(txn.kind) : true);
}

/** Sum of net amounts for the spend-only subset of a transaction list. */
export function spendTotal(transactions: Transaction[]): number {
  return transactions.filter(isSpend).reduce((sum, txn) => sum + netAmount(txn), 0);
}

function fixedActive(fixed: FixedCost, month: string): boolean {
  return !fixed.until || month <= fixed.until;
}

/** Sorted months that have data, always including the current calendar month. */
export function monthsWithData(data: AppData, today: Date): string[] {
  const months = new Set(data.transactions.map((txn) => monthOf(txn.date)).filter(Boolean));
  for (const receipt of data.incomeReceipts) months.add(receipt.month);
  months.add(isoDateOf(today).slice(0, 7));
  return [...months].sort();
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

function emptyBeneficiaryAmounts(members: Member[]): BeneficiaryAmounts {
  return {
    household: 0,
    byMember: Object.fromEntries(members.map((member) => [member.id, 0])),
    unassigned: 0,
    total: 0,
  };
}

/** Treat stale member references as unresolved so no spend disappears. */
function normalizedBeneficiary(
  beneficiary: SpendBeneficiary,
  memberIds: Set<MemberId>,
): SpendBeneficiary {
  return beneficiary.type === "member" && !memberIds.has(beneficiary.memberId)
    ? { type: "unassigned" }
    : beneficiary;
}

function addBeneficiaryAmount(
  totals: BeneficiaryAmounts,
  beneficiary: SpendBeneficiary,
  amount: number,
  memberIds: Set<MemberId>,
): void {
  const normalized = normalizedBeneficiary(beneficiary, memberIds);
  totals.total += amount;
  if (normalized.type === "household") totals.household += amount;
  else if (normalized.type === "member") {
    totals.byMember[normalized.memberId] = (totals.byMember[normalized.memberId] ?? 0) + amount;
  } else totals.unassigned += amount;
}

interface AttributionEntry {
  category: CategoryKey;
  beneficiary: SpendBeneficiary;
  amount: number;
  merchant: string;
}

function purposeRows(
  entries: AttributionEntry[],
  members: Member[],
  customCategories: AppData["settings"]["customCategories"],
): SpendingAttributionPurposeRow[] {
  const memberIds = new Set(members.map((member) => member.id));
  const rows = new Map<
    CategoryKey,
    SpendingAttributionPurposeRow & { merchantMap: Map<string, SpendingAttributionMerchantRow> }
  >();
  for (const entry of entries) {
    const info = categoryInfo(entry.category, members, customCategories);
    const row = rows.get(entry.category) ?? {
      key: entry.category,
      name: info.label,
      color: info.color,
      ...emptyBeneficiaryAmounts(members),
      merchants: [],
      merchantMap: new Map<string, SpendingAttributionMerchantRow>(),
    };
    addBeneficiaryAmount(row, entry.beneficiary, entry.amount, memberIds);
    const merchant = entry.merchant.replace(/\s+/g, " ").trim().toUpperCase() || "UNNAMED";
    const merchantRow = row.merchantMap.get(merchant) ?? {
      merchant,
      ...emptyBeneficiaryAmounts(members),
    };
    addBeneficiaryAmount(merchantRow, entry.beneficiary, entry.amount, memberIds);
    row.merchantMap.set(merchant, merchantRow);
    rows.set(entry.category, row);
  }
  return [...rows.values()]
    .map(({ merchantMap, ...row }) => ({
      ...row,
      merchants: [...merchantMap.values()].sort(
        (a, b) => b.total - a.total || a.merchant.localeCompare(b.merchant),
      ),
    }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

export function needsClassificationReview(txn: Transaction): boolean {
  return isSpend(txn) && (txn.category === "uncategorized" || txn.beneficiary.type === "unassigned");
}

/**
 * Build the purpose x beneficiary matrix and reconcile responsibility against
 * proven funding. Fixed commitments remain planning-only: they are reported in
 * their own breakdown and never enter recorded fronting or settlement.
 */
export function computeSpendingAttribution(data: AppData, month: string): SpendingAttribution {
  const { members, customCategories } = data.settings;
  const memberIds = new Set(members.map((member) => member.id));
  const recordedTransactions = data.transactions.filter(
    (txn) => monthOf(txn.date) === month && isSpend(txn),
  );
  const recordedEntries: AttributionEntry[] = recordedTransactions.map((txn) => ({
    category: txn.category,
    beneficiary: txn.beneficiary,
    amount: netAmount(txn),
    merchant: txn.description,
  }));
  const recordedTotals = emptyBeneficiaryAmounts(members);
  for (const entry of recordedEntries) {
    addBeneficiaryAmount(recordedTotals, entry.beneficiary, entry.amount, memberIds);
  }

  const activeFixed = data.fixedCosts.filter((fixed) => fixedActive(fixed, month));
  const fixedEntries: AttributionEntry[] = activeFixed.map((fixed) => ({
    category: fixed.category,
    beneficiary: fixed.beneficiary,
    amount: Number(fixed.amount || 0),
    merchant: fixed.label,
  }));
  const fixedTotals = emptyBeneficiaryAmounts(members);
  for (const entry of fixedEntries) {
    addBeneficiaryAmount(fixedTotals, entry.beneficiary, entry.amount, memberIds);
  }

  const amountFronted = new Map<MemberId, number>();
  const sharedFronted = new Map<MemberId, number>();
  const personalFrontedForOthers = new Map<MemberId, number>();
  const settlementNet = new Map<MemberId, number>();
  for (const member of members) {
    amountFronted.set(member.id, 0);
    sharedFronted.set(member.id, 0);
    personalFrontedForOthers.set(member.id, 0);
    settlementNet.set(member.id, 0);
  }

  const validContributions = pruneSharedContributions(
    data.sharedContributions ?? [],
    data.transactions,
    data.accounts,
    members,
  );
  const contributionsByExpense = new Map<string, { contributorMemberId: MemberId; amount: number }[]>();
  for (const contribution of validContributions) {
    for (const allocation of contribution.allocations) {
      const rows = contributionsByExpense.get(allocation.expenseTransactionId) ?? [];
      rows.push({ contributorMemberId: contribution.contributorMemberId, amount: allocation.amount });
      contributionsByExpense.set(allocation.expenseTransactionId, rows);
    }
  }

  let memberFundedShared = 0;
  for (const txn of recordedTransactions) {
    const value = netAmount(txn);
    const beneficiary = normalizedBeneficiary(txn.beneficiary, memberIds);
    const funding = new Map<MemberId, number>();
    let remaining = value;
    // Contribution evidence only reallocates household spend. A stale link must
    // never turn one member's personal consumption into shared funding.
    const contributions = beneficiary.type === "household"
      ? (contributionsByExpense.get(txn.id) ?? [])
      : [];
    for (const contribution of contributions) {
      if (!memberIds.has(contribution.contributorMemberId)) continue;
      const contributionAmount = Math.min(remaining, Math.max(0, Number(contribution.amount || 0)));
      if (!contributionAmount) continue;
      funding.set(
        contribution.contributorMemberId,
        (funding.get(contribution.contributorMemberId) ?? 0) + contributionAmount,
      );
      remaining -= contributionAmount;
    }
    const accountOwner = ownerOfTransaction(txn, data.accounts);
    if (accountOwner !== "joint" && memberIds.has(accountOwner)) {
      funding.set(accountOwner, (funding.get(accountOwner) ?? 0) + remaining);
    }

    const fundedByMembers = [...funding.values()].reduce((sum, amount) => sum + amount, 0);
    for (const [funderId, amount] of funding) {
      amountFronted.set(funderId, (amountFronted.get(funderId) ?? 0) + amount);
      if (beneficiary.type === "household") {
        sharedFronted.set(funderId, (sharedFronted.get(funderId) ?? 0) + amount);
      } else if (beneficiary.type === "member" && beneficiary.memberId !== funderId) {
        personalFrontedForOthers.set(
          funderId,
          (personalFrontedForOthers.get(funderId) ?? 0) + amount,
        );
        settlementNet.set(funderId, (settlementNet.get(funderId) ?? 0) + amount);
        settlementNet.set(
          beneficiary.memberId,
          (settlementNet.get(beneficiary.memberId) ?? 0) - amount,
        );
      }
    }
    if (beneficiary.type === "household") memberFundedShared += fundedByMembers;
  }

  const perMemberFundedShared = members.length ? memberFundedShared / members.length : 0;
  for (const member of members) {
    settlementNet.set(
      member.id,
      (settlementNet.get(member.id) ?? 0)
        + (sharedFronted.get(member.id) ?? 0)
        - perMemberFundedShared,
    );
  }

  const sharedResponsibility = members.length ? recordedTotals.household / members.length : 0;
  const memberRows: SpendingAttributionMemberRow[] = members.map((member) => {
    const personalSpend = recordedTotals.byMember[member.id] ?? 0;
    return {
      member,
      personalSpend,
      sharedResponsibility,
      recordedResponsibility: personalSpend + sharedResponsibility,
      amountFronted: amountFronted.get(member.id) ?? 0,
      sharedFronted: sharedFronted.get(member.id) ?? 0,
      personalFrontedForOthers: personalFrontedForOthers.get(member.id) ?? 0,
      settlementNet: settlementNet.get(member.id) ?? 0,
    };
  });
  const memberFundedSpend = memberRows.reduce((sum, row) => sum + row.amountFronted, 0);
  // Derive the remainder so the funding reconciliation is an exact invariant,
  // even when split arithmetic produces repeating floating-point values.
  const jointOrUnregisteredFunding = recordedTotals.total - memberFundedSpend;
  const transfers = settleUp(
    memberRows.map((row) => ({
      id: row.member.id,
      name: row.member.name,
      net: row.settlementNet,
    })),
  );

  return {
    recordedSpend: recordedTotals.total,
    householdSpend: recordedTotals.household,
    unassignedBeneficiarySpend: recordedTotals.unassigned,
    memberFundedSpend,
    jointOrUnregisteredFunding,
    purposeRows: purposeRows(recordedEntries, members, customCategories),
    memberRows,
    fixedCommitments: {
      ...fixedTotals,
      purposeRows: purposeRows(fixedEntries, members, customCategories),
    },
    transfers,
  };
}

export function computeMonthSummary(data: AppData, month: string, today: Date): MonthSummary {
  const { targetSaveRate, members, customCategories } = data.settings;
  const income = resolveMonthIncome(members, data.incomeReceipts, data.settings.currency, data.settings.fxRates, month, today);
  const incomeTotal = income.total;

  // Credits (deposits, salary, transfers in) are kept in monthTransactions for
  // display (the Transactions table shows the account's full history) but are
  // never spend — income stays the manual settings figure, not
  // statement-derived — so every money sum below uses the debit-only subset.
  const monthTransactionsAll = data.transactions.filter((txn) => monthOf(txn.date) === month);
  const monthTransactions = monthTransactionsAll;
  const monthSpendAll = monthTransactionsAll.filter(isSpend);
  const monthSpend = monthSpendAll;
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
  const latestTransactionDate = monthTransactionsAll.reduce(
    (latest, txn) => (txn.date > latest ? txn.date : latest),
    "",
  );
  const dataAgeDays =
    isCurrentMonth && latestTransactionDate
      ? Math.max(
          0,
          Math.floor(
            (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
              Date.UTC(
                Number(latestTransactionDate.slice(0, 4)),
                Number(latestTransactionDate.slice(5, 7)) - 1,
                Number(latestTransactionDate.slice(8, 10)),
              )) /
              86_400_000,
          ),
        )
      : null;

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
      const info = categoryInfo(key, members, customCategories);
      return { key, name: info.label, value, color: info.color };
    })
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  const maxCategoryValue = Math.max(...categoryRows.map((row) => row.value), 1);
  const fullCategoryRows: CategoryRow[] = spendingCategoryOptions(members, customCategories).map(
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

  const attribution = computeSpendingAttribution(data, month);
  const memberRows: MemberRow[] = attribution.memberRows.map((row) => ({
    member: row.member,
    paid: row.amountFronted,
    personal: row.personalSpend,
    net: row.settlementNet,
  }));
  const transfers = attribution.transfers;
  const householdShared = attribution.householdSpend + attribution.fixedCommitments.household;
  const totalPersonal = attribution.memberRows.reduce((sum, row) => sum + row.personalSpend, 0)
    + Object.values(attribution.fixedCommitments.byMember).reduce((sum, value) => sum + value, 0);
  const sharedSpend = Math.max(0, totalSpend - totalPersonal);
  const fairShare = members.length ? householdShared / members.length : 0;

  // The check-in is month-specific. Old review debt should remain in the full
  // review queue, but must not make the selected month's forecast look untrusted.
  const unresolvedCount = monthSpendAll.filter(needsClassificationReview).length;
  // The queue itself spans every month, so its count must too — a statement
  // period straddles two months, and the badge sits directly above the queue.
  // Same membership test as `reviewQueue`, so the two cannot drift.
  const reviewQueueCount = data.transactions.filter(needsClassificationReview).length;
  const horizon = addMonths(month, 2);
  const endingSoon = monthFixed.filter((fixed) => fixed.until && fixed.until <= horizon);
  const possibleFixedCostDuplicates = monthFixed.filter((fixed) =>
    monthSpendAll.some(
      (txn) => txn.category === fixed.category
        && beneficiaryEquals(txn.beneficiary, fixed.beneficiary)
        && Math.abs(netAmount(txn) - Number(fixed.amount || 0)) < 0.01,
    ),
  );

  return {
    month,
    isCurrentMonth,
    dayNumber,
    daysInMonth: totalDays,
    daysLeft,
    latestTransactionDate,
    dataAgeDays,
    incomeTotal,
    incomeItems: income.items,
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
    reviewQueueCount,
    endingSoon,
    possibleFixedCostDuplicates,
    attribution,
    unresolvedCount,
  };
}

export interface ReviewItem {
  merchant: string;
  count: number;
  total: number;
  /** Uniform known values are retained so review asks only for the missing axis. */
  suggestedCategory?: CategoryKey;
  suggestedBeneficiary?: MerchantRule["beneficiary"];
  suggestedKind?: Transaction["kind"];
  suggestedCounterpartyId?: string;
}

/** Merchants missing a purpose or beneficiary, grouped largest spend first. */
export function reviewQueue(transactions: Transaction[]): ReviewItem[] {
  const groups = new Map<string, { merchant: string; count: number; total: number; rows: Transaction[] }>();
  for (const txn of transactions) {
    if (!needsClassificationReview(txn)) continue;
    const merchant = txn.description.replace(/\s+/g, " ").trim().toUpperCase();
    const item = groups.get(merchant) ?? { merchant, count: 0, total: 0, rows: [] };
    item.count += 1;
    item.total += netAmount(txn);
    item.rows.push(txn);
    groups.set(merchant, item);
  }
  return [...groups.values()]
    .map(({ rows, ...item }): ReviewItem => {
      const knownCategories = [...new Set(rows.map((row) => row.category).filter((category) => category !== "uncategorized"))];
      const knownBeneficiaries = rows
        .map((row): MerchantRule["beneficiary"] => row.beneficiarySource === "account_default"
          ? { type: "account_default" }
          : row.beneficiary)
        .filter((beneficiary) => beneficiary.type !== "unassigned");
      const firstBeneficiary = knownBeneficiaries[0];
      const kinds = [...new Set(rows.map((row) => row.kind))];
      const counterparties = [...new Set(rows.map((row) => row.counterpartyId).filter((id): id is string => Boolean(id)))];
      return {
        ...item,
        ...(knownCategories.length === 1 ? { suggestedCategory: knownCategories[0] } : {}),
        ...(firstBeneficiary && knownBeneficiaries.every((beneficiary) => beneficiaryEquals(beneficiary, firstBeneficiary))
          ? { suggestedBeneficiary: firstBeneficiary }
          : {}),
        ...(kinds.length === 1 ? { suggestedKind: kinds[0] } : {}),
        ...(counterparties.length === 1 ? { suggestedCounterpartyId: counterparties[0] } : {}),
      };
    })
    .sort((a, b) => b.total - a.total || a.merchant.localeCompare(b.merchant));
}

/**
 * Month-by-month spend/saved/rate. Confirmed receipts apply to their recorded
 * month; months without receipts use the current expected portions.
 */
export function computeHistory(data: AppData, months: string[], today: Date): HistoryRow[] {
  return months.map((month) => {
    const incomeTotal = resolveMonthIncome(
      data.settings.members,
      data.incomeReceipts,
      data.settings.currency,
      data.settings.fxRates,
      month,
      today,
    ).total;
    const spend =
      spendTotal(data.transactions.filter((txn) => monthOf(txn.date) === month)) +
      data.fixedCosts
        .filter((fixed) => fixedActive(fixed, month))
        .reduce((sum, fixed) => sum + Number(fixed.amount || 0), 0);
    const saved = incomeTotal - spend;
    return { month, income: incomeTotal, spend, saved, rate: incomeTotal ? (saved / incomeTotal) * 100 : 0 };
  });
}
