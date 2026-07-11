import {
  customCategory,
  customCategoryId,
  personalCategory,
  personalMemberId,
  type CategoryKey,
  type CustomCategory,
  type FixedCategoryKey,
  type Member,
} from "./types";

export interface CategoryInfo {
  label: string;
  color: string;
}

/** The fixed household categories (everything except the per-member personal ones). */
export const FIXED_CATEGORIES: Record<FixedCategoryKey, CategoryInfo> = {
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

const UNKNOWN_PERSONAL: CategoryInfo = { label: "Personal (former member)", color: "#7b8194" };

/** Suggested colours for new members, distinct from each other. */
export const MEMBER_PALETTE = ["#5b8cff", "#ff80b5", "#f2b84b", "#42c7a5", "#b98cff", "#ff786f", "#5fd6e8", "#67d66f"];

/** A colour for a new member: the first palette entry not already in use. */
export function nextMemberColor(members: Member[]): string {
  const used = new Set(members.map((m) => m.color.toLowerCase()));
  return MEMBER_PALETTE.find((color) => !used.has(color.toLowerCase())) ?? MEMBER_PALETTE[members.length % MEMBER_PALETTE.length]!;
}

// Personal categories sit between "lifestyle" and "family_support" in the picker.
const FIXED_BEFORE_PERSONAL: FixedCategoryKey[] = ["housing", "food", "utilities", "transport", "health", "dining", "lifestyle"];
const FIXED_AFTER_PERSONAL: FixedCategoryKey[] = ["family_support", "investments", "uncategorized"];

const UNKNOWN_CUSTOM: CategoryInfo = { label: "Custom (deleted)", color: "#7b8194" };

/** Any string that is syntactically a valid category key (member-independent). */
export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === "string" && (value in FIXED_CATEGORIES || /^personal:.+/.test(value) || /^custom:.+/.test(value));
}

/**
 * Label + colour for a category, resolving `personal:` keys against the members
 * and `custom:` keys against the household's custom categories.
 */
export function categoryInfo(key: CategoryKey, members: Member[], customCategories: CustomCategory[] = []): CategoryInfo {
  const memberId = personalMemberId(key);
  if (memberId) {
    const member = members.find((m) => m.id === memberId);
    return member ? { label: member.name, color: member.color } : UNKNOWN_PERSONAL;
  }
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
 * All selectable categories in display order: fixed buckets around the personal
 * ones, then any custom categories, then the trailing fixed buckets.
 */
export function categoryOptions(members: Member[], customCategories: CustomCategory[] = []): CategoryOption[] {
  return [
    ...FIXED_BEFORE_PERSONAL.map((key) => ({ key, ...FIXED_CATEGORIES[key] })),
    ...members.map((m) => ({ key: personalCategory(m.id), label: m.name, color: m.color })),
    ...customCategories.map((c) => ({ key: customCategory(c.id), label: c.label, color: c.color })),
    ...FIXED_AFTER_PERSONAL.map((key) => ({ key, ...FIXED_CATEGORIES[key] })),
  ];
}

/** Selectable spending categories (everything except "uncategorized"). */
export function spendingCategoryOptions(members: Member[], customCategories: CustomCategory[] = []): CategoryOption[] {
  return categoryOptions(members, customCategories).filter((option) => option.key !== "uncategorized");
}
