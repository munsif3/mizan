import { ownerOfTransaction } from "./accounts";
import { computeAssetSnapshot, holdingContributionAmount, type AssetSnapshot } from "./assets";
import { beneficiaryEquals } from "./beneficiaries";
import { categoryInfo, spendingCategoryOptions } from "./categories";
import {
  commitmentActive,
  commitmentExpectedAmount,
  commitmentInvestmentAmount,
  commitmentMatchedTransactions,
  commitmentSpendAmount,
} from "./commitments";
import { pruneSharedContributions } from "./contributions";
import { addMonths, daysInMonth, isoDateOf, monthOf } from "./dates";
import { resolveMonthIncome, type PortionResolution } from "./income";
import { ledgerIndexFor } from "./ledgerIndex";
import { seededCategory } from "./merchantSeeds";
import { memberParticipatesInMonth, memberParticipatesOn, participatingMembersOn } from "./memberLifecycle";
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
  protectedIncome: number;
  oneOffIncome: number;
  spend: number;
  saved: number;
  rate: number;
  assetValue: number;
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
  ordinaryIncome: number;
  protectedIncome: number;
  incomeItems: PortionResolution[];
  cardSpend: number;
  fixedSpend: number;
  /** Posted investment allocations in this month. */
  investmentContributions: number;
  /** Unmatched scheduled investment allocations still expected this month. */
  plannedInvestmentContributions: number;
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

  /**
   * Selected-month spend rows belonging to a merchant Mizan is still asking about.
   * Tail merchants are excluded: they are already counted in every total, so leaving
   * them unclassified must not hold the month open (see `reviewTiers`).
   */
  unresolvedCount: number;
  /** Merchants still worth asking about across every month — the review badge. */
  reviewQueueCount: number;
  /** fixed costs active now whose `until` falls within the next 2 months */
  endingSoon: FixedCost[];
  /** Exact category/amount matches that may represent the same payment twice. */
  possibleFixedCostDuplicates: FixedCost[];
  assetSnapshot: AssetSnapshot;
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

/** Spend portion of one row after an explicit insurance/investment allocation. */
export function transactionSpendAmount(txn: Transaction): number {
  if (!isSpend(txn)) return 0;
  const value = netAmount(txn);
  const ratio = txn.amount > 0 ? value / txn.amount : 0;
  const invested = Math.max(0, Number(txn.investmentAmount) || 0) * ratio;
  return Math.max(0, value - invested);
}

/** Sum of net amounts for the spend-only subset of a transaction list. */
export function spendTotal(transactions: readonly Transaction[]): number {
  return transactions.reduce((sum, txn) => sum + transactionSpendAmount(txn), 0);
}

function commitmentUnmatched(data: AppData, fixed: FixedCost, month: string): boolean {
  return commitmentMatchedTransactions(data.transactions, fixed, month).length === 0;
}

/** Sorted months that have data, always including the current calendar month. */
export function monthsWithData(data: AppData, today: Date): string[] {
  const months = new Set(data.transactions.map((txn) => monthOf(txn.date)).filter(Boolean));
  for (const receipt of data.incomeReceipts) months.add(receipt.month);
  const todayMonth = isoDateOf(today).slice(0, 7);
  for (const portion of data.settings.members.flatMap((member) => member.portions)) {
    if (portion.schedule.frequency === "one_off" && portion.schedule.month <= todayMonth) months.add(portion.schedule.month);
  }
  months.add(todayMonth);
  return [...months].sort();
}

/**
 * Continuous months available to the global month navigator. The rolling
 * 24-month window is a minimum: older recorded activity extends the range,
 * while future-dated activity never makes future months selectable.
 */
export function selectableMonths(data: AppData, today: Date): string[] {
  const todayMonth = isoDateOf(today).slice(0, 7);
  let firstMonth = addMonths(todayMonth, -23);
  const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/;
  const recordedMonths = [
    ...data.transactions.map((txn) => monthOf(txn.date)),
    ...data.incomeReceipts.map((receipt) => receipt.month),
    ...data.settings.members.flatMap((member) => member.portions.flatMap((portion) =>
      portion.schedule.frequency === "one_off" ? [portion.schedule.month] : [])),
  ];

  for (const month of recordedMonths) {
    const validRecordedMonth = validMonth.test(month) && Number(month.slice(0, 4)) >= 1;
    if (validRecordedMonth && month <= todayMonth && month < firstMonth) firstMonth = month;
  }

  const months: string[] = [];
  for (let month = firstMonth; ; month = addMonths(month, 1)) {
    months.push(month);
    if (month === todayMonth) break;
  }
  return months;
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
    ledgerIndexFor(data.transactions).forMonth(month).filter((txn) => txn.category === category),
  );
  const fixed = data.fixedCosts
    .filter((cost) => commitmentActive(cost, month) && commitmentUnmatched(data, cost, month) && cost.category === category)
    .reduce((sum, cost) => sum + commitmentSpendAmount(cost, month), 0);
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
    const info = categoryInfo(entry.category, customCategories);
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
  const recordedTransactions = ledgerIndexFor(data.transactions).forMonth(month).filter(isSpend);
  const recordedEntries: AttributionEntry[] = recordedTransactions.map((txn) => ({
    category: txn.category,
    beneficiary: txn.beneficiary,
    amount: transactionSpendAmount(txn),
    merchant: txn.description,
  }));
  const recordedTotals = emptyBeneficiaryAmounts(members);
  for (const entry of recordedEntries) {
    addBeneficiaryAmount(recordedTotals, entry.beneficiary, entry.amount, memberIds);
  }

  const activeFixed = data.fixedCosts.filter((fixed) =>
    commitmentActive(fixed, month) && commitmentUnmatched(data, fixed, month) && commitmentSpendAmount(fixed, month) > 0);
  const fixedEntries: AttributionEntry[] = activeFixed.map((fixed) => {
    const beneficiary = fixed.beneficiary;
    const assignedMember = beneficiary.type === "member"
      ? members.find((member) => member.id === beneficiary.memberId)
      : undefined;
    return {
      category: fixed.category,
      beneficiary: assignedMember && !memberParticipatesInMonth(assignedMember, month)
        ? { type: "unassigned" }
        : beneficiary,
      amount: commitmentSpendAmount(fixed, month),
      merchant: fixed.label,
    };
  });
  const fixedTotals = emptyBeneficiaryAmounts(members);
  for (const entry of fixedEntries) {
    addBeneficiaryAmount(fixedTotals, entry.beneficiary, entry.amount, memberIds);
  }

  const amountFronted = new Map<MemberId, number>();
  const sharedFronted = new Map<MemberId, number>();
  const sharedResponsibilityByMember = new Map<MemberId, number>();
  const personalFrontedForOthers = new Map<MemberId, number>();
  const settlementNet = new Map<MemberId, number>();
  for (const member of members) {
    amountFronted.set(member.id, 0);
    sharedFronted.set(member.id, 0);
    sharedResponsibilityByMember.set(member.id, 0);
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

  for (const txn of recordedTransactions) {
    const value = transactionSpendAmount(txn);
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
    if (beneficiary.type === "household") {
      const participants = participatingMembersOn(members, txn.date);
      const recordedShare = participants.length ? value / participants.length : 0;
      const fundedShare = participants.length ? fundedByMembers / participants.length : 0;
      for (const participant of participants) {
        sharedResponsibilityByMember.set(
          participant.id,
          (sharedResponsibilityByMember.get(participant.id) ?? 0) + recordedShare,
        );
        settlementNet.set(participant.id, (settlementNet.get(participant.id) ?? 0) - fundedShare);
      }
      if (participants.length) {
        for (const [funderId, amount] of funding) {
          settlementNet.set(funderId, (settlementNet.get(funderId) ?? 0) + amount);
        }
      }
    }
  }
  const memberRows: SpendingAttributionMemberRow[] = members.map((member) => {
    const personalSpend = recordedTotals.byMember[member.id] ?? 0;
    const sharedResponsibility = sharedResponsibilityByMember.get(member.id) ?? 0;
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
  }).filter((row) => memberParticipatesInMonth(row.member, month)
    || row.personalSpend !== 0
    || row.amountFronted !== 0
    || row.sharedResponsibility !== 0
    || row.settlementNet !== 0);
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
  const ledgerIndex = ledgerIndexFor(data.transactions);

  // Credits (deposits, salary, transfers in) are kept in monthTransactions for
  // display (the Transactions table shows the account's full history) but are
  // never spend — income stays the manual settings figure, not
  // statement-derived — so every money sum below uses the debit-only subset.
  const monthTransactionsAll = [...ledgerIndex.forMonth(month)];
  const monthTransactions = monthTransactionsAll;
  const monthSpendAll = monthTransactionsAll.filter(isSpend);
  const monthSpend = monthSpendAll;
  const monthFixed = data.fixedCosts.filter((fixed) =>
    commitmentActive(fixed, month) && commitmentExpectedAmount(fixed, month) > 0);

  const cardSpend = spendTotal(monthTransactions);
  const fixedSpend = monthFixed
    .filter((fixed) => commitmentUnmatched(data, fixed, month))
    .reduce((sum, fixed) => sum + commitmentSpendAmount(fixed, month), 0);
  const investmentContributions = monthTransactions.reduce(
    (sum, transaction) => sum + holdingContributionAmount(transaction),
    0,
  );
  const plannedInvestmentContributions = monthFixed
    .filter((fixed) => commitmentUnmatched(data, fixed, month))
    .reduce((sum, fixed) => sum + commitmentInvestmentAmount(fixed, month), 0);
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

  // Protected windfalls improve savings without quietly expanding the normal
  // spending plan. Users can opt an individual one-off into ordinary treatment.
  const targetSpend = income.ordinaryTotal * (1 - targetSaveRate / 100);
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
    categoryTotals.set(txn.category, (categoryTotals.get(txn.category) ?? 0) + transactionSpendAmount(txn));
  }
  for (const fixed of monthFixed.filter((item) => commitmentUnmatched(data, item, month))) {
    categoryTotals.set(fixed.category, (categoryTotals.get(fixed.category) ?? 0) + commitmentSpendAmount(fixed, month));
  }
  const categoryRows: CategoryRow[] = [...categoryTotals.entries()]
    .map(([key, value]) => {
      const info = categoryInfo(key, customCategories);
      return { key, name: info.label, value, color: info.color };
    })
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  const maxCategoryValue = Math.max(...categoryRows.map((row) => row.value), 1);
  const fullCategoryRows: CategoryRow[] = spendingCategoryOptions(customCategories).map(
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
  const hasPreviousData = ledgerIndex.forMonth(previousMonth).length > 0;
  const movementRows: MovementRow[] = categoryRows.slice(0, 3).map((row) => {
    const previous = hasPreviousData ? categoryTotalForMonth(data, row.key, previousMonth) : 0;
    const details = [
      ...monthFixed
        .filter((fixed) => fixed.category === row.key && commitmentUnmatched(data, fixed, month))
        .map((fixed) => ({ label: fixed.label, value: commitmentSpendAmount(fixed, month) })),
      ...monthSpend
        .filter((txn) => txn.category === row.key)
        .sort((a, b) => transactionSpendAmount(b) - transactionSpendAmount(a))
        .slice(0, 3)
        .map((txn) => ({ label: txn.description, value: transactionSpendAmount(txn) })),
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
  const monthEnd = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const activeAtMonthEnd = members.filter((member) => memberParticipatesOn(member, monthEnd));
  const fairShare = activeAtMonthEnd.length ? householdShared / activeAtMonthEnd.length : 0;

  // The queue spans every month — a statement period straddles two — so the badge
  // above it must too. It counts *merchants Mizan is still asking about*, not rows:
  // one decision teaches one merchant, and a row count turns a dozen decisions into
  // a demoralizing three-digit number for work that cannot change the verdict.
  const askable = askableMerchants(data.transactions, totalSpend);
  const reviewQueueCount = askable.size;
  // The check-in is month-specific. Old review debt stays in the full queue, but
  // must not make the selected month's forecast look untrusted — and neither may
  // the tail, which is counted in every total already.
  const unresolvedCount = monthSpendAll.filter(
    (txn) => needsClassificationReview(txn) && askable.has(reviewMerchantKey(txn)),
  ).length;
  const horizon = addMonths(month, 2);
  const endingSoon = monthFixed.filter((fixed) => fixed.until && fixed.until <= horizon);
  const possibleFixedCostDuplicates = monthFixed.filter((fixed) =>
    commitmentUnmatched(data, fixed, month) &&
    monthSpendAll.some(
      (txn) => txn.category === fixed.category
        && beneficiaryEquals(txn.beneficiary, fixed.beneficiary)
        && Math.abs(transactionSpendAmount(txn) - commitmentSpendAmount(fixed, month)) < 0.01,
    ),
  );
  const assetSnapshot = computeAssetSnapshot(data, month, ledgerIndex);

  return {
    month,
    isCurrentMonth,
    dayNumber,
    daysInMonth: totalDays,
    daysLeft,
    latestTransactionDate,
    dataAgeDays,
    incomeTotal,
    ordinaryIncome: income.ordinaryTotal,
    protectedIncome: income.protectedTotal,
    incomeItems: income.items,
    cardSpend,
    fixedSpend,
    investmentContributions,
    plannedInvestmentContributions,
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
    assetSnapshot,
    attribution,
    unresolvedCount,
  };
}

export interface ReviewItem {
  merchant: string;
  count: number;
  total: number;
  accountContexts: ReviewAccountContext[];
  /**
   * True when at least one row still has an unassigned beneficiary. Purpose is a
   * breakdown detail, but an unassigned beneficiary changes settlement — who owes
   * whom — so the two gaps cannot be triaged at the same priority (see `reviewTiers`).
   */
  hasUnassignedBeneficiary: boolean;
  /** Uniform known values are retained so review asks only for the missing axis. */
  suggestedCategory?: CategoryKey;
  /**
   * Where `suggestedCategory` came from. `household` means the user's own rows
   * already agree; `seed` means Mizan's starter table guessed, which the card must
   * say out loud so a pre-filled answer is never mistaken for a known one.
   */
  suggestedCategorySource?: "household" | "seed";
  suggestedBeneficiary?: MerchantRule["beneficiary"];
  suggestedKind?: Transaction["kind"];
  suggestedCounterpartyId?: string;
  suggestedHoldingId?: string;
}

interface ReviewAccountContext {
  account: string;
  accountId?: string;
  count: number;
}

/**
 * The key `reviewQueue` groups by. Shared with the badge and the check-in gate so
 * a merchant cannot be asked about in one place and counted in another.
 */
function reviewMerchantKey(txn: Transaction): string {
  return txn.description.replace(/\s+/g, " ").trim().toUpperCase();
}

/** Merchants missing a purpose or beneficiary, grouped largest spend first. */
export function reviewQueue(transactions: Transaction[]): ReviewItem[] {
  const groups = new Map<string, { merchant: string; count: number; total: number; rows: Transaction[] }>();
  for (const txn of transactions) {
    if (!needsClassificationReview(txn)) continue;
    const merchant = reviewMerchantKey(txn);
    const item = groups.get(merchant) ?? { merchant, count: 0, total: 0, rows: [] };
    item.count += 1;
    item.total += transactionSpendAmount(txn);
    item.rows.push(txn);
    groups.set(merchant, item);
  }
  return [...groups.values()]
    .map(({ rows, ...item }): ReviewItem => {
      const accountContexts = new Map<string, ReviewAccountContext>();
      for (const row of rows) {
        const fallbackAccount = (row.rawAccount ?? row.account).replace(/\s+/g, " ").trim() || "Unmatched statement account";
        const key = row.accountId ? `id:${row.accountId}` : `raw:${fallbackAccount.toUpperCase()}`;
        const current = accountContexts.get(key);
        if (current) {
          current.count += 1;
        } else {
          accountContexts.set(key, {
            account: row.accountId ? row.account || fallbackAccount : fallbackAccount,
            ...(row.accountId ? { accountId: row.accountId } : {}),
            count: 1,
          });
        }
      }
      const knownCategories = [...new Set(rows.map((row) => row.category).filter((category) => category !== "uncategorized"))];
      // The household's own rows always win; the starter table only fills a blank.
      const householdCategory = knownCategories.length === 1 ? knownCategories[0] : undefined;
      const seeded = householdCategory ? undefined : seededCategory(item.merchant) ?? undefined;
      const suggestedCategory = householdCategory ?? seeded;
      const knownBeneficiaries = rows
        .map((row): MerchantRule["beneficiary"] => row.beneficiarySource === "account_default"
          ? { type: "account_default" }
          : row.beneficiary)
        .filter((beneficiary) => beneficiary.type !== "unassigned");
      const firstBeneficiary = knownBeneficiaries[0];
      const kinds = [...new Set(rows.map((row) => row.kind))];
      const counterparties = [...new Set(rows.map((row) => row.counterpartyId).filter((id): id is string => Boolean(id)))];
      const holdings = [...new Set(rows.map((row) => row.holdingId).filter((id): id is string => Boolean(id)))];
      return {
        ...item,
        hasUnassignedBeneficiary: rows.some((row) => row.beneficiary.type === "unassigned"),
        accountContexts: [...accountContexts.values()].sort(
          (a, b) => b.count - a.count || a.account.localeCompare(b.account),
        ),
        ...(suggestedCategory
          ? { suggestedCategory, suggestedCategorySource: householdCategory ? "household" as const : "seed" as const }
          : {}),
        ...(firstBeneficiary && knownBeneficiaries.every((beneficiary) => beneficiaryEquals(beneficiary, firstBeneficiary))
          ? { suggestedBeneficiary: firstBeneficiary }
          : {}),
        ...(kinds.length === 1 ? { suggestedKind: kinds[0] } : {}),
        ...(counterparties.length === 1 ? { suggestedCounterpartyId: counterparties[0] } : {}),
        ...(holdings.length === 1 ? { suggestedHoldingId: holdings[0] } : {}),
      };
    })
    .sort((a, b) => b.total - a.total || a.merchant.localeCompare(b.merchant));
}

/** Share of *material* unclassified spend the asked-about merchants must cover. */
const REVIEW_COVERAGE_TARGET = 0.8;
/** Always ask about at least this many purpose gaps, even when one merchant dominates. */
export const REVIEW_ASK_FLOOR = 3;
/** Never ask about more than this many purpose gaps in one sitting. */
export const REVIEW_ASK_CEILING = 8;
/**
 * A merchant below this share of the anchor spend is never asked about.
 *
 * This is what makes the queue finishable. Coverage alone is relative to whatever
 * is still unclassified, so clearing the top merchants would re-target the
 * remaining 80% and promote the next batch forever — a treadmill with no visible
 * end, which is exactly the failure being designed out. An absolute floor means
 * immaterial merchants can never be promoted by the queue getting shorter.
 */
const REVIEW_MATERIALITY_FRACTION = 0.01;

export interface ReviewTiers {
  /** Settlement-critical: an unassigned beneficiary changes who owes whom. Always asked. */
  mustAsk: ReviewItem[];
  /** Purpose gaps carrying most of the unclassified spend. Worth a decision. */
  worthAsking: ReviewItem[];
  /** The long tail. Already counted in every total; never interrupts. */
  tail: ReviewItem[];
  tailTotal: number;
  tailRowCount: number;
}

/**
 * Split an already-spend-sorted review queue by what each decision actually buys.
 *
 * `isSpend` is kind-based and ignores `category`, so an uncategorized row already
 * counts in total spend, the save rate, and the Home verdict — classifying it
 * changes the breakdown, not the answer. An unassigned beneficiary is different:
 * it changes settlement. Pricing both at the same urgency is what turns the queue
 * into a wall the user abandons.
 *
 * So: ask every settlement-critical merchant; among purpose gaps big enough to
 * matter (`REVIEW_MATERIALITY_FRACTION` of `anchorTotal`), ask the ones carrying
 * `REVIEW_COVERAGE_TARGET` of that material spend, bounded by a floor so a single
 * dominant merchant does not end the sitting and a ceiling so one sitting stays
 * finishable. Everything else is disclosed rather than asked.
 *
 * The materiality floor is applied before the coverage walk, so answering the
 * asked merchants shrinks the queue toward empty instead of re-targeting 80% of
 * the leftovers and promoting the next batch forever.
 *
 * `anchorTotal` is the spend the floor is measured against — the month's total
 * spend at the call site. Omitting it disables the floor.
 *
 * Pure and total: the three tiers always partition the input exactly.
 */
export function reviewTiers(
  queue: readonly ReviewItem[],
  options: { floor?: number; ceiling?: number; target?: number; anchorTotal?: number } = {},
): ReviewTiers {
  const floor = Math.max(0, options.floor ?? REVIEW_ASK_FLOOR);
  const ceiling = Math.max(0, options.ceiling ?? REVIEW_ASK_CEILING);
  const target = options.target ?? REVIEW_COVERAGE_TARGET;
  const materialityFloor = Math.max(0, options.anchorTotal ?? 0) * REVIEW_MATERIALITY_FRACTION;

  const mustAsk = queue.filter((item) => item.hasUnassignedBeneficiary);
  const remainder = queue.filter((item) => !item.hasUnassignedBeneficiary);
  const material = remainder.filter((item) => item.total >= materialityFloor);
  const materialTotal = material.reduce((sum, item) => sum + item.total, 0);

  const coverageTarget = materialTotal * target;
  let covered = 0;
  let needed = 0;
  for (const item of material) {
    if (covered >= coverageTarget) break;
    covered += item.total;
    needed += 1;
  }

  const askCount = Math.min(material.length, Math.max(needed, floor), ceiling);
  const worthAsking = material.slice(0, askCount);
  const asked = new Set(worthAsking);
  const tail = remainder.filter((item) => !asked.has(item));

  return {
    mustAsk,
    worthAsking,
    tail,
    tailTotal: tail.reduce((sum, item) => sum + item.total, 0),
    tailRowCount: tail.reduce((sum, item) => sum + item.count, 0),
  };
}

/** Merchant keys in the ask tiers: what the badge counts and the check-in gates on. */
function askableMerchants(transactions: Transaction[], anchorTotal: number): Set<string> {
  const tiers = reviewTiers(reviewQueue(transactions), { anchorTotal });
  return new Set([...tiers.mustAsk, ...tiers.worthAsking].map((item) => item.merchant));
}

/**
 * Month-by-month spend/saved/rate. Confirmed receipts apply to their recorded
 * month; months without receipts use the current expected portions.
 */
export function computeHistory(data: AppData, months: string[], today: Date): HistoryRow[] {
  const ledgerIndex = ledgerIndexFor(data.transactions);
  return months.map((month) => {
    const income = resolveMonthIncome(
      data.settings.members,
      data.incomeReceipts,
      data.settings.currency,
      data.settings.fxRates,
      month,
      today,
    );
    const incomeTotal = income.total;
    const spend =
      spendTotal(ledgerIndex.forMonth(month)) +
      data.fixedCosts
        .filter((fixed) => commitmentActive(fixed, month) && commitmentUnmatched(data, fixed, month))
        .reduce((sum, fixed) => sum + commitmentSpendAmount(fixed, month), 0);
    const saved = incomeTotal - spend;
    const oneOffIncome = income.items
      .filter((item) => item.portion.schedule.frequency === "one_off")
      .reduce((sum, item) => sum + item.net, 0);
    return {
      month,
      income: incomeTotal,
      protectedIncome: income.protectedTotal,
      oneOffIncome,
      spend,
      saved,
      rate: incomeTotal ? (saved / incomeTotal) * 100 : 0,
      assetValue: computeAssetSnapshot(data, month, ledgerIndex).totalValue,
    };
  });
}
