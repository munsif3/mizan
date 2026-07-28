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
 * Deterministic key selection: the longest key appearing inside the cleaned
 * description wins, with alphabetical order breaking length ties. Returns null
 * when nothing matches.
 *
 * Shared by household merchant rules and the starter seed table
 * (`merchantSeeds.ts`) so Mizan has exactly one matching model. Statement text
 * carries branch and location suffixes — "KEELLS SUPER WATTALA", "THE FAB
 * COLOMBO 03" — so substring matching is the load-bearing behavior, and
 * longest-wins is what lets a specific key ("UBER EATS") beat a general one
 * ("UBER") without either needing to know about the other.
 */
export function matchingKey(description: string, keys: Iterable<string>): string | null {
  const cleaned = cleanMerchant(description);
  if (!cleaned) return null;

  let best: { stored: string; canonical: string } | null = null;
  for (const key of keys) {
    const candidate = cleanMerchant(key);
    if (!candidate || !cleaned.includes(candidate)) continue;
    if (!best || candidate.length > best.canonical.length
      || (candidate.length === best.canonical.length && candidate < best.canonical)) {
      best = { stored: key, canonical: candidate };
    }
  }
  return best?.stored ?? null;
}

/**
 * Deterministic rule lookup: an exact match on the cleaned description wins;
 * otherwise `matchingKey` selects the longest matching rule.
 */
export function matchingRuleKey(description: string, rules: MerchantRules): string | null {
  const cleaned = cleanMerchant(description);
  if (!cleaned) return null;
  if (rules[cleaned]) return cleaned;
  return matchingKey(cleaned, Object.keys(rules));
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
    delete next.commitmentId;
    delete next.investmentAmount;
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
    if (rule.kind === "investment_transfer" && rule.holdingId) next.holdingId = rule.holdingId;
    else delete next.holdingId;
    if (
      next.category === txn.category
      && beneficiaryEquals(next.beneficiary, txn.beneficiary)
      && next.beneficiarySource === txn.beneficiarySource
      && next.kind === txn.kind
      && (next.counterpartyId ?? undefined) === (txn.counterpartyId ?? undefined)
      && (next.holdingId ?? undefined) === (txn.holdingId ?? undefined)
      && !txn.commitmentId
      && !txn.investmentAmount
    ) return txn;
    return next;
  });
}

/** Add/replace a rule (stored under the cleaned merchant key). */
export function withRule(rules: MerchantRules, merchant: string, rule: MerchantRule): MerchantRules {
  return { ...rules, [cleanMerchant(merchant)]: rule };
}
