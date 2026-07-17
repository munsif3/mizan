import { useCallback, useState } from "react";
import {
  applyAccountBeneficiaryDefaults,
  applyAccounts,
} from "./domain/accounts";
import {
  transitionAccounts,
  transitionCategorizeMerchant,
  transitionClearSplit,
  transitionConfirmTransfer,
  transitionCounterparties,
  transitionCustomCategories,
  transitionDeleteRule,
  transitionIncomeReceipts,
  transitionMembers,
  transitionRememberMerchant,
  transitionRemoveSharedContribution,
  transitionRemoveTransaction,
  transitionResetClassification,
  transitionSaveSplit,
  transitionSharedContribution,
  transitionTransactionAccount,
  transitionTransactionClassification,
} from "./domain/appDataTransitions";
import { isoDateOf, latestMonth, monthLabel, monthOf } from "./domain/dates";
import {
  sharedContributionError,
  type SharedContributionCandidate,
} from "./domain/contributions";
import { filterNew } from "./domain/dedupe";
import {
  confirmEfficiencyOutcome,
  createEfficiencyPlan,
  type EfficiencyPlanInput,
} from "./domain/efficiency";
import { normalizeFxTransaction } from "./domain/fx";
import { removeReceipt, unlinkTransaction, type PortionResolution } from "./domain/income";
import type { IncomeCandidate } from "./domain/incomeMatch";
import { directionForKind } from "./domain/movements";
import { applyRules } from "./domain/rules";
import { needsClassificationReview } from "./domain/summary";
import {
  uid,
  type AppData,
  type CategoryKey,
  type Account,
  type Counterparty,
  type CustomCategory,
  type EfficiencyOpportunity,
  type EfficiencyOutcomeResult,
  type IncomeReceipt,
  type IncomePortion,
  type MerchantRule,
  type Member,
  type MemberId,
  type MovementKind,
  type SpendBeneficiary,
  type Split,
  type SharedContribution,
  type Transaction,
} from "./domain/types";
import { parsersFor } from "./import/registry";
import { parseBackup, serializeBackup } from "./storage/backup";
import { hasLegacyLocalData } from "./storage/legacyBrowserData";
import { useAppDerivedState } from "./app/useAppDerivedState";
import { EMPTY_LEDGER_FILTERS, useHouseholdSession } from "./app/useHouseholdSession";
import { AppPresentation, type AppPresentationModel, type ModalKind } from "./app/AppPresentation";
import type { ImportResult } from "./ui/ImportModal";
import type { ManualEntry } from "./ui/ManualModal";

export function importedMonthContext(transactions: Pick<Transaction, "date">[]): {
  latest: string;
  spreadNotice: string;
} {
  const byMonth = new Map<string, number>();
  for (const transaction of transactions) {
    const month = monthOf(transaction.date);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) continue;
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
  }
  const spread = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => `${monthLabel(month)} (${count})`)
    .join(", ");
  return {
    latest: latestMonth(transactions),
    spreadNotice: byMonth.size > 1 ? `They span ${byMonth.size} months: ${spread}.` : "",
  };
}

interface UndoChange {
  label: string;
  before: AppData;
  householdId: string;
}

export default function App() {
  const [undoChange, setUndoChange] = useState<UndoChange | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [pendingBackup, setPendingBackup] = useState<AppData | null>(null);
  const [splitTxn, setSplitTxn] = useState<Transaction | null>(null);
  const [incomeConfirm, setIncomeConfirm] = useState<{ item: PortionResolution; candidate?: IncomeCandidate } | null>(null);
  const [contributionConfirm, setContributionConfirm] = useState<{
    candidate?: SharedContributionCandidate;
    expenseId?: string;
    contribution?: SharedContribution;
  } | null>(null);
  const [efficiencyReview, setEfficiencyReview] = useState<EfficiencyOpportunity | null>(null);
  const [efficiencyVerification, setEfficiencyVerification] = useState<EfficiencyOpportunity | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [dismissedTransfers, setDismissedTransfers] = useState<Set<string>>(() => new Set());

  const clearUndo = useCallback(() => setUndoChange(null), []);
  const resetTransientState = useCallback(() => {
    setModal(null);
    setPendingBackup(null);
    setSplitTxn(null);
    setIncomeConfirm(null);
    setContributionConfirm(null);
    setEfficiencyReview(null);
    setEfficiencyVerification(null);
    setCsvFile(null);
    setDismissedTransfers(new Set());
  }, []);
  const session = useHouseholdSession({ clearUndo, resetTransientState });
  const {
    repository,
    data,
    setData,
    legacyPresent,
    finishLegacyMigration,
    setView,
    month,
    setMonth,
    privacy,
    setLedgerFilters,
    setLastCheckInByHousehold,
    setNotice,
    householdMeta,
    bootstrapPhase,
    saveAuthoritativeSnapshot,
  } = session;

  const derived = useAppDerivedState({
    data,
    month,
    setMonth,
    bootstrapPhase,
    privacy,
    dismissedTransfers,
  });
  const {
    currentMonth,
    money,
  } = derived;

  function rememberUndo(label: string) {
    setUndoChange({ label, before: data, householdId: householdMeta?.id ?? "" });
  }

  function undoLastLedgerChange() {
    if (!undoChange || undoChange.householdId !== (householdMeta?.id ?? "")) return;
    setData(undoChange.before);
    setNotice(`${undoChange.label} undone.`);
    setUndoChange(null);
  }

  /** Apply a protected, one-transaction classification override. */
  function classifyTransaction(
    id: string,
    patch: Partial<Pick<Transaction, "category" | "beneficiary" | "kind" | "counterpartyId">>,
  ) {
    const current = data.transactions.find((item) => item.id === id);
    if (!current) return;
    rememberUndo(`Classification for ${current.description}`);
    const result = transitionTransactionClassification(data, id, patch);
    setData(result.data);
    if (result.contributionLinkRemoved) {
      setNotice("Changing this loan may remove its contribution link if the three-row evidence is no longer valid.");
    }
  }

  function setTransactionCategory(id: string, category: CategoryKey) {
    classifyTransaction(id, { category });
  }

  function setTransactionBeneficiary(id: string, beneficiary: SpendBeneficiary) {
    classifyTransaction(id, { beneficiary });
  }

  function setTransactionKind(id: string, kind: MovementKind) {
    classifyTransaction(id, { kind });
  }

  function setTransactionCounterparty(id: string, counterpartyId: string | undefined) {
    classifyTransaction(id, { counterpartyId });
  }

  function rememberTransactionMerchant(id: string) {
    const current = data.transactions.find((item) => item.id === id);
    if (!current) return;
    if (needsClassificationReview(current)) {
      setNotice("Choose both a purpose and beneficiary before saving a merchant default.");
      return;
    }
    rememberUndo(`Merchant rule for ${current.description}`);
    setData((previous) => transitionRememberMerchant(previous, id));
    setNotice(`${current.description} will now use this purpose and beneficiary by default.`);
  }

  function setTransactionAccount(id: string, accountId: string) {
    const current = data.transactions.find((item) => item.id === id);
    const account = data.accounts.find((item) => item.id === accountId);
    if (!current || !account) return;
    rememberUndo(`Account for ${current.description}`);
    setData((previous) => transitionTransactionAccount(previous, id, account));
  }

  function updateAccounts(accounts: Account[]) {
    setData((previous) => transitionAccounts(previous, accounts));
  }

  function categorizeMerchant(merchant: string, rule: MerchantRule) {
    rememberUndo(`Rule for ${merchant}`);
    setData((previous) => transitionCategorizeMerchant(previous, merchant, rule));
  }

  function addManual(entry: ManualEntry) {
    const { accountId, ...manualEntry } = entry;
    const registeredAccount = accountId ? data.accounts.find((account) => account.id === accountId) : undefined;
    const txn: Transaction = {
      id: uid("txn"),
      source: "manual",
      direction: directionForKind(entry.kind),
      classificationLocked: true,
      ...manualEntry,
      account: registeredAccount?.label ?? entry.account,
      ...(registeredAccount ? { accountId: registeredAccount.id } : {}),
    };
    if (!registeredAccount && txn.beneficiarySource === "account_default") delete txn.beneficiarySource;
    if (!txn.counterpartyId) delete txn.counterpartyId;
    setData((previous) => ({
      ...previous,
      transactions: [...previous.transactions, txn].sort((a, b) => a.date.localeCompare(b.date)),
    }));
    setMonth(monthOf(txn.date));
  }

  /** Shared tail for every import route: apply accounts + rules, dedupe, store, notify. */
  function ingestTransactions(parsed: Transaction[], failures: string[], extraNotes: string[] = []): ImportResult {
    const normalized = parsed.map((txn) => normalizeFxTransaction(txn, data.settings.currency));
    const linked = applyAccounts(normalized, data.accounts);
    const defaulted = applyAccountBeneficiaryDefaults(linked, data.accounts, data.settings.members);
    const ruled = applyRules(defaulted, data.merchantRules, data.accounts, data.settings.members);
    const fresh = filterNew(data.transactions, ruled);
    const needsReview = fresh.filter(needsClassificationReview).length;
    const importedMonths = importedMonthContext(fresh);
    if (fresh.length) {
      setData((previous) => ({
        ...previous,
        transactions: [...previous.transactions, ...filterNew(previous.transactions, ruled)].sort((a, b) =>
          a.date.localeCompare(b.date),
        ),
      }));
      setMonth(importedMonths.latest);
    }

    // A card statement period straddles a calendar boundary, so an import
    // routinely lands rows in two months while the ledger below shows one.
    // Say so, or the month we land on looks like it lost the other rows.
    const parts = [
      `Imported ${fresh.length} transaction${fresh.length === 1 ? "" : "s"}; skipped ${ruled.length - fresh.length} duplicate${ruled.length - fresh.length === 1 ? "" : "s"}.`,
      importedMonths.spreadNotice,
      needsReview ? `${needsReview} need a purpose or beneficiary — see the review queue under Transactions.` : "",
      ...extraNotes,
      ...failures,
    ].filter(Boolean);
    setNotice(parts.join(" "));
    if (needsReview) {
      setLedgerFilters(EMPTY_LEDGER_FILTERS);
      setView("transactions");
    }
    return { imported: fresh.length, duplicates: ruled.length - fresh.length, needsReview, failures };
  }

  async function importStatements(
    files: File[],
    passwords: Record<string, string>,
    onProgress: (step: string) => void,
  ): Promise<ImportResult> {
    const parsed: Transaction[] = [];
    const failures: string[] = [];
    for (const file of files) {
      try {
        const [parser] = parsersFor(file);
        if (!parser) throw new Error(`Unrecognized statement format: ${file.name}`);
        onProgress(`Parsing ${file.name}`);
        parsed.push(...(await parser.parse(file, passwords[parser.id] ?? "")));
      } catch (error) {
        failures.push(`${file.name}: ${(error as Error).message}`);
      }
    }
    return ingestTransactions(parsed, failures);
  }

  function updateMembers(members: Member[]) {
    const result = transitionMembers(data, members, new Date().toISOString());
    setData(result.data);
    if (result.removedMemberIds.length) {
      setLedgerFilters((current) => ({
        ...current,
        beneficiary: current.beneficiary.startsWith("member:")
          && result.removedMemberIds.includes(current.beneficiary.slice("member:".length)) ? "all" : current.beneficiary,
        payer: current.payer.startsWith("member:")
          && result.removedMemberIds.includes(current.payer.slice("member:".length)) ? "all" : current.payer,
      }));
    }
  }

  function recordIncomeReceipts(receipts: IncomeReceipt[]) {
    setData((previous) => transitionIncomeReceipts(previous, receipts));
    setIncomeConfirm(null);
  }

  function addOneOffIncome(memberId: string, portion: IncomePortion) {
    updateMembers(data.settings.members.map((member) => member.id === memberId
      ? { ...member, portions: [...member.portions, portion] }
      : member));
    setModal(null);
    setNotice(`${portion.label} added for ${monthLabel(portion.schedule.frequency === "one_off" ? portion.schedule.month : currentMonth)}.`);
  }

  function unlinkIncomeEvidence(transactionId: string) {
    setData((previous) => ({ ...previous, incomeReceipts: unlinkTransaction(previous.incomeReceipts, transactionId) }));
    setIncomeConfirm(null);
    setNotice("Statement evidence unlinked. Confirmed income amounts were preserved.");
  }

  function removeIncomeConfirmation(monthValue: string, memberId: MemberId, portionId: string) {
    setData((previous) => ({ ...previous, incomeReceipts: removeReceipt(previous.incomeReceipts, monthValue, memberId, portionId) }));
    setIncomeConfirm(null);
  }

  function saveSplit(id: string, split: Split) {
    setData((previous) => transitionSaveSplit(previous, id, split));
  }

  function clearSplit(id: string) {
    setData((previous) => transitionClearSplit(previous, id));
  }

  function removeTransaction(id: string) {
    const result = transitionRemoveTransaction(data, id);
    setData(result.data);
    if (result.contributionLinkRemoved) {
      setNotice("The linked contribution was removed and household settlement was recalculated.");
    }
  }

  function deleteRule(merchant: string) {
    rememberUndo(`Rule for ${merchant}`);
    setData((previous) => transitionDeleteRule(previous, merchant));
    setNotice(`Removed the rule for ${merchant}; affected rows returned to review.`);
  }

  function resetTransactionClassification(id: string) {
    const current = data.transactions.find((txn) => txn.id === id);
    if (!current) return;
    rememberUndo(`Classification for ${current.description}`);
    setData((previous) => transitionResetClassification(previous, id));
    setNotice(`${current.description} returned to review as a one-transaction override.`);
  }

  function updateCounterparties(counterparties: Counterparty[]) {
    setData((previous) => transitionCounterparties(previous, counterparties));
  }

  function updateCustomCategories(customCategories: CustomCategory[]) {
    const retainedCategoryKeys = new Set(customCategories.map((category) => `custom:${category.id}`));
    setData((previous) => transitionCustomCategories(previous, customCategories, new Date().toISOString()));
    setLedgerFilters((current) => current.category.startsWith("custom:")
      && !retainedCategoryKeys.has(current.category)
      ? { ...current, category: "all" }
      : current);
  }

  /** Confirm a suggested transfer pair: mark both legs internal_transfer (not spend). */
  function confirmTransfer(debitId: string, creditId: string) {
    const debit = data.transactions.find((txn) => txn.id === debitId);
    rememberUndo(`Transfer${debit ? ` for ${debit.description}` : ""}`);
    setData((previous) => transitionConfirmTransfer(previous, debitId, creditId));
  }

  function saveSharedContribution(contribution: SharedContribution) {
    const error = sharedContributionError(contribution, data.transactions, data.accounts, data.settings.members, data.sharedContributions);
    if (error) {
      setNotice(`Could not link contribution: ${error}`);
      return;
    }
    const contributor = data.settings.members.find((member) => member.id === contribution.contributorMemberId);
    rememberUndo(`Contribution from ${contributor?.name ?? "household member"}`);
    setData((previous) => transitionSharedContribution(previous, contribution));
    setContributionConfirm(null);
    setNotice(`${contributor?.name ?? "Household member"}'s ${money(contribution.amount)} contribution is linked to the loan payment.`);
  }

  function removeSharedContribution(id: string) {
    setData((previous) => transitionRemoveSharedContribution(previous, id));
    setContributionConfirm(null);
    setNotice("The contribution link was removed; its transfer rows remain internal transfers and settlement was recalculated.");
  }

  function exportBackup() {
    const blob = new Blob([serializeBackup(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mizan-backup-${isoDateOf(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importBackup(file: File) {
    if (!repository) {
      setNotice("Create or join a Firestore household before importing a backup.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const nextData = parseBackup(String(reader.result));
        setPendingBackup(nextData);
      } catch (error) {
        setNotice(`That backup file could not be imported: ${(error as Error).message}`);
      }
    };
    reader.readAsText(file);
  }

  async function confirmBackupImport() {
    if (!pendingBackup || !repository) return;
    const nextData = pendingBackup;
    const activeRepository = repository;
    try {
      await saveAuthoritativeSnapshot(activeRepository, nextData);
      setPendingBackup(null);
      setUndoChange(null);
      setNotice("Backup imported to Firestore.");
    } catch (error) {
      setNotice(`That backup file could not be imported: ${(error as Error).message}`);
    }
  }

  function clearAllData() {
    if (!legacyPresent && !hasLegacyLocalData()) {
      setNotice("No legacy browser financial data was found.");
      return;
    }
    finishLegacyMigration();
    setNotice("Legacy browser financial data cleared.");
  }

  function completeWeeklyCheckIn() {
    if (!householdMeta) return;
    const checkedAt = new Date().toISOString();
    setLastCheckInByHousehold((previous) => ({ ...previous, [householdMeta.id]: checkedAt }));
    setNotice("Weekly money check-in recorded. Come back after your next statement update, or within seven days.");
  }

  function saveEfficiencyDecision(opportunity: EfficiencyOpportunity, input: EfficiencyPlanInput) {
    const existing = opportunity.planId
      ? data.efficiencyPlans.find((plan) => plan.id === opportunity.planId)
      : undefined;
    const plan = createEfficiencyPlan(opportunity, input, currentMonth, new Date().toISOString(), existing);
    setData((previous) => ({
      ...previous,
      efficiencyPlans: [...previous.efficiencyPlans.filter((item) => item.id !== plan.id), plan],
    }));
    setEfficiencyReview(null);
    setNotice(input.action === "keep"
      ? "Value check recorded. Mizan will revisit it in six months or after a material price increase."
      : "Efficiency plan saved to the shared household board.");
  }

  function verifyEfficiencyOutcome(opportunity: EfficiencyOpportunity, result: EfficiencyOutcomeResult) {
    const plan = opportunity.planId
      ? data.efficiencyPlans.find((item) => item.id === opportunity.planId)
      : undefined;
    if (!plan) {
      setNotice("That efficiency plan changed. Reopen the opportunity and try again.");
      setEfficiencyVerification(null);
      return;
    }
    const confirmed = confirmEfficiencyOutcome(plan, opportunity, result, new Date().toISOString());
    setData((previous) => ({
      ...previous,
      efficiencyPlans: previous.efficiencyPlans.map((item) => item.id === confirmed.id ? confirmed : item),
    }));
    setEfficiencyVerification(null);
    setNotice("Efficiency outcome recorded as an informational comparison. Ledger savings were not changed.");
  }

  const presentationModel: AppPresentationModel = {
    session,
    derived,
    ui: {
      modal,
      setModal,
      pendingBackup,
      setPendingBackup,
      splitTxn,
      setSplitTxn,
      incomeConfirm,
      setIncomeConfirm,
      contributionConfirm,
      setContributionConfirm,
      efficiencyReview,
      setEfficiencyReview,
      efficiencyVerification,
      setEfficiencyVerification,
      csvFile,
      setCsvFile,
      dismissedTransfers: setDismissedTransfers,
      undoChange,
    },
    actions: {
      updateMembers,
      updateAccounts,
      deleteRule,
      updateCounterparties,
      updateCustomCategories,
      exportBackup,
      importBackup,
      confirmBackupImport,
      clearAllData,
      addManual,
      importStatements,
      ingestTransactions,
      setTransactionCategory,
      setTransactionBeneficiary,
      setTransactionKind,
      setTransactionCounterparty,
      setTransactionAccount,
      categorizeMerchant,
      rememberTransactionMerchant,
      undoLastLedgerChange,
      resetTransactionClassification,
      confirmTransfer,
      removeTransaction,
      completeWeeklyCheckIn,
      saveEfficiencyDecision,
      verifyEfficiencyOutcome,
      saveSplit,
      clearSplit,
      recordIncomeReceipts,
      removeIncomeConfirmation,
      unlinkIncomeEvidence,
      addOneOffIncome,
      saveSharedContribution,
      removeSharedContribution,
    },
  };
  return <AppPresentation model={presentationModel} />;
}
