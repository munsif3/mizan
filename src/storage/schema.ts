import { applyAccountBeneficiaryDefaults, applySoloBeneficiaryDefaults, seedAccounts, transactionDisplayCurrency } from "../domain/accounts";
import { isCategoryKey } from "../domain/categories";
import { pruneSharedContributions } from "../domain/contributions";
import { normalizeFxTransaction } from "../domain/fx";
import { efficiencySubjectFingerprint } from "../domain/efficiency";
import { stableId } from "../domain/ids";
import { normalizedMemberLifecycle, validLifecycleDate } from "../domain/memberLifecycle";
import { defaultIncomePortion, fxRateFor, receiptId } from "../domain/income";
import { normalizeCurrency, resolveIncomeCurrency } from "../domain/money";
import { MOVEMENT_OPTIONS } from "../domain/movements";
import { cleanMerchant } from "../domain/rules";
import { defaultKind, RESERVED_IDS } from "../domain/types";
import { isCsvMapping } from "../import/csvMap";
import type {
  Account,
  AccountCadence,
  AppData,
  AssetHolding,
  AssetStatus,
  AssetType,
  CategoryKey,
  Counterparty,
  CsvMapping,
  CustomCategory,
  EfficiencyAction,
  EfficiencyPlan,
  EfficiencyPlanState,
  EfficiencyOutcomeResult,
  EfficiencySubject,
  FixedCost,
  FixedCostKind,
  IncomeBudgetTreatment,
  IncomePortion,
  IncomeReceipt,
  LifeValue,
  Member,
  MemberId,
  MerchantRule,
  MerchantRules,
  MovementKind,
  SharedContribution,
  ChangeEffort,
  SpendBeneficiary,
  Split,
  Transaction,
} from "../domain/types";
import { legacyCategory, legacyMemberIds, legacyMembers } from "./legacy";

const SCHEMA_VERSION = 18 as const;

const MOVEMENT_KINDS = new Set<MovementKind>(MOVEMENT_OPTIONS.map((option) => option.kind));
const ASSET_TYPES = new Set<AssetType>([
  "cash", "fixed_deposit", "property", "shares", "managed_fund",
  "insurance_policy", "retirement", "gold", "other",
]);
const ASSET_STATUSES = new Set<AssetStatus>(["active", "matured", "closed"]);
const CADENCE_PERIODS = new Set<AccountCadence["period"]>(["weekly", "monthly", "manual"]);

function asKind(value: unknown, direction: "debit" | "credit"): MovementKind {
  return typeof value === "string" && MOVEMENT_KINDS.has(value as MovementKind) ? (value as MovementKind) : defaultKind(direction);
}

export function emptyData(): AppData {
  return {
    schemaVersion: SCHEMA_VERSION,
    transactions: [],
    sharedContributions: [],
    merchantRules: {},
    accounts: [],
    fixedCosts: [],
    assetHoldings: [],
    incomeReceipts: [],
    efficiencyPlans: [],
    settings: {
      members: [],
      targetSaveRate: 25,
      currency: "",
      locale: "",
      fxRates: {},
      csvPresets: {},
      counterparties: [],
      customCategories: [],
    },
  };
}

function asEfficiencySubject(value: unknown): EfficiencySubject | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const beneficiary = asStoredBeneficiary(raw.beneficiary);
  if (!beneficiary) return null;
  const category = asCategory(raw.category);
  if (raw.type === "merchant") {
    const merchantKey = cleanMerchant(raw.merchantKey);
    return merchantKey ? { type: "merchant", merchantKey, category, beneficiary } : null;
  }
  if (raw.type === "category") return { type: "category", category, beneficiary };
  if (raw.type === "fixed_cost") {
    const fixedCostId = String(raw.fixedCostId ?? "").trim();
    return fixedCostId ? { type: "fixed_cost", fixedCostId, category, beneficiary } : null;
  }
  return null;
}

const LIFE_VALUES = new Set<LifeValue>(["essential", "worthwhile", "questionable"]);
const EFFICIENCY_ACTIONS = new Set<EfficiencyAction>(["keep", "reduce", "replace", "stop"]);
const CHANGE_EFFORTS = new Set<ChangeEffort>(["easy", "moderate", "hard"]);
const EFFICIENCY_STATES = new Set<EfficiencyPlanState>(["watching", "planned", "verified", "closed"]);

function asEfficiencyPlan(value: unknown): EfficiencyPlan | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const subject = asEfficiencySubject(raw.subject);
  if (!subject) return null;
  const valueRating = String(raw.value ?? "") as LifeValue;
  const action = String(raw.action ?? "") as EfficiencyAction;
  const effort = String(raw.effort ?? "") as ChangeEffort;
  const state = String(raw.state ?? "") as EfficiencyPlanState;
  if (!LIFE_VALUES.has(valueRating) || !EFFICIENCY_ACTIONS.has(action) || !CHANGE_EFFORTS.has(effort) || !EFFICIENCY_STATES.has(state)) return null;
  const baselineRaw = raw.baseline && typeof raw.baseline === "object" ? raw.baseline as Record<string, unknown> : {};
  const measurementScope = baselineRaw.measurementScope;
  if (measurementScope !== "merchant" && measurementScope !== "category" && measurementScope !== "fixed_cost") return null;
  const monthlyAmount = Number(baselineRaw.monthlyAmount);
  if (!Number.isFinite(monthlyAmount) || monthlyAmount < 0) return null;
  const months = Array.isArray(baselineRaw.months)
    ? baselineRaw.months.map(String).filter((month) => /^\d{4}-\d{2}$/.test(month))
    : [];
  const createdAt = String(raw.createdAt ?? "").trim();
  const updatedAt = String(raw.updatedAt ?? "").trim();
  if (!createdAt || !updatedAt) return null;
  const targetMonthlySavings = Math.max(0, Number(raw.targetMonthlySavings) || 0);
  const targetMonth = /^\d{4}-\d{2}$/.test(String(raw.targetMonth ?? "")) ? String(raw.targetMonth) : undefined;
  const revisitAfterMonth = /^\d{4}-\d{2}$/.test(String(raw.revisitAfterMonth ?? "")) ? String(raw.revisitAfterMonth) : undefined;
  const outcomeRaw = raw.outcome && typeof raw.outcome === "object" ? raw.outcome as Record<string, unknown> : null;
  const outcomeResult = outcomeRaw?.result;
  const outcomeMonth = String(outcomeRaw?.month ?? "");
  const confirmedAt = String(outcomeRaw?.confirmedAt ?? "").trim();
  const outcome = outcomeRaw
    && /^\d{4}-\d{2}$/.test(outcomeMonth)
    && (outcomeResult === "achieved" || outcomeResult === "partial" || outcomeResult === "not_achieved")
    && confirmedAt
    && outcomeRaw.dataComplete === true
      ? {
          month: outcomeMonth,
          observedMonthlyReduction: Math.max(0, Number(outcomeRaw.observedMonthlyReduction) || 0),
          result: outcomeResult as EfficiencyOutcomeResult,
          confirmedAt,
          dataComplete: true as const,
          substitutionWarning: Boolean(outcomeRaw.substitutionWarning),
        }
      : undefined;
  const subjectLabel = String(raw.subjectLabel ?? "").trim();
  const id = String(raw.id ?? "").trim() || stableId("effplan", raw);
  return {
    id,
    fingerprint: efficiencySubjectFingerprint(subject),
    subject,
    subjectLabel: subjectLabel || (subject.type === "merchant" ? subject.merchantKey : subject.type === "fixed_cost" ? subject.fixedCostId : subject.category),
    value: valueRating,
    action,
    effort,
    state,
    baseline: { months, monthlyAmount, measurementScope },
    targetMonthlySavings,
    ...(targetMonth ? { targetMonth } : {}),
    ...(revisitAfterMonth ? { revisitAfterMonth } : {}),
    createdAt,
    updatedAt,
    ...(outcome ? { outcome } : {}),
    ...(state === "closed" && (raw.closedReason === "subject_removed" || raw.closedReason === "subject_inactive")
      ? { closedReason: raw.closedReason }
      : {}),
  };
}

function asSharedContribution(value: unknown): SharedContribution | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const transferDebitTransactionId = String(raw.transferDebitTransactionId ?? "").trim();
  const transferCreditTransactionId = String(raw.transferCreditTransactionId ?? "").trim();
  const contributorMemberId = String(raw.contributorMemberId ?? "").trim();
  const amount = Number(raw.amount);
  const allocations = Array.isArray(raw.allocations)
    ? raw.allocations.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const allocation = item as Record<string, unknown>;
        const expenseTransactionId = String(allocation.expenseTransactionId ?? "").trim();
        const allocationAmount = Number(allocation.amount);
        return expenseTransactionId && Number.isFinite(allocationAmount) && allocationAmount > 0
          ? [{ expenseTransactionId, amount: allocationAmount }]
          : [];
      })
    : (() => {
        const expenseTransactionId = String(raw.expenseTransactionId ?? "").trim();
        return expenseTransactionId && Number.isFinite(amount) && amount > 0 ? [{ expenseTransactionId, amount }] : [];
      })();
  if (!allocations.length || !transferDebitTransactionId || !transferCreditTransactionId || !contributorMemberId || !Number.isFinite(amount) || amount <= 0) return null;
  return {
    id: String(raw.id ?? "").trim() || `contrib_${allocations.map((item) => item.expenseTransactionId).sort().join("_")}_${transferDebitTransactionId}_${transferCreditTransactionId}`,
    allocations,
    transferDebitTransactionId,
    transferCreditTransactionId,
    contributorMemberId,
    amount,
  };
}

function legacyPersonalMemberId(value: unknown): MemberId | null {
  if (typeof value !== "string") return null;
  const key = legacyCategory(value) ?? value;
  if (!key.startsWith("personal:")) return null;
  return key.slice("personal:".length).trim() || null;
}

function asCategory(value: unknown): CategoryKey {
  return isCategoryKey(value) ? value : "uncategorized";
}

function asStoredBeneficiary(value: unknown): SpendBeneficiary | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.type === "household") return { type: "household" };
  if (raw.type === "unassigned") return { type: "unassigned" };
  if (raw.type === "member") {
    const memberId = String(raw.memberId ?? "").trim();
    if (memberId) return { type: "member", memberId };
  }
  return null;
}

function asStoredRuleBeneficiary(value: unknown): MerchantRule["beneficiary"] | null {
  if (value && typeof value === "object" && (value as Record<string, unknown>).type === "account_default") {
    return { type: "account_default" };
  }
  return asStoredBeneficiary(value);
}

function asClassification(
  categoryValue: unknown,
  beneficiaryValue: unknown,
  sourceVersion: number,
): { category: CategoryKey; beneficiary: SpendBeneficiary } {
  const personalMemberId = legacyPersonalMemberId(categoryValue);
  const explicitBeneficiary = asStoredBeneficiary(beneficiaryValue);
  const category = personalMemberId ? "uncategorized" : asCategory(categoryValue);
  if (explicitBeneficiary) return { category, beneficiary: explicitBeneficiary };
  if (personalMemberId) return { category, beneficiary: { type: "member", memberId: personalMemberId } };
  if (sourceVersion < 12 && isCategoryKey(categoryValue) && category !== "uncategorized") {
    return { category, beneficiary: { type: "household" } };
  }
  return { category, beneficiary: { type: "unassigned" } };
}

function validBeneficiary(beneficiary: SpendBeneficiary, memberIds: Set<MemberId>): SpendBeneficiary {
  return beneficiary.type !== "member" || memberIds.has(beneficiary.memberId)
    ? beneficiary
    : { type: "unassigned" };
}

function asSplit(value: unknown): Split | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { mine?: unknown; of?: unknown };
  const of = Number(raw.of);
  const mine = Number(raw.mine);
  if (!Number.isFinite(of) || !Number.isFinite(mine) || of < 2) return undefined;
  return { mine: Math.min(of, Math.max(0, mine)), of };
}

function asTransaction(value: unknown, splits: Record<string, unknown>, sourceVersion: number, index = 0): Transaction | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const date = String(raw.date ?? "");
  const amount = Number(raw.amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount)) return null;
  const id = String(raw.id ?? "") || stableId("txn", raw, index);
  const split = asSplit(raw.split) ?? asSplit(splits[id]);
  // pre-v4 data has no direction: every stored transaction was debit-only by construction
  const direction = raw.direction === "credit" ? "credit" : "debit";
  const counterpartyId = typeof raw.counterpartyId === "string" && raw.counterpartyId ? raw.counterpartyId : undefined;
  const accountId = typeof raw.accountId === "string" && raw.accountId ? raw.accountId : undefined;
  const rawAccount = typeof raw.rawAccount === "string" && raw.rawAccount ? raw.rawAccount : undefined;
  const holdingId = typeof raw.holdingId === "string" && raw.holdingId ? raw.holdingId : undefined;
  const commitmentId = typeof raw.commitmentId === "string" && raw.commitmentId ? raw.commitmentId : undefined;
  const linkedTransferId = typeof raw.linkedTransferId === "string" && raw.linkedTransferId && raw.linkedTransferId !== id
    ? raw.linkedTransferId
    : undefined;
  const investmentAmount = Math.min(amount, Math.max(0, Number(raw.investmentAmount) || 0)) || undefined;
  const rejectedTransferIds = Array.isArray(raw.rejectedTransferIds)
    ? [...new Set(raw.rejectedTransferIds.map(String).filter((candidate) => candidate && candidate !== id))]
    : [];
  const classification = asClassification(raw.category, raw.beneficiary, sourceVersion);
  return {
    id,
    date,
    description: String(raw.description ?? ""),
    amount,
    ...classification,
    ...(raw.beneficiarySource === "account_default" ? { beneficiarySource: "account_default" as const } : {}),
    ...(raw.classificationLocked === true ? { classificationLocked: true } : {}),
    // v1 stored the paying account under `card`
    account: String(raw.account ?? raw.card ?? "Unmatched account"),
    ...(accountId ? { accountId } : {}),
    ...(rawAccount ? { rawAccount } : {}),
    note: String(raw.note ?? ""),
    source: raw.source === "manual" ? "manual" : "imported",
    direction,
    // pre-v6 data has no kind: default from direction (debit → expense, credit → account_credit)
    kind: asKind(raw.kind, direction),
    ...(counterpartyId ? { counterpartyId } : {}),
    ...(holdingId ? { holdingId } : {}),
    ...(commitmentId ? { commitmentId } : {}),
    ...(investmentAmount ? { investmentAmount } : {}),
    ...(linkedTransferId ? { linkedTransferId } : {}),
    ...(rejectedTransferIds.length ? { rejectedTransferIds } : {}),
    ...(split ? { split } : {}),
  };
}

function asFixedCost(value: unknown, sourceVersion: number, index = 0): FixedCost | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const from = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(raw.from ?? "")) ? String(raw.from) : "";
  const until = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(raw.until ?? "")) ? String(raw.until) : "";
  const classification = asClassification(raw.category, raw.beneficiary, sourceVersion);
  const amount = Math.max(0, Number(raw.amount) || 0);
  const totalAmount = Math.max(0, Number(raw.totalAmount) || 0);
  const investmentAmount = Math.min(amount, Math.max(0, Number(raw.investmentAmount) || 0));
  const holdingId = typeof raw.holdingId === "string" && raw.holdingId ? raw.holdingId : "";
  const merchantMatch = Array.isArray(raw.merchantMatch)
    ? [...new Set(raw.merchantMatch.map((item) => String(item ?? "").trim()).filter(Boolean))]
    : [];
  const kind = raw.kind === "loan_payment" || raw.kind === "investment_transfer" ? raw.kind : "expense";
  return {
    id: String(raw.id ?? "") || stableId("fixed", raw, index),
    label: String(raw.label ?? "Fixed cost"),
    amount,
    kind: kind satisfies FixedCostKind,
    ...classification,
    ...(from ? { from } : {}),
    ...(until ? { until } : {}),
    ...(totalAmount ? { totalAmount } : {}),
    ...(merchantMatch.length ? { merchantMatch } : {}),
    ...(holdingId ? { holdingId } : {}),
    ...(investmentAmount ? { investmentAmount } : {}),
  };
}

function asAccount(value: unknown, index = 0): Account | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const label = String(raw.label ?? "").trim();
  if (!label) return null;
  // Owner may be any member id, explicit joint funding, or unresolved funding.
  const owner = typeof raw.owner === "string" && raw.owner.trim() ? raw.owner.trim() : "unassigned";
  const beneficiaryDefault = raw.beneficiaryDefault === "owner" || raw.beneficiaryDefault === "household"
    || raw.beneficiaryDefault === "review" ? raw.beneficiaryDefault : "review";
  const match = (Array.isArray(raw.match) ? raw.match : []).map((item) => String(item ?? "").trim()).filter(Boolean);
  const activeFrom = validLifecycleDate(raw.activeFrom) ? raw.activeFrom : "";
  const inactiveFrom = validLifecycleDate(raw.inactiveFrom) ? raw.inactiveFrom : "";
  const coverageRaw = raw.coverage && typeof raw.coverage === "object" ? raw.coverage as Record<string, unknown> : null;
  const throughDate = coverageRaw && validLifecycleDate(coverageRaw.throughDate) ? coverageRaw.throughDate : "";
  const confirmedAt = String(coverageRaw?.confirmedAt ?? "").trim();
  const confirmedByUid = String(coverageRaw?.confirmedByUid ?? "").trim();
  const coverage = throughDate && confirmedAt && confirmedByUid
    ? {
        throughDate,
        confirmedAt,
        confirmedByUid,
        source: coverageRaw?.source === "statement" ? "statement" as const : "manual" as const,
      }
    : undefined;
  // v17 -> v18. Absent cadence means monthly, so pre-v18 accounts keep working
  // without a rewrite; only an explicitly chosen rhythm is stored.
  const cadenceRaw = raw.cadence && typeof raw.cadence === "object" ? raw.cadence as Record<string, unknown> : null;
  const period = CADENCE_PERIODS.has(cadenceRaw?.period as AccountCadence["period"])
    ? cadenceRaw!.period as AccountCadence["period"]
    : null;
  const dueDayNumber = Math.trunc(Number(cadenceRaw?.dueDay));
  const dueDay = Number.isFinite(dueDayNumber) && dueDayNumber >= 1 && dueDayNumber <= 31 ? dueDayNumber : 0;
  const cadence = period
    ? { period, ...(period === "monthly" && dueDay ? { dueDay } : {}) }
    : undefined;
  return {
    id: String(raw.id ?? "") || stableId("acc", raw, index),
    label,
    currency: String(raw.currency ?? "").trim().toUpperCase(),
    owner,
    beneficiaryDefault,
    ...(activeFrom ? { activeFrom } : {}),
    ...(inactiveFrom && (!activeFrom || inactiveFrom > activeFrom) ? { inactiveFrom } : {}),
    ...(coverage ? { coverage } : {}),
    ...(cadence ? { cadence } : {}),
    match,
  };
}

function asAssetHolding(value: unknown, index = 0): AssetHolding | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const label = String(raw.label ?? "").trim();
  if (!label) return null;
  const type = ASSET_TYPES.has(raw.type as AssetType) ? raw.type as AssetType : "other";
  const status = ASSET_STATUSES.has(raw.status as AssetStatus) ? raw.status as AssetStatus : "active";
  const owner = typeof raw.owner === "string" && raw.owner.trim() ? raw.owner.trim() : "unassigned";
  const valuations = (Array.isArray(raw.valuations) ? raw.valuations : [])
    .map((item, valuationIndex) => {
      if (!item || typeof item !== "object") return null;
      const valuation = item as Record<string, unknown>;
      const date = String(valuation.date ?? "");
      const amount = Number(valuation.amount);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount) || amount < 0) return null;
      const note = String(valuation.note ?? "").trim();
      return {
        id: String(valuation.id ?? "") || stableId("value", valuation, valuationIndex),
        date,
        amount,
        ...(note ? { note } : {}),
      };
    })
    .filter((item): item is AssetHolding["valuations"][number] => item !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const linkedAccountId = String(raw.linkedAccountId ?? "").trim();
  const institution = String(raw.institution ?? "").trim();
  const openedOn = validLifecycleDate(raw.openedOn) ? raw.openedOn : "";
  const maturityOn = validLifecycleDate(raw.maturityOn) ? raw.maturityOn : "";
  return {
    id: String(raw.id ?? "") || stableId("asset", raw, index),
    label,
    type,
    currency: String(raw.currency ?? "").trim().toUpperCase(),
    owner,
    status,
    valuations,
    ...(institution ? { institution } : {}),
    ...(linkedAccountId ? { linkedAccountId } : {}),
    ...(openedOn ? { openedOn } : {}),
    ...(maturityOn && (!openedOn || maturityOn >= openedOn) ? { maturityOn } : {}),
  };
}

function asPortion(value: unknown, index = 0): IncomePortion | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const amount = Number(raw.amount);
  const label = String(raw.label ?? "").trim() || "Income portion";
  const rawWindow = raw.window && typeof raw.window === "object" ? raw.window as Record<string, unknown> : null;
  let window: IncomePortion["window"] = null;
  if (rawWindow) {
    const first = Number(rawWindow.startDay);
    const second = Number(rawWindow.endDay);
    if (Number.isInteger(first) && Number.isInteger(second) && first >= 1 && first <= 31 && second >= 1 && second <= 31) {
      window = { startDay: Math.min(first, second), endDay: Math.max(first, second) };
    }
  }
  const scheduledMonth = String(raw.schedule && typeof raw.schedule === "object"
    ? (raw.schedule as Record<string, unknown>).month ?? ""
    : raw.month ?? "");
  const frequency = raw.schedule && typeof raw.schedule === "object"
    ? (raw.schedule as Record<string, unknown>).frequency
    : raw.frequency;
  const schedule: IncomePortion["schedule"] = frequency === "one_off" && /^\d{4}-(0[1-9]|1[0-2])$/.test(scheduledMonth)
    ? { frequency: "one_off", month: scheduledMonth }
    : { frequency: "monthly" };
  const budgetTreatment = (raw.budgetTreatment === "protected" ? "protected" : "ordinary") satisfies IncomeBudgetTreatment;
  return {
    id: String(raw.id ?? "").trim() || stableId("por", raw, index),
    label,
    amount: Number.isFinite(amount) ? Math.max(0, amount) : 0,
    currency: String(raw.currency ?? "").trim().toUpperCase(),
    taxRate: Number.isFinite(Number(raw.taxRate)) ? Math.max(0, Math.min(99.999999, Number(raw.taxRate))) : 0,
    taxWithheld: raw.taxWithheld !== false,
    window,
    schedule,
    budgetTreatment,
  };
}

function asMember(value: unknown): Member | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? "").trim();
  const name = String(raw.name ?? "").trim();
  if (!id || !name || (RESERVED_IDS as readonly string[]).includes(id)) return null;
  const lifecycle = normalizedMemberLifecycle(raw.lifecycle);
  return {
    id,
    name,
    color: typeof raw.color === "string" && raw.color ? raw.color : "#5b8cff",
    portions: Array.isArray(raw.portions)
      ? asList(raw.portions, asPortion)
      : Number(raw.income) > 0
        ? [defaultIncomePortion(id, Number(raw.income))]
        : [],
    ...(lifecycle ? { lifecycle } : {}),
  };
}

function asFxRates(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const rates: Record<string, number> = {};
  for (const [rawCode, rawRate] of Object.entries(value as Record<string, unknown>)) {
    const code = rawCode.trim().toUpperCase();
    const rate = Number(rawRate);
    if (/^[A-Z]{3}$/.test(code) && Number.isFinite(rate) && rate > 0) rates[code] = rate;
  }
  return rates;
}

function asReceipt(value: unknown, portionOwners: Set<string>): IncomeReceipt | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const month = String(raw.month ?? "");
  const portionId = String(raw.portionId ?? "").trim();
  const memberId = String(raw.memberId ?? "").trim();
  const amount = Number(raw.amount);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    || !portionId
    || !portionOwners.has(`${memberId}\u0000${portionId}`)
    || !Number.isFinite(amount)
    || amount < 0) return null;
  const date = String(raw.date ?? "");
  const transactionId = typeof raw.transactionId === "string" ? raw.transactionId.trim() : "";
  const receivedAmount = Number(raw.receivedAmount);
  const receivedCurrency = String(raw.receivedCurrency ?? "").trim().toUpperCase();
  const fxRate = Number(raw.fxRate);
  const currencyReview = raw.currencyReview === true;
  const label = String(raw.label ?? "").trim();
  const taxRate = Number(raw.taxRate);
  const taxWithheld = typeof raw.taxWithheld === "boolean" ? raw.taxWithheld : undefined;
  const budgetTreatment = raw.budgetTreatment === "protected" || raw.budgetTreatment === "ordinary"
    ? raw.budgetTreatment
    : undefined;
  return {
    id: receiptId(month, memberId, portionId),
    month,
    memberId,
    portionId,
    amount,
    ...(Number.isFinite(receivedAmount) && receivedAmount >= 0 && /^[A-Z]{3}$/.test(receivedCurrency)
      ? { receivedAmount, receivedCurrency }
      : {}),
    ...(Number.isFinite(fxRate) && fxRate > 0 ? { fxRate } : {}),
    ...(currencyReview ? { currencyReview: true } : {}),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {}),
    ...(transactionId ? { transactionId } : {}),
    ...(label ? { label } : {}),
    ...(Number.isFinite(taxRate) ? { taxRate: Math.max(0, Math.min(99.999999, taxRate)) } : {}),
    ...(taxWithheld !== undefined ? { taxWithheld } : {}),
    ...(budgetTreatment ? { budgetTreatment } : {}),
  };
}

function withReceiptSnapshot(receipt: IncomeReceipt, members: Member[]): IncomeReceipt {
  const portion = members
    .find((member) => member.id === receipt.memberId)
    ?.portions.find((item) => item.id === receipt.portionId);
  if (!portion) return receipt;
  return {
    ...receipt,
    label: receipt.label ?? portion.label,
    taxRate: receipt.taxRate ?? portion.taxRate,
    taxWithheld: receipt.taxWithheld ?? portion.taxWithheld,
    budgetTreatment: receipt.budgetTreatment ?? portion.budgetTreatment,
  };
}

function repairLegacyReceiptCurrency(
  receipt: IncomeReceipt,
  members: Member[],
  transactions: Transaction[],
  accounts: Account[],
  householdCurrency: string,
  fxRates: Record<string, number>,
): IncomeReceipt {
  if (receipt.receivedCurrency) return receipt;
  const portion = members.flatMap((member) => member.portions).find((item) => item.id === receipt.portionId);
  const household = normalizeCurrency(householdCurrency);
  const portionCurrency = normalizeCurrency(portion?.currency, household);
  if (!portion || !portionCurrency || portionCurrency === household) return receipt;

  const transaction = transactions.find((item) => item.id === receipt.transactionId);
  const rate = fxRateFor(portionCurrency, household, fxRates);
  if (transaction && rate) {
    const resolution = resolveIncomeCurrency({
      accountCurrency: transactionDisplayCurrency(transaction, accounts, household),
      portionCurrency,
      householdCurrency: household,
      statementAmount: transaction.amount,
      portionAmount: portion.amount,
      fxRate: rate,
    });
    const sameStoredAmount = Math.abs(receipt.amount - transaction.amount) <= Math.max(0.01, Math.abs(transaction.amount) * 1e-9);
    if (sameStoredAmount && resolution.source === "portion-match") {
      const { currencyReview: _review, ...repaired } = receipt;
      return {
        ...repaired,
        amount: transaction.amount * rate,
        receivedAmount: transaction.amount,
        receivedCurrency: portionCurrency,
        fxRate: rate,
      };
    }
  }
  return { ...receipt, currencyReview: true };
}

function hasRecognizedCategory(value: unknown): boolean {
  return legacyPersonalMemberId(value) !== null || isCategoryKey(value);
}

function asRule(value: unknown, sourceVersion: number, memberIds: Set<MemberId>): MerchantRule | null {
  // v5 stored a bare category string; v6 stores { category, kind, counterpartyId? }.
  if (typeof value === "string") {
    if (!hasRecognizedCategory(value)) return null;
    const classification = asClassification(value, undefined, sourceVersion);
    return { ...classification, beneficiary: validBeneficiary(classification.beneficiary, memberIds), kind: "expense" };
  }
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const classification = asClassification(raw.category, raw.beneficiary, sourceVersion);
  const storedBeneficiary = asStoredRuleBeneficiary(raw.beneficiary);
  const beneficiary = storedBeneficiary?.type === "account_default"
    ? storedBeneficiary
    : validBeneficiary(storedBeneficiary ?? classification.beneficiary, memberIds);
  const kind = asKind(raw.kind, "debit");
  const counterpartyId = typeof raw.counterpartyId === "string" && raw.counterpartyId ? raw.counterpartyId : undefined;
  const holdingId = typeof raw.holdingId === "string" && raw.holdingId ? raw.holdingId : undefined;
  // Drop a rule that classifies nothing (plain expense → uncategorized, no party);
  // but a non-expense kind or a counterparty is itself a meaningful classification.
  const hasClassification = hasRecognizedCategory(raw.category) || asStoredRuleBeneficiary(raw.beneficiary) !== null;
  if (!hasClassification && kind === "expense" && !counterpartyId) return null;
  return {
    category: classification.category,
    beneficiary,
    kind,
    ...(counterpartyId ? { counterpartyId } : {}),
    ...(holdingId ? { holdingId } : {}),
  };
}

function asRules(value: unknown, sourceVersion: number, memberIds: Set<MemberId>): MerchantRules {
  if (!value || typeof value !== "object") return {};
  const rules: MerchantRules = {};
  for (const [merchant, rule] of Object.entries(value as Record<string, unknown>)) {
    const key = cleanMerchant(merchant);
    const mapped = asRule(rule, sourceVersion, memberIds);
    // Only keep an explicit rule, not a fallback to uncategorized.
    if (key && mapped) rules[key] = mapped;
  }
  return rules;
}

function asCounterparty(value: unknown, index = 0): Counterparty | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = String(raw.name ?? "").trim();
  if (!name) return null;
  return { id: String(raw.id ?? "") || stableId("cp", raw, index), name };
}

function asCustomCategory(value: unknown, index = 0): CustomCategory | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const label = String(raw.label ?? "").trim();
  if (!label) return null;
  return {
    id: String(raw.id ?? "") || stableId("cat", raw, index),
    label,
    color: typeof raw.color === "string" && raw.color ? raw.color : "#7b8194",
  };
}

function asList<T>(value: unknown, coerce: (item: unknown, index: number) => T | null): T[] {
  return (Array.isArray(value) ? value : []).map(coerce).filter((item): item is T => item !== null);
}

function asCsvPresets(value: unknown): Record<string, CsvMapping> {
  if (!value || typeof value !== "object") return {};
  const presets: Record<string, CsvMapping> = {};
  for (const [key, mapping] of Object.entries(value as Record<string, unknown>)) {
    if (isCsvMapping(mapping)) presets[key] = mapping;
  }
  return presets;
}

function repairVersionedIncomeReceipts(
  receipts: IncomeReceipt[],
  sourceVersion: number,
  members: Member[],
  transactions: Transaction[],
  accounts: Account[],
  currency: string,
  fxRates: Record<string, number>,
): IncomeReceipt[] {
  // These stages are intentionally version-gated. Current-shape decoding above
  // must not quietly absorb historical fixes or their idempotency guarantees.
  const currencyRepaired = sourceVersion < 11
    ? receipts.map((receipt) => repairLegacyReceiptCurrency(
        receipt,
        members,
        transactions,
        accounts,
        currency,
        fxRates,
      ))
    : receipts;
  return sourceVersion < 14
    ? currencyRepaired.map((receipt) => withReceiptSnapshot(receipt, members))
    : currencyRepaired;
}

/**
 * True when the source is legacy member data that predates
 * the member list — v4 or a trackr v1 backup. Such data seeds two members whose
 * ids are the literal names, so account owners and category keys carry forward
 * without a lookup table.
 */
/**
 * Normalize any known stored/backup shape into the current schema.
 * Accepts Mizan v5/v4/v3/v2 data and trackr v1 backups (`splits` map, `card`
 * field, root-level `income`, `fixedNonCard`). Legacy data seeds a
 * member list; data with no member list and no legacy member markers
 * yields an empty list (the app then shows onboarding). Accounts without a
 * registry get one seeded from the distinct labels. Unknown junk degrades to
 * empty data, never throws.
 */
export function migrate(raw: unknown): AppData {
  const base = emptyData();
  if (!raw || typeof raw !== "object") return base;
  const source = raw as Record<string, unknown>;
  const sourceVersion = Number(source.schemaVersion) || 0;
  if (sourceVersion > SCHEMA_VERSION) {
    throw new Error(`This data uses Mizan schema v${sourceVersion}. Update Mizan before opening it.`);
  }

  const splits = (source.splits && typeof source.splits === "object" ? source.splits : {}) as Record<string, unknown>;
  let transactions = (Array.isArray(source.transactions) ? source.transactions : [])
    .map((txn, index) => asTransaction(txn, splits, sourceVersion, index))
    .filter((txn): txn is Transaction => txn !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  let fixedCosts = (Array.isArray(source.fixedCosts) ? source.fixedCosts : Array.isArray(source.fixedNonCard) ? source.fixedNonCard : [])
    .map((cost, index) => asFixedCost(cost, sourceVersion, index))
    .filter((cost): cost is FixedCost => cost !== null);
  let assetHoldings = (Array.isArray(source.assetHoldings) ? source.assetHoldings : [])
    .map((holding, index) => asAssetHolding(holding, index))
    .filter((holding): holding is AssetHolding => holding !== null);

  const settingsRaw = (source.settings && typeof source.settings === "object" ? source.settings : {}) as Record<string, unknown>;
  const incomeRaw = ((settingsRaw.income ?? source.income) && typeof (settingsRaw.income ?? source.income) === "object"
    ? (settingsRaw.income ?? source.income)
    : {}) as Record<string, unknown>;

  const legacyIds = legacyMemberIds(settingsRaw, incomeRaw, source);
  const legacy = legacyIds.length > 0;
  let members: Member[];
  if (Array.isArray(settingsRaw.members)) {
    members = settingsRaw.members.map(asMember).filter((m): m is Member => m !== null);
  } else if (legacy) {
    members = legacyMembers(legacyIds, incomeRaw);
  } else {
    members = [];
  }
  const memberIds = new Set(members.map((m) => m.id));
  transactions = transactions.map((transaction) => ({
    ...transaction,
    beneficiary: validBeneficiary(transaction.beneficiary, memberIds),
  }));
  fixedCosts = fixedCosts.map((cost) => ({
    ...cost,
    beneficiary: validBeneficiary(cost.beneficiary, memberIds),
  }));

  const currency = typeof settingsRaw.currency === "string" && settingsRaw.currency ? settingsRaw.currency.trim().toUpperCase() : legacy ? "LKR" : "";
  const accounts = (Array.isArray(source.accounts)
    ? source.accounts.map(asAccount).filter((account): account is Account => account !== null)
    : seedAccounts(transactions, members, currency)
  ).map((account) => ({
    ...account,
    currency: account.currency || currency,
    ...(account.owner !== "joint" && account.owner !== "unassigned" && !memberIds.has(account.owner)
      ? { owner: "unassigned" as const }
      : {}),
  }));
  const accountIds = new Set(accounts.map((account) => account.id));
  assetHoldings = assetHoldings.map((holding) => {
    const next: AssetHolding = {
      ...holding,
      currency: holding.currency || currency,
      ...(holding.owner !== "joint" && holding.owner !== "unassigned" && !memberIds.has(holding.owner)
        ? { owner: "unassigned" as const }
        : {}),
    };
    if (next.linkedAccountId && !accountIds.has(next.linkedAccountId)) delete next.linkedAccountId;
    return next;
  });
  const holdingIds = new Set(assetHoldings.map((holding) => holding.id));
  const fixedCostIds = new Set(fixedCosts.map((cost) => cost.id));
  fixedCosts = fixedCosts.map((cost) => {
    const next = { ...cost };
    if (!next.holdingId || !holdingIds.has(next.holdingId)) {
      delete next.holdingId;
      delete next.investmentAmount;
    }
    return next;
  });

  const locale = typeof settingsRaw.locale === "string" && settingsRaw.locale ? settingsRaw.locale : legacy ? "en-LK" : "";
  members = members.map((member) => ({
    ...member,
    portions: member.portions.map((portion) => ({ ...portion, currency: portion.currency || currency })),
  }));
  const portionOwners = new Set(members.flatMap((member) => member.portions.map((portion) => `${member.id}\u0000${portion.id}`)));
  const fxNormalizedTransactions = transactions.map((txn) => normalizeFxTransaction(txn, currency));
  // Account-derived beneficiaries only recompute inferred rows here (unassigned
  // rows keep their review state for multi-member households). A one-member
  // household is the exception: every spend is that member's, so backfill it.
  let normalizedTransactions = applySoloBeneficiaryDefaults(
    applyAccountBeneficiaryDefaults(fxNormalizedTransactions, accounts, members, { fillUnassigned: false }),
    accounts,
    members,
  );
  const importedTransactionIds = new Set(normalizedTransactions.map((transaction) => transaction.id));
  normalizedTransactions = normalizedTransactions.map((transaction) => {
    const next = { ...transaction };
    if (!next.holdingId || !holdingIds.has(next.holdingId)) {
      delete next.holdingId;
      delete next.investmentAmount;
    }
    if (!next.commitmentId || !fixedCostIds.has(next.commitmentId)) delete next.commitmentId;
    if (!next.linkedTransferId || !importedTransactionIds.has(next.linkedTransferId)) delete next.linkedTransferId;
    const rejected = next.rejectedTransferIds?.filter((id) => importedTransactionIds.has(id) && id !== next.id) ?? [];
    if (rejected.length) next.rejectedTransferIds = rejected;
    else delete next.rejectedTransferIds;
    return next;
  });
  const fxRates = asFxRates(settingsRaw.fxRates);
  const transactionIds = new Set(normalizedTransactions.map((txn) => txn.id));
  const normalizedReceipts = asList(source.incomeReceipts, (value) => asReceipt(value, portionOwners)).map((receipt) => {
    if (!receipt.transactionId || transactionIds.has(receipt.transactionId)) return receipt;
    const { transactionId: _removed, ...unlinked } = receipt;
    return unlinked;
  });
  const incomeReceipts = repairVersionedIncomeReceipts(
    normalizedReceipts,
    sourceVersion,
    members,
    normalizedTransactions,
    accounts,
    currency,
    fxRates,
  );
  const sharedContributions = pruneSharedContributions(
    asList(source.sharedContributions, asSharedContribution),
    normalizedTransactions,
    accounts,
    members,
  );

  const merchantRules = asRules(source.merchantRules, sourceVersion, memberIds);
  for (const rule of Object.values(merchantRules)) {
    if (rule.holdingId && !holdingIds.has(rule.holdingId)) delete rule.holdingId;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    transactions: normalizedTransactions,
    sharedContributions,
    merchantRules,
    accounts,
    fixedCosts,
    assetHoldings,
    incomeReceipts,
    efficiencyPlans: asList(source.efficiencyPlans, asEfficiencyPlan),
    settings: {
      members,
      targetSaveRate: (() => {
        const rate = Number(settingsRaw.targetSaveRate);
        return Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : 25;
      })(),
      currency,
      locale,
      fxRates,
      csvPresets: asCsvPresets(settingsRaw.csvPresets),
      counterparties: asList(settingsRaw.counterparties, asCounterparty),
      customCategories: asList(settingsRaw.customCategories, asCustomCategory),
    },
  };
}
