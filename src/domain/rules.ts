import type { CategoryKey, MerchantRules, Transaction } from "./types";

/** Normalize a merchant/description string for rule matching. */
export function cleanMerchant(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Deterministic rule lookup: an exact match on the cleaned description wins;
 * otherwise the longest rule that appears inside the description wins,
 * with alphabetical order breaking length ties. Returns null when nothing matches.
 */
export function matchRule(description: string, rules: MerchantRules): CategoryKey | null {
  const cleaned = cleanMerchant(description);
  if (!cleaned) return null;
  const exact = rules[cleaned];
  if (exact) return exact;

  let best: string | null = null;
  for (const key of Object.keys(rules)) {
    const candidate = cleanMerchant(key);
    if (!candidate || !cleaned.includes(candidate)) continue;
    if (!best || candidate.length > best.length || (candidate.length === best.length && candidate < best)) {
      best = candidate;
    }
  }
  return best ? (rules[best] ?? null) : null;
}

/**
 * Re-apply rules across transactions. Rules are the source of truth for a merchant's
 * category: categorizing a merchant once recategorizes every occurrence, past and future.
 */
export function applyRules(transactions: Transaction[], rules: MerchantRules): Transaction[] {
  if (!Object.keys(rules).length) return transactions;
  return transactions.map((txn) => {
    const category = matchRule(txn.description, rules);
    return category && category !== txn.category ? { ...txn, category } : txn;
  });
}

/** Add/replace a rule (stored under the cleaned merchant key). */
export function withRule(rules: MerchantRules, merchant: string, category: CategoryKey): MerchantRules {
  return { ...rules, [cleanMerchant(merchant)]: category };
}
