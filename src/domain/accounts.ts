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
  return resolveAccount(raw, accounts)?.label ?? raw;
}

/** Resolve raw statement text to the full registered-account record. */
export function resolveAccount(raw: string, accounts: Account[]): Account | undefined {
  const text = normalize(raw);
  if (!text) return undefined;
  const candidates: { account: Account; length: number }[] = [];
  for (const account of accounts) {
    if (!normalize(account.label)) continue;
    if (normalize(account.label) === text) candidates.push({ account, length: text.length });
    for (const pattern of account.match) {
      const candidate = normalize(pattern);
      if (candidate && text.includes(candidate)) candidates.push({ account, length: candidate.length });
    }
  }
  if (!candidates.length) return undefined;
  candidates.sort((a, b) => b.length - a.length || a.account.label.localeCompare(b.account.label));
  return candidates[0]!.account;
}

/**
 * Map transactions onto registered accounts while retaining the statement's
 * original account text. A stable account id makes label edits follow through
 * to existing rows; rawAccount lets newly added match rules repair older rows.
 */
export function applyAccounts(transactions: Transaction[], accounts: Account[]): Transaction[] {
  return transactions.map((txn) => {
    const rawAccount = txn.rawAccount ?? txn.account;
    const linked = txn.accountId ? accounts.find((account) => account.id === txn.accountId && normalize(account.label)) : undefined;
    const account = linked ?? resolveAccount(rawAccount, accounts);
    if (!account) {
      if (!txn.accountId && !txn.rawAccount) return txn;
      const next = { ...txn, account: rawAccount, rawAccount };
      delete next.accountId;
      return next;
    }
    if (txn.account === account.label && txn.accountId === account.id && txn.rawAccount === rawAccount) return txn;
    return { ...txn, account: account.label, accountId: account.id, rawAccount };
  });
}

/** Explicitly bind a row to a registered account without losing its import provenance. */
export function assignAccount(txn: Transaction, account: Account): Transaction {
  return {
    ...txn,
    account: account.label,
    accountId: account.id,
    rawAccount: txn.rawAccount ?? txn.account,
  };
}

/** Currency used to display a row without changing its household-ledger value. */
export function transactionDisplayCurrency(txn: Transaction, accounts: Account[], householdCurrency: string): string {
  // Explicit FX normalization replaces amount with the household-currency value.
  if (txn.note.startsWith("FX conversion:")) return householdCurrency;
  const account = (txn.accountId ? accounts.find((item) => item.id === txn.accountId) : undefined)
    ?? accounts.find((item) => normalize(item.label) === normalize(txn.account));
  return account?.currency || householdCurrency;
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
export function seedAccounts(transactions: Transaction[], members: Member[], currency = ""): Account[] {
  const labels = [...new Set(transactions.map((txn) => txn.account).filter(Boolean))].sort();
  return labels.map((label, index) => ({
    id: `acc_seed_${index}`,
    label,
    currency,
    owner: guessOwner(label, members),
    match: [label],
  }));
}
