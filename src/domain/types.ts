/** The fixed part of the taxonomy — shared by every household. */
export type FixedCategoryKey =
  | "housing"
  | "food"
  | "utilities"
  | "transport"
  | "health"
  | "dining"
  | "lifestyle"
  | "family_support"
  | "investments"
  | "uncategorized";

/** One personal-spend bucket per household member: `personal:<memberId>`. */
export type PersonalCategoryKey = `personal:${string}`;

/** A user-defined category, keyed `custom:<id>` (see `settings.customCategories`). */
export type CustomCategoryKey = `custom:${string}`;

export type CategoryKey = FixedCategoryKey | PersonalCategoryKey | CustomCategoryKey;

/** Build the personal-category key for a member. */
export function personalCategory(id: MemberId): PersonalCategoryKey {
  return `personal:${id}`;
}

/** The member id inside a `personal:<id>` key, or null for a fixed category. */
export function personalMemberId(key: string): MemberId | null {
  return key.startsWith("personal:") ? key.slice("personal:".length) : null;
}

/** Build the custom-category key for a custom-category id. */
export function customCategory(id: string): CustomCategoryKey {
  return `custom:${id}`;
}

/** The custom id inside a `custom:<id>` key, or null otherwise. */
export function customCategoryId(key: string): string | null {
  return key.startsWith("custom:") ? key.slice("custom:".length) : null;
}

/**
 * How a transaction moves money. `category` says what the money was *for*;
 * `kind` says what *kind* of movement it is, and drives spend/save-rate math.
 * `expense`, `gift_or_handout`, and `loan_payment` count as spend; the rest —
 * account hops, lending, repayments, investments, plain credits — do not.
 * See `SPEND_KINDS` / `isSpend` in src/domain/summary.ts.
 */
export type MovementKind =
  | "expense"
  | "gift_or_handout"
  | "loan_payment"
  | "internal_transfer"
  | "money_lent"
  | "repayment_received"
  | "investment_transfer"
  | "account_credit";

/** The default movement kind for a freshly imported/entered row, from its sign. */
export function defaultKind(direction: "debit" | "credit"): MovementKind {
  return direction === "credit" ? "account_credit" : "expense";
}

/** A person outside the household that money is lent to, repaid by, or gifted. */
export interface Counterparty {
  id: string;
  name: string;
}

/** A user-defined spending category, referenced by the key `custom:<id>`. */
export interface CustomCategory {
  id: string;
  label: string;
  /** hex colour */
  color: string;
}

export type MemberId = string;

/** Reserved owner/filter sentinels that a member id may never take. */
export const RESERVED_IDS = ["all", "joint"] as const;

export interface IncomePortion {
  id: string;
  label: string;
  /** Expected deposit (what hits the account), in `currency`. */
  amount: number;
  /** ISO 4217; empty means the household currency. */
  currency: string;
  taxRate: number;
  /** True when tax was already deducted before the deposit arrived. */
  taxWithheld: boolean;
  window: { startDay: number; endDay: number } | null;
}

export interface Member {
  id: MemberId;
  name: string;
  /** hex colour; drives the person tab, panel, and this member's personal category */
  color: string;
  portions: IncomePortion[];
}

export interface IncomeReceipt {
  id: string;
  /** YYYY-MM */
  month: string;
  memberId: MemberId;
  portionId: string;
  /** Actual received, always in the household currency. */
  amount: number;
  date?: string;
  /** Statement-credit provenance only; income still resolves from `amount`. */
  transactionId?: string;
}

/** Who pays from an account: a member id, or "joint" for shared/unknown. */
export type AccountOwner = MemberId | "joint";

/** The person-tab filter: a member id, or "all". */
export type OwnerFilter = MemberId | "all";

export interface Account {
  id: string;
  /** display label, e.g. "Everyday Visa", "Joint Savings" */
  label: string;
  /** whose spending this account represents for settlement */
  owner: AccountOwner;
  /**
   * case-insensitive substrings matched against the account text detected in a
   * statement (card number fragment, bank name) or the statement file name;
   * imports matching any pattern land on this account
   */
  match: string[];
}

export interface Split {
  /** parts that count as ours */
  mine: number;
  /** total parts the bill was divided into */
  of: number;
}

export interface Transaction {
  id: string;
  /** ISO date YYYY-MM-DD */
  date: string;
  description: string;
  /** positive household-currency value; recognizable FX rows are normalized from their explicit rate */
  amount: number;
  category: CategoryKey;
  account: string;
  note: string;
  source: "imported" | "manual";
  /**
   * The raw bank-row sign: "debit" (money out) or "credit" (money in). Kept as
   * imported; `kind` — not `direction` — decides what counts as spend.
   */
  direction: "debit" | "credit";
  /**
   * What kind of money movement this is. Drives spend/save-rate math via
   * `isSpend` (src/domain/summary.ts). Defaults on migration from `direction`:
   * debit → "expense", credit → "account_credit".
   */
  kind: MovementKind;
  /** For money_lent / repayment_received / gift_or_handout: the other party. */
  counterpartyId?: string;
  split?: Split;
}

export interface FixedCost {
  id: string;
  label: string;
  amount: number;
  category: CategoryKey;
  /** last month this cost applies, "YYYY-MM" inclusive; empty/undefined = ongoing */
  until?: string;
}

/**
 * How a bank's CSV export maps onto transactions. Persisted per header
 * signature in `HouseholdSettings.csvPresets` so a repeat import auto-fills.
 */
export interface CsvMapping {
  hasHeader: boolean;
  dateColumn: number;
  dateOrder: "dmy" | "mdy" | "ymd";
  descriptionColumn: number;
  amountMode: "single" | "debit_credit";
  /** single mode: the one signed/unsigned amount column */
  amountColumn?: number;
  /** single mode: how the sign encodes debit vs credit */
  signConvention?: "negative_is_credit" | "positive_is_credit" | "all_debits";
  /** debit_credit mode: separate columns */
  debitColumn?: number;
  creditColumn?: number;
  /** optional per-row account column; else accountLabel is used for every row */
  accountColumn?: number;
  accountLabel?: string;
}

export interface HouseholdSettings {
  members: Member[];
  /** percent of income the household aims to save each month */
  targetSaveRate: number;
  /** ISO 4217 currency code, e.g. "USD"; empty until onboarding sets it */
  currency: string;
  /** BCP 47 locale for number formatting, e.g. "en-US"; empty = runtime default */
  locale: string;
  /** Household-currency units per one unit of foreign currency. */
  fxRates: Record<string, number>;
  /** saved CSV column mappings, keyed by the file's header signature */
  csvPresets: Record<string, CsvMapping>;
  /** people money is lent to / repaid by / gifted to */
  counterparties: Counterparty[];
  /** user-defined spending categories, referenced by `custom:<id>` keys */
  customCategories: CustomCategory[];
}

/**
 * What Mizan does with a recognized merchant: which category, what movement
 * kind, and (for lending/gifts) which counterparty. Set once by categorizing a
 * merchant; applied to every past and future occurrence.
 */
export interface MerchantRule {
  category: CategoryKey;
  kind: MovementKind;
  counterpartyId?: string;
}

export type MerchantRules = Record<string, MerchantRule>;

export interface AppData {
  schemaVersion: 7;
  transactions: Transaction[];
  merchantRules: MerchantRules;
  accounts: Account[];
  fixedCosts: FixedCost[];
  incomeReceipts: IncomeReceipt[];
  settings: HouseholdSettings;
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36).slice(-5)}`;
}
