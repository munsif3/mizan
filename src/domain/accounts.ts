import { hasFxConversionEvidence } from "./fx";
import { beneficiaryEquals } from "./beneficiaries";
import { isSpendKind } from "./movements";
import type { Account, AccountOwner, Member, SpendBeneficiary, Transaction } from "./types";

const UNASSIGNED_BENEFICIARY: SpendBeneficiary = { type: "unassigned" };

function normalize(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

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

/** Resolve a transaction through its stable account id before trying imported text. */
export function accountForTransaction(txn: Transaction, accounts: Account[]): Account | undefined {
  const linked = txn.accountId ? accounts.find((account) => account.id === txn.accountId) : undefined;
  return linked
    ?? resolveAccount(txn.rawAccount ?? txn.account, accounts)
    ?? resolveAccount(txn.account, accounts);
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

/** Resolve one account's configured beneficiary without guessing for joint/invalid owners. */
export function beneficiaryForAccount(account: Account | undefined, members: Member[]): SpendBeneficiary {
  if (!account || account.beneficiaryDefault === "review") return UNASSIGNED_BENEFICIARY;
  if (account.beneficiaryDefault === "household") return { type: "household" };
  if (account.owner !== "joint" && members.some((member) => member.id === account.owner)) {
    return { type: "member", memberId: account.owner };
  }
  return UNASSIGNED_BENEFICIARY;
}

/** The configured account beneficiary for a transaction, resolved account-id first. */
function accountBeneficiaryForTransaction(
  txn: Transaction,
  accounts: Account[],
  members: Member[],
): SpendBeneficiary {
  return beneficiaryForAccount(accountForTransaction(txn, accounts), members);
}

/** Force one spend row back to its current account-default baseline. */
export function withAccountBeneficiaryDefault(
  txn: Transaction,
  accounts: Account[],
  members: Member[],
): Transaction {
  if (txn.direction === "credit" || !isSpendKind(txn.kind)) {
    if (txn.beneficiary.type === "unassigned" && !txn.beneficiarySource) return txn;
    const next = { ...txn, beneficiary: UNASSIGNED_BENEFICIARY };
    delete next.beneficiarySource;
    return next;
  }
  const beneficiary = accountBeneficiaryForTransaction(txn, accounts, members);
  if (beneficiary.type === "unassigned") {
    if (txn.beneficiary.type === "unassigned" && !txn.beneficiarySource) return txn;
    const next = { ...txn, beneficiary };
    delete next.beneficiarySource;
    return next;
  }
  if (beneficiaryEquals(txn.beneficiary, beneficiary) && txn.beneficiarySource === "account_default") return txn;
  return { ...txn, beneficiary, beneficiarySource: "account_default" };
}

/**
 * Apply account defaults only where provenance says it is safe: previously
 * inferred rows, plus unlocked unresolved rows when filling is requested.
 */
export function applyAccountBeneficiaryDefaults(
  transactions: Transaction[],
  accounts: Account[],
  members: Member[],
  options: { fillUnassigned?: boolean; accountIds?: ReadonlySet<string> } = {},
): Transaction[] {
  const fillUnassigned = options.fillUnassigned !== false;
  return transactions.map((txn) => {
    const account = accountForTransaction(txn, accounts);
    if (options.accountIds && (!account || !options.accountIds.has(account.id))) return txn;
    const inferred = txn.beneficiarySource === "account_default";
    const unresolved = fillUnassigned && txn.beneficiary.type === "unassigned" && !txn.classificationLocked;
    if (!inferred && !unresolved) return txn;
    return withAccountBeneficiaryDefault(txn, accounts, members);
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
  if (hasFxConversionEvidence(txn)) return householdCurrency;
  const account = accountForTransaction(txn, accounts);
  return account?.currency || householdCurrency;
}

/** Who funded this transaction, resolving stable account identity first. */
export function ownerOfTransaction(txn: Transaction, accounts: Account[]): AccountOwner {
  return accountForTransaction(txn, accounts)?.owner ?? "joint";
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
    beneficiaryDefault: "review",
    match: [label],
  }));
}
