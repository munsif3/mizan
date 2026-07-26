export type SettingsTab =
  | "household"
  | "budget"
  | "assets"
  | "categories"
  | "accounts"
  | "sync";

type SettingsSection =
  | "members"
  | "income"
  | "currency"
  | "exchange-rates"
  | "commitments"
  | "assets"
  | "categories"
  | "people"
  | "accounts"
  | "rules"
  | "access"
  | "backup";

export interface SettingsTarget {
  tab: SettingsTab;
  section?: SettingsSection;
  itemId?: string;
}

export const DEFAULT_SETTINGS_TARGET: SettingsTarget = { tab: "household", section: "members" };
