import { withAccountBeneficiaryDefault } from "./accounts";
import { beneficiaryEquals } from "./beneficiaries";
import type { Account, Member, MerchantRule, MerchantRules, Transaction } from "./types";
import { isSpendKind, kindAllowedFor } from "./movements";
import { memberParticipatesOn } from "./memberLifecycle";

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

  let best: { stored: string; canonical: string } | null = null;
  for (const key of Object.keys(rules)) {
    const candidate = cleanMerchant(key);
    if (!candidate || !cleaned.includes(candidate)) continue;
    if (!best || candidate.length > best.canonical.length
      || (candidate.length === best.canonical.length && candidate < best.canonical)) {
      best = { stored: key, canonical: candidate };
    }
  }
  return best?.stored ?? null;
}

/** The rule selected by `matchingRuleKey`, or null when nothing matches. */
export function matchRule(description: string, rules: MerchantRules): MerchantRule | null {
  const key = matchingRuleKey(description, rules);
  return key ? (rules[key] ?? null) : null;
}

/**
 * Re-apply a merchant's purpose, beneficiary, movement kind, and counterparty
 * across unlocked past and future rows. Ledger-only overrides remain untouched.
 */
export function applyRules(
  transactions: Transaction[],
  rules: MerchantRules,
  accounts: Account[] = [],
  members: Member[] = [],
): Transaction[] {
  if (!Object.keys(rules).length) return transactions;
  return transactions.map((txn) => {
    if (txn.classificationLocked) return txn;
    const rule = matchRule(txn.description, rules);
    if (!rule || !kindAllowedFor(rule.kind, txn.direction)) return txn;
    let next: Transaction = { ...txn, category: rule.category, kind: rule.kind };
    if (rule.beneficiary.type === "account_default") {
      next = withAccountBeneficiaryDefault(next, accounts, members);
    } else {
      const memberId = rule.beneficiary.type === "member" ? rule.beneficiary.memberId : "";
      next.beneficiary = memberId
        && !members.some((member) => member.id === memberId && memberParticipatesOn(member, txn.date))
        ? { type: "unassigned" }
        : rule.beneficiary;
      delete next.beneficiarySource;
    }
    if (txn.direction === "credit" || !isSpendKind(rule.kind)) {
      next.beneficiary = { type: "unassigned" };
      delete next.beneficiarySource;
    }
    if (rule.counterpartyId) next.counterpartyId = rule.counterpartyId;
    else delete next.counterpartyId;
    if (
      next.category === txn.category
      && beneficiaryEquals(next.beneficiary, txn.beneficiary)
      && next.beneficiarySource === txn.beneficiarySource
      && next.kind === txn.kind
      && (next.counterpartyId ?? undefined) === (txn.counterpartyId ?? undefined)
    ) return txn;
    return next;
  });
}

/** Add/replace a rule (stored under the cleaned merchant key). */
export function withRule(rules: MerchantRules, merchant: string, rule: MerchantRule): MerchantRules {
  return { ...rules, [cleanMerchant(merchant)]: rule };
}
