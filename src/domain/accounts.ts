import { cleanMerchant as normalize } from "./rules";
import type { Account, AccountOwner, Member, Transaction } from "./types";

/**
 * Resolve raw statement text (detected card/account number, or a file name)
 * to a registered account's label. Deterministic: the account with the longest
 * matching pattern wins (an exact label match counts as a full-length match);
 * ties break by account label alphabetically. Unmatched text passes through
 * unchanged.
 */
export function resolveAccountLabel(raw: string, accounts: Account[]): string {
  const text = normalize(raw);
  if (!text) return raw;
  const candidates: { label: string; length: number }[] = [];
  for (const account of accounts) {
    if (normalize(account.label) === text) candidates.push({ label: account.label, length: text.length });
    for (const pattern of account.match) {
      const candidate = normalize(pattern);
      if (candidate && text.includes(candidate)) candidates.push({ label: account.label, length: candidate.length });
    }
  }
  if (!candidates.length) return raw;
  candidates.sort((a, b) => b.length - a.length || a.label.localeCompare(b.label));
  return candidates[0]!.label;
}

/** Map imported transactions' raw account text onto registered account labels. */
export function applyAccounts(transactions: Transaction[], accounts: Account[]): Transaction[] {
  if (!accounts.length) return transactions;
  return transactions.map((txn) => {
    const label = resolveAccountLabel(txn.account, accounts);
    return label === txn.account ? txn : { ...txn, account: label };
  });
}

/** Who pays from this account. Unknown accounts are treated as joint. */
export function ownerOf(accountLabel: string, accounts: Account[]): AccountOwner {
  const resolved = resolveAccountLabel(accountLabel, accounts);
  const account = accounts.find((item) => normalize(item.label) === normalize(resolved));
  return account ? account.owner : "joint";
}

/**
 * One-time owner guess when seeding the registry from existing data: the first
 * member whose name appears in the account label, else joint. Members are
 * checked in list order so the guess is deterministic.
 */
export function guessOwner(label: string, members: Member[]): AccountOwner {
  const text = normalize(label);
  for (const member of members) {
    const name = normalize(member.name);
    if (name && text.includes(name)) return member.id;
  }
  return "joint";
}

/** Build a starter registry from the distinct account labels already in the data. */
export function seedAccounts(transactions: Transaction[], members: Member[]): Account[] {
  const labels = [...new Set(transactions.map((txn) => txn.account).filter(Boolean))].sort();
  return labels.map((label, index) => ({
    id: `acc_seed_${index}`,
    label,
    owner: guessOwner(label, members),
    match: [label],
  }));
}
