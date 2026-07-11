import type { MerchantRule, MerchantRules, Transaction } from "./types";
import { kindAllowedFor } from "./movements";

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
export function matchingRuleKey(description: string, rules: MerchantRules): string | null {
  const cleaned = cleanMerchant(description);
  if (!cleaned) return null;
  if (rules[cleaned]) return cleaned;

  let best: string | null = null;
  for (const key of Object.keys(rules)) {
    const candidate = cleanMerchant(key);
    if (!candidate || !cleaned.includes(candidate)) continue;
    if (!best || candidate.length > best.length || (candidate.length === best.length && candidate < best)) {
      best = candidate;
    }
  }
  return best;
}

/** The rule selected by `matchingRuleKey`, or null when nothing matches. */
export function matchRule(description: string, rules: MerchantRules): MerchantRule | null {
  const key = matchingRuleKey(description, rules);
  return key ? (rules[key] ?? null) : null;
}

/** True when a matched rule would change any of a transaction's classified fields. */
function ruleChanges(txn: Transaction, rule: MerchantRule): boolean {
  return (
    rule.category !== txn.category || rule.kind !== txn.kind || (rule.counterpartyId ?? undefined) !== (txn.counterpartyId ?? undefined)
  );
}

/**
 * Re-apply rules across transactions. Rules are the source of truth for a merchant's
 * classification: categorizing a merchant once recategorizes every occurrence — its
 * category, movement kind, and counterparty — past and future.
 */
export function applyRules(transactions: Transaction[], rules: MerchantRules): Transaction[] {
  if (!Object.keys(rules).length) return transactions;
  return transactions.map((txn) => {
    const rule = matchRule(txn.description, rules);
    if (!rule || !kindAllowedFor(rule.kind, txn.direction) || !ruleChanges(txn, rule)) return txn;
    const next: Transaction = { ...txn, category: rule.category, kind: rule.kind };
    if (rule.counterpartyId) next.counterpartyId = rule.counterpartyId;
    else delete next.counterpartyId;
    return next;
  });
}

/** Add/replace a rule (stored under the cleaned merchant key). */
export function withRule(rules: MerchantRules, merchant: string, rule: MerchantRule): MerchantRules {
  return { ...rules, [cleanMerchant(merchant)]: rule };
}
