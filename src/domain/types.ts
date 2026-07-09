/** The fixed part of the taxonomy — shared by every household. */
export type FixedCategoryKey =
  | "housing"
  | "food"
  | "transport"
  | "lifestyle"
  | "family_support"
  | "investments"
  | "uncategorized";

/** One personal-spend bucket per household member: `personal:<memberId>`. */
export type PersonalCategoryKey = `personal:${string}`;

export type CategoryKey = FixedCategoryKey | PersonalCategoryKey;

/** Build the personal-category key for a member. */
export function personalCategory(id: MemberId): PersonalCategoryKey {
  return `personal:${id}`;
}

/** The member id inside a `personal:<id>` key, or null for a fixed category. */
export function personalMemberId(key: string): MemberId | null {
  return key.startsWith("personal:") ? key.slice("personal:".length) : null;
}

export type MemberId = string;

/** Reserved owner/filter sentinels that a member id may never take. */
export const RESERVED_IDS = ["all", "joint"] as const;

export interface Member {
  id: MemberId;
  name: string;
  /** hex colour; drives the person tab, panel, and this member's personal category */
  color: string;
  /** monthly income in the household currency */
  income: number;
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
  /** positive amount in the household currency, as it appears on the statement */
  amount: number;
  category: CategoryKey;
  account: string;
  note: string;
  source: "imported" | "manual";
  /**
   * "debit" (spend, the only kind pre-v4 data has) or "credit" (deposit,
   * salary, transfer in). Credits are stored for a complete account history
   * but excluded from all spend/save-rate math — see src/domain/summary.ts.
   */
  direction: "debit" | "credit";
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
  /** saved CSV column mappings, keyed by the file's header signature */
  csvPresets: Record<string, CsvMapping>;
}

export type MerchantRules = Record<string, CategoryKey>;

export interface AppData {
  schemaVersion: 5;
  transactions: Transaction[];
  merchantRules: MerchantRules;
  accounts: Account[];
  fixedCosts: FixedCost[];
  settings: HouseholdSettings;
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36).slice(-5)}`;
}
