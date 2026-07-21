import {
  applyAccountBeneficiaryDefaults,
  applyAccounts,
  applySoloBeneficiaryDefaults,
  assignAccount,
  withAccountBeneficiaryDefault,
} from "./accounts";
import { contributionReferencesTransaction, pruneSharedContributions } from "./contributions";
import { closeInvalidEfficiencyPlans } from "./efficiency";
import { pruneReceipts, unlinkTransaction, upsertReceipt, upsertReceiptGroup } from "./income";
import { isSpendKind } from "./movements";
import { applyRules, cleanMerchant, matchingRuleKey, withRule } from "./rules";
import { needsClassificationReview } from "./summary";
import {
  defaultKind,
  type Account,
  type AppData,
  type CategoryKey,
  type Counterparty,
  type CustomCategory,
  type IncomeReceipt,
  type MerchantRule,
  type Member,
  type MovementKind,
  type SharedContribution,
  type SpendBeneficiary,
  type Split,
  type Transaction,
} from "./types";

const UNASSIGNED_BENEFICIARY: SpendBeneficiary = { type: "unassigned" };

export function transitionTransactionClassification(
  data: AppData,
  id: string,
  patch: Partial<Pick<Transaction, "category" | "beneficiary" | "kind" | "counterpartyId">>,
): { data: AppData; contributionLinkRemoved: boolean } {
  const current = data.transactions.find((item) => item.id === id);
  if (!current) return { data, contributionLinkRemoved: false };
  let next: Transaction = { ...current, ...patch, classificationLocked: true };
  if (patch.beneficiary) delete next.beneficiarySource;
  if (patch.kind && !isSpendKind(patch.kind)) {
    next.beneficiary = UNASSIGNED_BENEFICIARY;
    delete next.beneficiarySource;
  } else if (patch.kind && next.beneficiary.type === "unassigned") {
    next = withAccountBeneficiaryDefault(next, data.accounts, data.settings.members);
  }
  if (!next.counterpartyId) delete next.counterpartyId;
  const transactions = data.transactions.map((item) => (item.id === id ? next : item));
  const contributionLinkRemoved = data.sharedContributions.some((item) =>
    contributionReferencesTransaction(item, id, data.transactions));
  const sharedContributions = pruneSharedContributions(
    data.sharedContributions.filter((item) => !contributionReferencesTransaction(item, id, data.transactions)),
    transactions,
    data.accounts,
    data.settings.members,
  );
  return { data: { ...data, transactions, sharedContributions }, contributionLinkRemoved };
}

export function transitionRememberMerchant(data: AppData, id: string): AppData {
  const transaction = data.transactions.find((item) => item.id === id);
  if (!transaction) return data;
  const rule: MerchantRule = {
    category: transaction.category,
    beneficiary: transaction.beneficiarySource === "account_default"
      ? { type: "account_default" }
      : transaction.beneficiary,
    kind: transaction.kind,
    ...(transaction.counterpartyId ? { counterpartyId: transaction.counterpartyId } : {}),
  };
  const merchantRules = withRule(data.merchantRules, transaction.description, rule);
  const unlocked = data.transactions.map((item) => item.id === id
    ? { ...item, classificationLocked: undefined }
    : item);
  const transactions = applyRules(unlocked, merchantRules, data.accounts, data.settings.members);
  return {
    ...data,
    merchantRules,
    transactions,
    sharedContributions: pruneSharedContributions(
      data.sharedContributions,
      transactions,
      data.accounts,
      data.settings.members,
    ),
  };
}

export function transitionTransactionAccount(data: AppData, id: string, account: Account): AppData {
  const transactions = data.transactions.map((transaction) => {
    if (transaction.id !== id) return transaction;
    return applyAccountBeneficiaryDefaults(
      [assignAccount(transaction, account)],
      data.accounts,
      data.settings.members,
    )[0]!;
  });
  return {
    ...data,
    transactions,
    sharedContributions: pruneSharedContributions(
      data.sharedContributions.filter((item) => !contributionReferencesTransaction(item, id, data.transactions)),
      transactions,
      data.accounts,
      data.settings.members,
    ),
  };
}

export function transitionAccounts(data: AppData, accounts: Account[]): AppData {
  const linked = applyAccounts(data.transactions, accounts);
  const defaulted = applyAccountBeneficiaryDefaults(linked, accounts, data.settings.members);
  const transactions = applyRules(defaulted, data.merchantRules, accounts, data.settings.members);
  return {
    ...data,
    accounts,
    transactions,
    sharedContributions: pruneSharedContributions(data.sharedContributions, transactions, accounts, data.settings.members),
  };
}

export function transitionCategorizeMerchant(data: AppData, merchant: string, rule: MerchantRule): AppData {
  const merchantRules = withRule(data.merchantRules, merchant, rule);
  const merchantKey = cleanMerchant(merchant);
  const reviewRowsUnlocked = data.transactions.map((transaction) =>
    transaction.classificationLocked
      && cleanMerchant(transaction.description) === merchantKey
      && needsClassificationReview(transaction)
      ? { ...transaction, classificationLocked: undefined }
      : transaction,
  );
  const transactions = applyRules(reviewRowsUnlocked, merchantRules, data.accounts, data.settings.members);
  return {
    ...data,
    merchantRules,
    transactions,
    sharedContributions: pruneSharedContributions(
      data.sharedContributions,
      transactions,
      data.accounts,
      data.settings.members,
    ),
  };
}

export function transitionMembers(
  data: AppData,
  members: Member[],
  changedAt: string,
): { data: AppData; removedMemberIds: string[] } {
  const removedMemberIds = data.settings.members
    .filter((member) => !members.some((next) => next.id === member.id))
    .map((member) => member.id);
  if (!removedMemberIds.length) {
    // Adding/editing members never re-defaults existing rows, except that a
    // household now down to (or still at) one member backfills the sole
    // beneficiary; a no-op above one member.
    const transactions = applySoloBeneficiaryDefaults(data.transactions, data.accounts, members);
    return {
      removedMemberIds,
      data: {
        ...data,
        transactions,
        sharedContributions: pruneSharedContributions(data.sharedContributions, transactions, data.accounts, members),
        incomeReceipts: pruneReceipts(data.incomeReceipts, members),
        settings: { ...data.settings, members },
      },
    };
  }

  const hasRemovedBeneficiary = (beneficiary: MerchantRule["beneficiary"]) =>
    beneficiary.type === "member" && removedMemberIds.includes(beneficiary.memberId);
  const transactions = data.transactions.map((transaction) =>
    hasRemovedBeneficiary(transaction.beneficiary)
      ? {
          ...transaction,
          beneficiary: UNASSIGNED_BENEFICIARY,
          beneficiarySource: undefined,
          ...(transaction.beneficiarySource === "account_default" ? {} : { classificationLocked: true }),
        }
      : transaction,
  );
  const fixedCosts = data.fixedCosts.map((cost) =>
    hasRemovedBeneficiary(cost.beneficiary) ? { ...cost, beneficiary: UNASSIGNED_BENEFICIARY } : cost,
  );
  const merchantRules = Object.fromEntries(
    Object.entries(data.merchantRules).map(([key, rule]) => [
      key,
      hasRemovedBeneficiary(rule.beneficiary) ? { ...rule, beneficiary: UNASSIGNED_BENEFICIARY } : rule,
    ]),
  );
  const accounts = data.accounts.map((account) =>
    removedMemberIds.includes(account.owner) ? { ...account, owner: "joint" } : account,
  );
  const defaultedTransactions = applySoloBeneficiaryDefaults(
    applyAccountBeneficiaryDefaults(transactions, accounts, members, { fillUnassigned: false }),
    accounts,
    members,
  );
  return {
    removedMemberIds,
    data: {
      ...data,
      transactions: defaultedTransactions,
      fixedCosts,
      merchantRules,
      accounts,
      efficiencyPlans: closeInvalidEfficiencyPlans(
        data.efficiencyPlans,
        new Set(members.map((member) => member.id)),
        new Set(data.settings.customCategories.map((category) => `custom:${category.id}`)),
        changedAt,
      ),
      sharedContributions: pruneSharedContributions(
        data.sharedContributions,
        defaultedTransactions,
        accounts,
        members,
      ),
      incomeReceipts: pruneReceipts(data.incomeReceipts, members),
      settings: { ...data.settings, members },
    },
  };
}

export function transitionIncomeReceipts(data: AppData, receipts: IncomeReceipt[]): AppData {
  const transactionId = receipts[0]?.transactionId;
  const editsExistingGroup = transactionId
    ? data.incomeReceipts.filter((receipt) => receipt.transactionId === transactionId).length > 1
    : false;
  return {
    ...data,
    incomeReceipts: transactionId && (receipts.length > 1 || editsExistingGroup)
      ? upsertReceiptGroup(data.incomeReceipts, receipts)
      : upsertReceipt(data.incomeReceipts, receipts[0]!),
  };
}

function transitionSplit(data: AppData, id: string, split?: Split): AppData {
  const transactions = data.transactions.map((transaction) => {
    if (transaction.id !== id) return transaction;
    if (split) return { ...transaction, split };
    const { split: _removed, ...rest } = transaction;
    return rest;
  });
  return {
    ...data,
    transactions,
    sharedContributions: pruneSharedContributions(
      data.sharedContributions.filter((item) => !contributionReferencesTransaction(item, id, data.transactions)),
      transactions,
      data.accounts,
      data.settings.members,
    ),
  };
}

export function transitionSaveSplit(data: AppData, id: string, split: Split): AppData {
  return transitionSplit(data, id, split);
}

export function transitionClearSplit(data: AppData, id: string): AppData {
  return transitionSplit(data, id);
}

export function transitionRemoveTransaction(
  data: AppData,
  id: string,
): { data: AppData; contributionLinkRemoved: boolean } {
  const contributionLinkRemoved = data.sharedContributions.some((item) =>
    contributionReferencesTransaction(item, id, data.transactions));
  return {
    contributionLinkRemoved,
    data: {
      ...data,
      transactions: data.transactions.filter((transaction) => transaction.id !== id),
      sharedContributions: data.sharedContributions.filter((item) =>
        !contributionReferencesTransaction(item, id, data.transactions)),
      incomeReceipts: unlinkTransaction(data.incomeReceipts, id),
    },
  };
}

export function transitionDeleteRule(data: AppData, merchant: string): AppData {
  const merchantRules = { ...data.merchantRules };
  delete merchantRules[merchant];
  const reset = data.transactions.map((transaction) => {
    if (transaction.classificationLocked || matchingRuleKey(transaction.description, data.merchantRules) !== merchant) {
      return transaction;
    }
    let next: Transaction = {
      ...transaction,
      category: "uncategorized",
      kind: defaultKind(transaction.direction),
    };
    delete next.counterpartyId;
    next = withAccountBeneficiaryDefault(next, data.accounts, data.settings.members);
    return next;
  });
  const transactions = applyRules(reset, merchantRules, data.accounts, data.settings.members);
  return {
    ...data,
    merchantRules,
    transactions,
    sharedContributions: pruneSharedContributions(
      data.sharedContributions,
      transactions,
      data.accounts,
      data.settings.members,
    ),
  };
}

export function transitionResetClassification(data: AppData, id: string): AppData {
  const transactions = data.transactions.map((transaction) => {
    if (transaction.id !== id) return transaction;
    let next: Transaction = {
      ...transaction,
      category: "uncategorized",
      kind: defaultKind(transaction.direction),
      classificationLocked: true,
    };
    delete next.counterpartyId;
    next = withAccountBeneficiaryDefault(next, data.accounts, data.settings.members);
    return next;
  });
  return {
    ...data,
    transactions,
    sharedContributions: pruneSharedContributions(
      data.sharedContributions,
      transactions,
      data.accounts,
      data.settings.members,
    ),
  };
}

export function transitionCounterparties(data: AppData, counterparties: Counterparty[]): AppData {
  const ids = new Set(counterparties.map((counterparty) => counterparty.id));
  const transactions = data.transactions.map((transaction) =>
    transaction.counterpartyId && !ids.has(transaction.counterpartyId)
      ? { ...transaction, counterpartyId: undefined }
      : transaction,
  );
  const merchantRules = Object.fromEntries(
    Object.entries(data.merchantRules).map(([key, rule]) =>
      rule.counterpartyId && !ids.has(rule.counterpartyId)
        ? [key, { category: rule.category, beneficiary: rule.beneficiary, kind: rule.kind }]
        : [key, rule],
    ),
  );
  return { ...data, transactions, merchantRules, settings: { ...data.settings, counterparties } };
}

export function transitionCustomCategories(
  data: AppData,
  customCategories: CustomCategory[],
  changedAt: string,
): AppData {
  const retainedCategoryKeys = new Set(customCategories.map((category) => `custom:${category.id}`));
  const reassign = (category: CategoryKey): CategoryKey =>
    category.startsWith("custom:") && !retainedCategoryKeys.has(category) ? "uncategorized" : category;
  const transactions = data.transactions.map((transaction) =>
    transaction.category === reassign(transaction.category)
      ? transaction
      : { ...transaction, category: reassign(transaction.category) },
  );
  const fixedCosts = data.fixedCosts.map((cost) =>
    cost.category === reassign(cost.category) ? cost : { ...cost, category: reassign(cost.category) },
  );
  const merchantRules = Object.fromEntries(
    Object.entries(data.merchantRules)
      .map(([key, rule]) => [key, { ...rule, category: reassign(rule.category) }] as const)
      .filter(([, rule]) => rule.category !== "uncategorized"),
  );
  return {
    ...data,
    transactions,
    fixedCosts,
    merchantRules,
    sharedContributions: pruneSharedContributions(
      data.sharedContributions,
      transactions,
      data.accounts,
      data.settings.members,
    ),
    efficiencyPlans: closeInvalidEfficiencyPlans(
      data.efficiencyPlans,
      new Set(data.settings.members.map((member) => member.id)),
      retainedCategoryKeys,
      changedAt,
    ),
    settings: { ...data.settings, customCategories },
  };
}

export function transitionConfirmTransfer(data: AppData, debitId: string, creditId: string): AppData {
  return {
    ...data,
    transactions: data.transactions.map((transaction) =>
      transaction.id === debitId || transaction.id === creditId
        ? {
            ...transaction,
            kind: "internal_transfer" as MovementKind,
            category: "uncategorized" as CategoryKey,
            beneficiary: UNASSIGNED_BENEFICIARY,
            beneficiarySource: undefined,
            classificationLocked: true,
          }
        : transaction,
    ),
  };
}

export function transitionSharedContribution(data: AppData, contribution: SharedContribution): AppData {
  const transactions = data.transactions.map((transaction) =>
    transaction.id === contribution.transferDebitTransactionId
      || transaction.id === contribution.transferCreditTransactionId
      ? {
          ...transaction,
          kind: "internal_transfer" as const,
          category: "uncategorized" as CategoryKey,
          beneficiary: UNASSIGNED_BENEFICIARY,
          beneficiarySource: undefined,
          classificationLocked: true,
        }
      : transaction,
  );
  const sharedContributions = pruneSharedContributions(
    [...data.sharedContributions.filter((item) => item.id !== contribution.id), contribution],
    transactions,
    data.accounts,
    data.settings.members,
  );
  return { ...data, transactions, sharedContributions };
}

export function transitionRemoveSharedContribution(data: AppData, id: string): AppData {
  return { ...data, sharedContributions: data.sharedContributions.filter((item) => item.id !== id) };
}
