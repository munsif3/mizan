import {
  customCategory,
  customCategoryId,
  type CategoryKey,
  type CustomCategory,
  type FixedCategoryKey,
} from "./types";
import type { Member } from "./types";

export interface CategoryInfo {
  label: string;
  color: string;
}

/** The fixed purpose taxonomy shared by every household. */
const FIXED_CATEGORIES: Record<FixedCategoryKey, CategoryInfo> = {
  housing: { label: "Housing", color: "#5b8cff" },
  food: { label: "Groceries", color: "#f2b84b" }, // key kept as "food" for data continuity; represents groceries since the dining split
  utilities: { label: "Bills & Utilities", color: "#7a6ff0" },
  transport: { label: "Transport", color: "#42c7a5" },
  health: { label: "Health", color: "#f2727b" },
  dining: { label: "Dining", color: "#e8743b" },
  lifestyle: { label: "Lifestyle", color: "#b98cff" },
  family_support: { label: "Family", color: "#5fd6e8" },
  investments: { label: "Investments", color: "#67d66f" },
  uncategorized: { label: "Uncategorized", color: "#7b8194" },
};

/** Suggested colours for new members, distinct from each other. */
export const MEMBER_PALETTE = ["#5b8cff", "#ff80b5", "#f2b84b", "#42c7a5", "#b98cff", "#ff786f", "#5fd6e8", "#67d66f"];

/** A colour for a new member: the first palette entry not already in use. */
export function nextMemberColor(members: Member[]): string {
  const used = new Set(members.map((m) => m.color.toLowerCase()));
  return MEMBER_PALETTE.find((color) => !used.has(color.toLowerCase())) ?? MEMBER_PALETTE[members.length % MEMBER_PALETTE.length]!;
}

const FIXED_BEFORE_CUSTOM: FixedCategoryKey[] = ["housing", "food", "utilities", "transport", "health", "dining", "lifestyle"];
const FIXED_AFTER_CUSTOM: FixedCategoryKey[] = ["family_support", "investments", "uncategorized"];

const UNKNOWN_CUSTOM: CategoryInfo = { label: "Custom (deleted)", color: "#7b8194" };

/** Any string that is syntactically a valid category key (member-independent). */
export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === "string" && (Object.hasOwn(FIXED_CATEGORIES, value) || /^custom:.+/.test(value));
}

/**
 * Label + colour for a purpose, resolving `custom:` keys against the household's
 * custom categories. Beneficiaries are rendered separately.
 */
export function categoryInfo(key: CategoryKey, customCategories: CustomCategory[] = []): CategoryInfo {
  const customId = customCategoryId(key);
  if (customId) {
    const custom = customCategories.find((c) => c.id === customId);
    return custom ? { label: custom.label, color: custom.color } : UNKNOWN_CUSTOM;
  }
  return FIXED_CATEGORIES[key as FixedCategoryKey] ?? FIXED_CATEGORIES.uncategorized;
}

export interface CategoryOption extends CategoryInfo {
  key: CategoryKey;
}

/**
 * All selectable purpose categories in display order, with custom purposes
 * between the common fixed groups.
 */
export function categoryOptions(customCategories: CustomCategory[] = []): CategoryOption[] {
  return [
    ...FIXED_BEFORE_CUSTOM.map((key) => ({ key, ...FIXED_CATEGORIES[key] })),
    ...customCategories.map((c) => ({ key: customCategory(c.id), label: c.label, color: c.color })),
    ...FIXED_AFTER_CUSTOM.map((key) => ({ key, ...FIXED_CATEGORIES[key] })),
  ];
}

/** Selectable spending categories (everything except "uncategorized"). */
export function spendingCategoryOptions(customCategories: CustomCategory[] = []): CategoryOption[] {
  return categoryOptions(customCategories).filter((option) => option.key !== "uncategorized");
}
