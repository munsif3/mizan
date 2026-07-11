import { seedAccounts } from "../domain/accounts";
import { isCategoryKey } from "../domain/categories";
import { normalizeFxTransaction } from "../domain/fx";
import { defaultIncomePortion, receiptId } from "../domain/income";
import { cleanMerchant } from "../domain/rules";
import { defaultKind, RESERVED_IDS, uid } from "../domain/types";
import type {
  Account,
  AppData,
  CategoryKey,
  Counterparty,
  CsvMapping,
  CustomCategory,
  FixedCost,
  IncomePortion,
  IncomeReceipt,
  Member,
  MemberId,
  MerchantRule,
  MerchantRules,
  MovementKind,
  Split,
  Transaction,
} from "../domain/types";
import { legacyCategory, legacyMemberIds, legacyMembers } from "./legacy";

export const SCHEMA_VERSION = 7 as const;

const MOVEMENT_KINDS = new Set<MovementKind>([
  "expense",
  "gift_or_handout",
  "loan_payment",
  "internal_transfer",
  "money_lent",
  "repayment_received",
  "investment_transfer",
  "account_credit",
]);

function asKind(value: unknown, direction: "debit" | "credit"): MovementKind {
  return typeof value === "string" && MOVEMENT_KINDS.has(value as MovementKind) ? (value as MovementKind) : defaultKind(direction);
}

export function emptyData(): AppData {
  return {
    schemaVersion: SCHEMA_VERSION,
    transactions: [],
    merchantRules: {},
    accounts: [],
    fixedCosts: [],
    incomeReceipts: [],
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

function asCategory(value: unknown): CategoryKey {
  if (typeof value === "string") {
    const legacy = legacyCategory(value);
    if (legacy) return legacy;
    if (isCategoryKey(value)) return value;
  }
  return "uncategorized";
}

function asSplit(value: unknown): Split | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { mine?: unknown; of?: unknown };
  const of = Number(raw.of);
  const mine = Number(raw.mine);
  if (!Number.isFinite(of) || !Number.isFinite(mine) || of < 2) return undefined;
  return { mine: Math.min(of, Math.max(0, mine)), of };
}

function asTransaction(value: unknown, splits: Record<string, unknown>): Transaction | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const date = String(raw.date ?? "");
  const amount = Number(raw.amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount)) return null;
  const id = String(raw.id ?? "") || `txn_${Math.random().toString(36).slice(2, 11)}`;
  const split = asSplit(raw.split) ?? asSplit(splits[id]);
  // pre-v4 data has no direction: every stored transaction was debit-only by construction
  const direction = raw.direction === "credit" ? "credit" : "debit";
  const counterpartyId = typeof raw.counterpartyId === "string" && raw.counterpartyId ? raw.counterpartyId : undefined;
  return {
    id,
    date,
    description: String(raw.description ?? ""),
    amount,
    category: asCategory(raw.category),
    // v1 stored the paying account under `card`
    account: String(raw.account ?? raw.card ?? "Unknown"),
    note: String(raw.note ?? ""),
    source: raw.source === "manual" ? "manual" : "imported",
    direction,
    // pre-v6 data has no kind: default from direction (debit → expense, credit → account_credit)
    kind: asKind(raw.kind, direction),
    ...(counterpartyId ? { counterpartyId } : {}),
    ...(split ? { split } : {}),
  };
}

function asFixedCost(value: unknown): FixedCost | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return {
    id: String(raw.id ?? "") || `fixed_${Math.random().toString(36).slice(2, 11)}`,
    label: String(raw.label ?? "Fixed cost"),
    amount: Number(raw.amount) || 0,
    category: asCategory(raw.category),
    until: String(raw.until ?? "") || undefined,
  };
}

function asAccount(value: unknown): Account | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const label = String(raw.label ?? "").trim();
  if (!label) return null;
  // Owner may be any member id or "joint"; validated against the member list in migrate().
  const owner = typeof raw.owner === "string" && raw.owner.trim() ? raw.owner.trim() : "joint";
  const match = (Array.isArray(raw.match) ? raw.match : []).map((item) => String(item ?? "").trim()).filter(Boolean);
  return {
    id: String(raw.id ?? "") || uid("acc"),
    label,
    owner,
    match,
  };
}

function asPortion(value: unknown): IncomePortion | null {
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
  return {
    id: String(raw.id ?? "").trim() || uid("por"),
    label,
    amount: Number.isFinite(amount) ? Math.max(0, amount) : 0,
    currency: String(raw.currency ?? "").trim().toUpperCase(),
    taxRate: Number.isFinite(Number(raw.taxRate)) ? Math.max(0, Math.min(99.999999, Number(raw.taxRate))) : 0,
    taxWithheld: raw.taxWithheld !== false,
    window,
  };
}

function asMember(value: unknown): Member | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? "").trim();
  const name = String(raw.name ?? "").trim();
  if (!id || !name || (RESERVED_IDS as readonly string[]).includes(id)) return null;
  return {
    id,
    name,
    color: typeof raw.color === "string" && raw.color ? raw.color : "#5b8cff",
    portions: Array.isArray(raw.portions)
      ? asList(raw.portions, asPortion)
      : Number(raw.income) > 0
        ? [defaultIncomePortion(id, Number(raw.income))]
        : [],
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

function asReceipt(value: unknown, portionOwners: Map<string, MemberId>): IncomeReceipt | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const month = String(raw.month ?? "");
  const portionId = String(raw.portionId ?? "").trim();
  const owner = portionOwners.get(portionId);
  const memberId = String(raw.memberId ?? "").trim();
  const amount = Number(raw.amount);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !portionId || !owner || owner !== memberId || !Number.isFinite(amount) || amount < 0) return null;
  const date = String(raw.date ?? "");
  const transactionId = typeof raw.transactionId === "string" ? raw.transactionId.trim() : "";
  return {
    id: receiptId(month, portionId),
    month,
    memberId,
    portionId,
    amount,
    ...(/^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {}),
    ...(transactionId ? { transactionId } : {}),
  };
}

function asRule(value: unknown): MerchantRule | null {
  // v5 stored a bare category string; v6 stores { category, kind, counterpartyId? }.
  if (typeof value === "string") {
    const category = asCategory(value);
    return category === "uncategorized" ? null : { category, kind: "expense" };
  }
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const category = asCategory(raw.category);
  const kind = asKind(raw.kind, "debit");
  const counterpartyId = typeof raw.counterpartyId === "string" && raw.counterpartyId ? raw.counterpartyId : undefined;
  // Drop a rule that classifies nothing (plain expense → uncategorized, no party);
  // but a non-expense kind or a counterparty is itself a meaningful classification.
  if (category === "uncategorized" && kind === "expense" && !counterpartyId) return null;
  return { category, kind, ...(counterpartyId ? { counterpartyId } : {}) };
}

function asRules(value: unknown): MerchantRules {
  if (!value || typeof value !== "object") return {};
  const rules: MerchantRules = {};
  for (const [merchant, rule] of Object.entries(value as Record<string, unknown>)) {
    const key = cleanMerchant(merchant);
    const mapped = asRule(rule);
    // Only keep an explicit rule, not a fallback to uncategorized.
    if (key && mapped) rules[key] = mapped;
  }
  return rules;
}

function asCounterparty(value: unknown): Counterparty | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = String(raw.name ?? "").trim();
  if (!name) return null;
  return { id: String(raw.id ?? "") || uid("cp"), name };
}

function asCustomCategory(value: unknown): CustomCategory | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const label = String(raw.label ?? "").trim();
  if (!label) return null;
  return {
    id: String(raw.id ?? "") || uid("cat"),
    label,
    color: typeof raw.color === "string" && raw.color ? raw.color : "#7b8194",
  };
}

function asList<T>(value: unknown, coerce: (item: unknown) => T | null): T[] {
  return (Array.isArray(value) ? value : []).map(coerce).filter((item): item is T => item !== null);
}

function asCsvPresets(value: unknown): Record<string, CsvMapping> {
  if (!value || typeof value !== "object") return {};
  const presets: Record<string, CsvMapping> = {};
  for (const [key, mapping] of Object.entries(value as Record<string, unknown>)) {
    // Trust the persisted shape; the CSV importer re-validates before applying.
    if (mapping && typeof mapping === "object") presets[key] = mapping as CsvMapping;
  }
  return presets;
}

/**
 * True when the source is legacy member data that predates
 * the member list — v4 or a trackr v1 backup. Such data seeds two members whose
 * ids are the literal names, so account owners and category keys carry forward
 * without a lookup table.
 */
/**
 * Normalize any known stored/backup shape into schema v5.
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

  const splits = (source.splits && typeof source.splits === "object" ? source.splits : {}) as Record<string, unknown>;
  const transactions = (Array.isArray(source.transactions) ? source.transactions : [])
    .map((txn) => asTransaction(txn, splits))
    .filter((txn): txn is Transaction => txn !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const fixedCosts = (Array.isArray(source.fixedCosts) ? source.fixedCosts : Array.isArray(source.fixedNonCard) ? source.fixedNonCard : [])
    .map(asFixedCost)
    .filter((cost): cost is FixedCost => cost !== null);

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

  const accounts = (Array.isArray(source.accounts)
    ? source.accounts.map(asAccount).filter((account): account is Account => account !== null)
    : seedAccounts(transactions, members)
  ).map((account) => (account.owner !== "joint" && !memberIds.has(account.owner) ? { ...account, owner: "joint" } : account));

  const currency = typeof settingsRaw.currency === "string" && settingsRaw.currency ? settingsRaw.currency : legacy ? "LKR" : "";
  const locale = typeof settingsRaw.locale === "string" && settingsRaw.locale ? settingsRaw.locale : legacy ? "en-LK" : "";
  members = members.map((member) => ({
    ...member,
    portions: member.portions.map((portion) => ({ ...portion, currency: portion.currency || currency })),
  }));
  const portionOwners = new Map(members.flatMap((member) => member.portions.map((portion) => [portion.id, member.id] as const)));
  const normalizedTransactions = transactions.map((txn) => normalizeFxTransaction(txn, currency));
  const transactionIds = new Set(normalizedTransactions.map((txn) => txn.id));
  const incomeReceipts = asList(source.incomeReceipts, (value) => asReceipt(value, portionOwners)).map((receipt) => {
    if (!receipt.transactionId || transactionIds.has(receipt.transactionId)) return receipt;
    const { transactionId: _removed, ...unlinked } = receipt;
    return unlinked;
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    transactions: normalizedTransactions,
    merchantRules: asRules(source.merchantRules),
    accounts,
    fixedCosts,
    incomeReceipts,
    settings: {
      members,
      targetSaveRate: Number(settingsRaw.targetSaveRate) || 25,
      currency,
      locale,
      fxRates: asFxRates(settingsRaw.fxRates),
      csvPresets: asCsvPresets(settingsRaw.csvPresets),
      counterparties: asList(settingsRaw.counterparties, asCounterparty),
      customCategories: asList(settingsRaw.customCategories, asCustomCategory),
    },
  };
}
