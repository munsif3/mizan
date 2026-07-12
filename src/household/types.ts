import type {
  Account,
  Counterparty,
  CsvMapping,
  CustomCategory,
  FixedCost,
  IncomeReceipt,
  Member,
  MerchantRule,
  SharedContribution,
  Transaction,
} from "../domain/types";

export const CLOUD_HOUSEHOLD_SCHEMA_VERSION = 4;

export type HouseholdRole = "owner" | "member";

export interface HouseholdMemberAccess {
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
  members: Member[];
  customCategories: CustomCategory[];
  counterparties: Counterparty[];
  merchantRules: CloudMerchantRule[];
  csvPresets: CloudCsvPreset[];
}

export interface CloudHousehold {
  schemaVersion: 1;
  appData: unknown;
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
  ownerFilter: string;
  categoryFilter: string;
  /** User-specific completion time for each household's weekly money check-in. */
  lastCheckInByHousehold: Record<string, string>;
  updatedAt: string;
}
