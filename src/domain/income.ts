import { daysInMonth, isoDateOf } from "./dates";
import { normalizeCurrency } from "./money";
import { memberParticipatesInMonth } from "./memberLifecycle";
import type { IncomeBudgetTreatment, IncomePortion, IncomeReceipt, Member, MemberId } from "./types";

export type IncomeStatus = "received" | "due" | "overdue" | "upcoming" | "unscheduled";

export interface PortionResolution {
  month: string;
  memberId: MemberId;
  memberName: string;
  memberColor: string;
  portion: IncomePortion;
  /** Deposit in household currency, before self-paid tax. */
  deposit: number;
  /** Amount available to the household after the portion's tax treatment. */
  net: number;
  /** Amount represented in the receipt/portion's native display currency. */
  nativeAmount: number;
  /** Native amount after the portion's tax treatment. */
  nativeNet: number;
  /** ISO currency used for nativeAmount/nativeNet. */
  nativeCurrency: string;
  receipt: IncomeReceipt | null;
  status: IncomeStatus;
  missingRate: boolean;
  budgetTreatment: IncomeBudgetTreatment;
  /** False for an overdue, unconfirmed one-off whose estimate is no longer trusted. */
  countsInTotal: boolean;
  taxRate: number;
  taxWithheld: boolean;
}

export function windowDaysFor(
  portion: Pick<IncomePortion, "window">,
  month: string,
): { startDay: number; endDay: number } | null {
  if (!portion.window) return null;
  const lastDay = daysInMonth(month);
  const rawStart = Math.min(portion.window.startDay, portion.window.endDay);
  const rawEnd = Math.max(portion.window.startDay, portion.window.endDay);
  const startDay = Math.min(lastDay, Math.max(1, rawStart));
  const endDay = Math.min(lastDay, Math.max(startDay, rawEnd));
  return { startDay, endDay };
}

export function defaultIncomePortion(memberId: MemberId, amount: number, currency = ""): IncomePortion {
  return {
    id: `por_${memberId}`,
    label: "Monthly income",
    amount: Number(amount) || 0,
    currency,
    taxRate: 0,
    taxWithheld: true,
    window: null,
    schedule: { frequency: "monthly" },
    budgetTreatment: "ordinary",
  };
}

export function portionActiveInMonth(portion: IncomePortion, month: string): boolean {
  return portion.schedule.frequency === "monthly" || portion.schedule.month === month;
}

function taxRateOf(portion: Pick<IncomePortion, "taxRate">): number {
  const rate = Number(portion.taxRate);
  return Number.isFinite(rate) ? Math.max(0, Math.min(99.999999, rate)) : 0;
}

export function netOf(amount: number, portion: Pick<IncomePortion, "taxRate" | "taxWithheld">): number {
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return portion.taxWithheld ? value : value * (1 - taxRateOf(portion) / 100);
}

export function fxRateFor(
  currency: string,
  householdCurrency: string,
  fxRates: Record<string, number>,
): number | null {
  const code = currency.trim().toUpperCase();
  const household = householdCurrency.trim().toUpperCase();
  if (!code || code === household) return 1;
  const rate = Number(fxRates[code]);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function expectedDeposit(
  portion: IncomePortion,
  householdCurrency: string,
  fxRates: Record<string, number>,
): { amount: number; missingRate: boolean } {
  const rate = fxRateFor(portion.currency, householdCurrency, fxRates);
  if (rate === null) return { amount: 0, missingRate: true };
  return { amount: (Number(portion.amount) || 0) * rate, missingRate: false };
}

export function receiptId(month: string, memberId: MemberId, portionId: string): string {
  return `rcpt_${month}_${memberId}_${portionId}`;
}

export function receiptFor(receipts: IncomeReceipt[], month: string, memberId: MemberId, portionId: string): IncomeReceipt | null {
  const id = receiptId(month, memberId, portionId);
  return receipts.find((receipt) => receipt.id === id
    || (receipt.month === month && receipt.memberId === memberId && receipt.portionId === portionId)) ?? null;
}

export function portionStatus(
  portion: IncomePortion,
  receipt: IncomeReceipt | null,
  month: string,
  today: Date,
): IncomeStatus {
  if (receipt) return "received";
  const window = windowDaysFor(portion, month);
  const currentMonth = isoDateOf(today).slice(0, 7);
  if (!window) {
    if (portion.schedule.frequency === "one_off") {
      if (month < currentMonth) return "overdue";
      if (month > currentMonth) return "upcoming";
    }
    return "unscheduled";
  }
  if (month < currentMonth) return "overdue";
  if (month > currentMonth) return "upcoming";
  const day = today.getDate();
  if (day < window.startDay) return "upcoming";
  if (day <= window.endDay) return "due";
  return "overdue";
}

export function resolveMonthIncome(
  members: Member[],
  receipts: IncomeReceipt[],
  householdCurrency: string,
  fxRates: Record<string, number>,
  month: string,
  today: Date,
): { items: PortionResolution[]; total: number; ordinaryTotal: number; protectedTotal: number } {
  const items = members.flatMap((member) =>
    member.portions.flatMap((portion): PortionResolution[] => {
      const receipt = receiptFor(receipts, month, member.id, portion.id);
      if (!receipt && (!memberParticipatesInMonth(member, month) || !portionActiveInMonth(portion, month))) return [];
      const expected = expectedDeposit(portion, householdCurrency, fxRates);
      const status = portionStatus(portion, receipt, month, today);
      const countsInTotal = Boolean(receipt) || portion.schedule.frequency === "monthly" || status !== "overdue";
      const deposit = receipt ? Number(receipt.amount) || 0 : countsInTotal ? expected.amount : 0;
      const taxTreatment = {
        taxRate: receipt?.taxRate ?? portion.taxRate,
        taxWithheld: receipt?.taxWithheld ?? portion.taxWithheld,
      };
      const budgetTreatment = receipt?.budgetTreatment ?? portion.budgetTreatment;
      const nativeAmount = receipt?.receivedAmount ?? (receipt ? deposit : Number(portion.amount) || 0);
      const nativeCurrency = receipt?.receivedCurrency
        ?? (receipt ? normalizeCurrency(householdCurrency) : normalizeCurrency(portion.currency, householdCurrency));
      return [{
        month,
        memberId: member.id,
        memberName: member.name,
        memberColor: member.color,
        portion: receipt?.label ? { ...portion, label: receipt.label } : portion,
        deposit,
        net: netOf(deposit, taxTreatment),
        nativeAmount,
        nativeNet: netOf(nativeAmount, taxTreatment),
        nativeCurrency,
        receipt,
        status,
        missingRate: !receipt && countsInTotal && expected.missingRate,
        budgetTreatment,
        countsInTotal,
        taxRate: taxTreatment.taxRate,
        taxWithheld: taxTreatment.taxWithheld,
      }];
    }),
  );
  const ordinaryTotal = items
    .filter((item) => item.budgetTreatment === "ordinary")
    .reduce((sum, item) => sum + item.net, 0);
  const protectedTotal = items
    .filter((item) => item.budgetTreatment === "protected")
    .reduce((sum, item) => sum + item.net, 0);
  return { items, total: ordinaryTotal + protectedTotal, ordinaryTotal, protectedTotal };
}

export function upsertReceipt(receipts: IncomeReceipt[], receipt: IncomeReceipt): IncomeReceipt[] {
  const normalized = { ...receipt, id: receiptId(receipt.month, receipt.memberId, receipt.portionId) };
  const withoutClaimedCredit = normalized.transactionId
    ? receipts.map((item) => {
        if (item.id === normalized.id || item.transactionId !== normalized.transactionId) return item;
        const { transactionId: _removed, ...unlinked } = item;
        return unlinked;
      })
    : receipts;
  const existing = withoutClaimedCredit.findIndex((item) => item.id === normalized.id);
  if (existing < 0) return [...withoutClaimedCredit, normalized];
  return withoutClaimedCredit.map((item, index) => (index === existing ? normalized : item));
}

/** Save one intentional statement-credit allocation without letting the credit escape this group. */
export function upsertReceiptGroup(
  receipts: IncomeReceipt[],
  group: IncomeReceipt[],
): IncomeReceipt[] {
  if (!group.length) return receipts;
  const transactionId = group[0]?.transactionId;
  const month = group[0]?.month;
  const memberId = group[0]?.memberId;
  if (!transactionId || group.some((item) => item.transactionId !== transactionId || item.month !== month || item.memberId !== memberId)) {
    throw new Error("Income allocation receipts must share one member, month, and statement credit.");
  }
  const groupIds = new Set(group.map((item) => receiptId(item.month, item.memberId, item.portionId)));
  if (groupIds.size !== group.length) throw new Error("An income allocation can contain each source only once.");

  const claimedElsewhere = receipts.some((item) => item.transactionId === transactionId
    && (item.month !== month || item.memberId !== memberId));
  if (claimedElsewhere) throw new Error("This statement credit is already linked to another income confirmation.");

  const normalizedGroup = group.map((item) => ({ ...item, id: receiptId(item.month, item.memberId, item.portionId) }));
  const withoutReplaced = receipts.filter((item) => !groupIds.has(item.id)
    && !(item.transactionId === transactionId && item.month === month && item.memberId === memberId));
  return [...withoutReplaced, ...normalizedGroup];
}

/** Clear a deleted transaction's provenance link without deleting the receipt. */
export function unlinkTransaction(receipts: IncomeReceipt[], transactionId: string): IncomeReceipt[] {
  return receipts.map((receipt) => {
    if (receipt.transactionId !== transactionId) return receipt;
    const { transactionId: _removed, ...unlinked } = receipt;
    return unlinked;
  });
}

export function removeReceipt(receipts: IncomeReceipt[], month: string, memberId: MemberId, portionId: string): IncomeReceipt[] {
  const id = receiptId(month, memberId, portionId);
  return receipts.filter((receipt) => receipt.id !== id
    && !(receipt.month === month && receipt.memberId === memberId && receipt.portionId === portionId));
}

export function pruneReceipts(receipts: IncomeReceipt[], members: Member[]): IncomeReceipt[] {
  const portions = new Set(members.flatMap((member) => member.portions.map((portion) => `${member.id}\u0000${portion.id}`)));
  return receipts.filter((receipt) => portions.has(`${receipt.memberId}\u0000${receipt.portionId}`));
}
