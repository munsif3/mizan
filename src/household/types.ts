import type {
  Account,
  Counterparty,
  CsvMapping,
  CustomCategory,
  EfficiencyPlan,
  FixedCost,
  IncomeReceipt,
  Member,
  MerchantRule,
  SharedContribution,
  Transaction,
} from "../domain/types";

export const CLOUD_HOUSEHOLD_SCHEMA_VERSION = 8;
export const CLOUD_SNAPSHOT_MANIFEST_VERSION = 1;

type HouseholdRole = "owner" | "member";

interface HouseholdMemberAccess {
  role: HouseholdRole;
  displayName: string;
  email: string;
  joinedAt: string;
}

export interface HouseholdMeta {
  id: string;
  name: string;
  ownerUid: string;
  membersByUid: Record<string, HouseholdMemberAccess>;
  inviteCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudSettings {
  schemaVersion: typeof CLOUD_HOUSEHOLD_SCHEMA_VERSION;
  targetSaveRate: number;
  currency: string;
  locale: string;
  fxRates: Record<string, number>;
  updatedAt: string;
  updatedBy: string;
}

export interface CloudMerchantRule {
  key: string;
  rule: MerchantRule;
  updatedAt: string;
  updatedBy: string;
}

export interface CloudCsvPreset {
  signature: string;
  mapping: CsvMapping;
  updatedAt: string;
  updatedBy: string;
}

export interface CloudCollections {
  settings: CloudSettings | null;
  transactions: Transaction[];
  sharedContributions: SharedContribution[];
  accounts: Account[];
  fixedCosts: FixedCost[];
  incomeReceipts: IncomeReceipt[];
  efficiencyPlans: EfficiencyPlan[];
  members: Member[];
  customCategories: CustomCategory[];
  counterparties: Counterparty[];
  merchantRules: CloudMerchantRule[];
  csvPresets: CloudCsvPreset[];
}

export interface CloudSnapshotManifest {
  schemaVersion: typeof CLOUD_SNAPSHOT_MANIFEST_VERSION;
  activeRevision: string;
  /** Unique compare-and-swap identity; timestamps are informational only. */
  versionToken: string;
  updatedAt: string;
  updatedBy: string;
}

export interface UserHouseholdLink {
  householdId: string;
  name: string;
  role: HouseholdRole;
  joinedAt: string;
  updatedAt: string;
}

export type ThemePreference = "light" | "dark";

export interface UserProfile {
  activeHouseholdId: string;
  privacy: boolean;
  theme?: ThemePreference;
  lastView: string;
  lastMonth: string;
  categoryFilter: string;
  beneficiaryFilter?: string;
  payerFilter?: string;
  /** User-specific completion time for each household's weekly money check-in. */
  lastCheckInByHousehold: Record<string, string>;
  updatedAt: string;
}
