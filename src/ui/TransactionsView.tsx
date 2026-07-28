import { useEffect, useMemo, useState } from "react";
import { ChevronRight, RotateCcw, Scissors, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { ownerOfTransaction } from "../domain/accounts";
import { categoryOptions, spendingCategoryOptions } from "../domain/categories";
import { contributionReferencesTransaction } from "../domain/contributions";
import { monthLabel } from "../domain/dates";
import { isSpendKind, kindAllowedFor, kindNeedsCategory, kindNeedsCounterparty, movementInfo, MOVEMENT_OPTIONS } from "../domain/movements";
import { cleanMerchant } from "../domain/rules";
import { isSpend, needsClassificationReview, netAmount, reviewTiers, spendTotal, type MonthSummary, type ReviewItem } from "../domain/summary";
import type { TransferCandidate } from "../domain/transfers";
import { defaultKind, type Account, type AssetHolding, type CategoryKey, type Counterparty, type CustomCategory, type MerchantRule, type Member, type MovementKind, type SharedContribution, type SpendBeneficiary, type Transaction } from "../domain/types";
import { Button, ConfirmDialog, EmptyState, IconButton, Modal, MoneyValue, StatusBadge } from "./bits";
import {
  reviewControlDefaults,
  reviewControlsComplete,
  ruleFromControls,
  type RuleBeneficiaryValue,
} from "./ruleFields";

export type BeneficiaryFilter = "all" | "household" | "unassigned" | `member:${string}`;
export type PayerFilter = "all" | "joint" | `member:${string}`;

export interface LedgerFilters {
  category: CategoryKey | "all";
  beneficiary: BeneficiaryFilter;
  payer: PayerFilter;
  merchant?: string;
  spendOnly?: boolean;
  query?: string;
  dateFrom?: string;
  dateTo?: string;
}

function beneficiaryFilterOf(beneficiary: SpendBeneficiary): Exclude<BeneficiaryFilter, "all"> {
  return beneficiary.type === "member" ? `member:${beneficiary.memberId}` : beneficiary.type;
}

function beneficiaryFromFilter(value: Exclude<BeneficiaryFilter, "all">): SpendBeneficiary {
  return value.startsWith("member:")
    ? { type: "member", memberId: value.slice("member:".length) }
    : { type: value as "household" | "unassigned" };
}

function useTransactionsViewModel({
  summary,
  members,
  accounts,
  assetHoldings = [],
  customCategories,
  counterparties,
  queue,
  transferCandidates,
  undoLabel,
  filters,
  onFiltersChange,
  money,
  transactionMoney,
  financialValuesHidden = false,
  onSetCategory,
  onSetBeneficiary,
  onSetKind,
  onSetCounterparty,
  onSetHolding = () => undefined,
  onSetAccount,
  onCategorizeMerchant,
  onCategorizeMerchants,
  onRememberMerchant,
  onUndo,
  onResetClassification,
  onUnlinkCommitment = () => undefined,
  onConfirmTransfer,
  onDismissTransfer,
  onSplit,
  onRemove,
  incomeLinkedIds,
  allTransactions,
  sharedContributions,
  onLinkContribution,
  onEditContribution,
  onOpenImport,
  onAddTransaction,
}: {
  summary: MonthSummary;
  members: Member[];
  accounts: Account[];
  assetHoldings?: AssetHolding[];
  customCategories: CustomCategory[];
  counterparties: Counterparty[];
  queue: ReviewItem[];
  transferCandidates: TransferCandidate[];
  undoLabel: string;
  filters: LedgerFilters;
  onFiltersChange: (value: LedgerFilters) => void;
  money: (value: number) => string;
  transactionMoney: (txn: Transaction, value: number) => string;
  financialValuesHidden?: boolean;
  onSetCategory: (id: string, category: CategoryKey) => void;
  onSetBeneficiary: (id: string, beneficiary: SpendBeneficiary) => void;
  onSetKind: (id: string, kind: MovementKind) => void;
  onSetCounterparty: (id: string, counterpartyId: string | undefined) => void;
  onSetHolding?: (id: string, holdingId: string | undefined) => void;
  onSetAccount: (id: string, accountId: string) => void;
  onCategorizeMerchant: (merchant: string, rule: MerchantRule) => void;
  onCategorizeMerchants: (entries: { merchant: string; rule: MerchantRule }[]) => void;
  onRememberMerchant: (id: string) => void;
  onUndo: () => void;
  onResetClassification: (id: string) => void;
  onUnlinkCommitment?: (id: string) => void;
  onConfirmTransfer: (debitId: string, creditId: string) => void;
  onDismissTransfer: (debitId: string, creditId: string) => void;
  onSplit: (txn: Transaction) => void;
  onRemove: (id: string) => void;
  incomeLinkedIds?: Set<string>;
  allTransactions?: Transaction[];
  sharedContributions?: SharedContribution[];
  onLinkContribution?: (expenseId: string) => void;
  onEditContribution?: (contribution: SharedContribution) => void;
  onOpenImport?: () => void;
  onAddTransaction?: () => void;
}) {
  const linkedIncome = incomeLinkedIds ?? new Set<string>();
  const contributions = sharedContributions ?? [];
  const contributionTransactions = allTransactions ?? summary.monthTransactions;
  const allOptions = categoryOptions(customCategories);
  const configuredAccounts = accounts.filter((account) => account.label.trim());
  // One-member households have no "for whom?" axis: it resolves to that member.
  const solo = members.length === 1;
  const [accountFilter, setAccountFilter] = useState("all");
  const [movementFilter, setMovementFilter] = useState<MovementKind | "all">("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(true);
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null);
  useEffect(() => {
    setAccountFilter("all");
    setMovementFilter("all");
  }, [summary.month]);
  const accountsInMonth = [...new Set(summary.monthTransactions.map((txn) => txn.account))].sort();
  const payerFiltersFor = (txn: Transaction): PayerFilter[] => {
    const linked = contributions.flatMap((item) => {
      const allocation = item.allocations.find((candidate) => candidate.expenseTransactionId === txn.id);
      return allocation ? [{ memberId: item.contributorMemberId, amount: allocation.amount }] : [];
    });
    const funded = linked.reduce((sum, item) => sum + item.amount, 0);
    const values = new Set<PayerFilter>(linked.map((item) => `member:${item.memberId}` as PayerFilter));
    const owner = ownerOfTransaction(txn, accounts);
    if (netAmount(txn) - funded > 0.005) {
      values.add(owner === "joint" || owner === "unassigned" ? "joint" : `member:${owner}`);
    }
    return [...values];
  };
  const categoryLabel = (key: CategoryKey) => allOptions.find((option) => option.key === key)?.label ?? key;
  const beneficiaryLabel = (beneficiary: SpendBeneficiary) => beneficiary.type === "household"
    ? "Household"
    : beneficiary.type === "unassigned"
      ? "Unassigned"
      : members.find((member) => member.id === beneficiary.memberId)?.name ?? "Former member";
  const counterpartyName = (id: string | undefined) => (id ? (counterparties.find((cp) => cp.id === id)?.name ?? "") : "");
  const query = filters.query?.trim().toLocaleLowerCase() ?? "";
  const searchableText = (txn: Transaction) => [
    txn.description,
    txn.account,
    txn.rawAccount,
    txn.note,
    categoryLabel(txn.category),
    beneficiaryLabel(txn.beneficiary),
    movementInfo(txn.kind).label,
    counterpartyName(txn.counterpartyId),
  ].filter(Boolean).join(" ").toLocaleLowerCase();
  const visible = summary.monthTransactions.filter(
    (txn) =>
      (filters.category === "all" || txn.category === filters.category) &&
      (filters.beneficiary === "all" || beneficiaryFilterOf(txn.beneficiary) === filters.beneficiary) &&
      (filters.payer === "all" || payerFiltersFor(txn).includes(filters.payer)) &&
      (!filters.merchant || cleanMerchant(txn.description) === cleanMerchant(filters.merchant)) &&
      (!filters.spendOnly || isSpend(txn)) &&
      (!query || searchableText(txn).includes(query)) &&
      (!filters.dateFrom || txn.date >= filters.dateFrom) &&
      (!filters.dateTo || txn.date <= filters.dateTo) &&
      (accountFilter === "all" || txn.account === accountFilter) &&
      (movementFilter === "all" || txn.kind === movementFilter),
  );
  const memberName = (id: string) => members.find((member) => member.id === id)?.name ?? "Former member";
  const beneficiaryFilterLabel = filters.beneficiary === "household"
    ? "For: Household"
    : filters.beneficiary === "unassigned"
      ? "For: Unassigned"
      : filters.beneficiary.startsWith("member:")
        ? `For: ${memberName(filters.beneficiary.slice("member:".length))}`
        : "";
  const payerFilterLabel = filters.payer === "joint"
    ? "Paid from: Joint/unregistered"
    : filters.payer.startsWith("member:")
      ? `Paid from: ${memberName(filters.payer.slice("member:".length))}`
      : "";
  const hasFilters = filters.category !== "all" || filters.beneficiary !== "all" || filters.payer !== "all" ||
    Boolean(filters.merchant) || Boolean(filters.spendOnly) || Boolean(filters.query) || Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo) || accountFilter !== "all" || movementFilter !== "all";
  const filterCount = [
    filters.category !== "all",
    filters.beneficiary !== "all",
    filters.payer !== "all",
    Boolean(filters.merchant),
    Boolean(filters.spendOnly),
    Boolean(filters.dateFrom),
    Boolean(filters.dateTo),
    accountFilter !== "all",
    movementFilter !== "all",
  ].filter(Boolean).length;
  const selectedTransaction = summary.monthTransactions.find((txn) => txn.id === selectedTransactionId) ?? null;
  const [year, monthNumber] = summary.month.split("-").map(Number);
  const monthEnd = Number.isFinite(year) && Number.isFinite(monthNumber)
    ? `${summary.month}-${String(new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate()).padStart(2, "0")}`
    : undefined;
  const clearAllFilters = () => {
    onFiltersChange({ category: "all", beneficiary: "all", payer: "all" });
    setAccountFilter("all");
    setMovementFilter("all");
  };

  const canReset = (txn: Transaction) =>
    txn.category !== "uncategorized" || txn.beneficiary.type !== "unassigned" ||
    txn.kind !== defaultKind(txn.direction) || Boolean(txn.counterpartyId) || Boolean(txn.holdingId) ||
    Boolean(txn.commitmentId) || Boolean(txn.linkedTransferId) || Boolean(txn.classificationLocked);
  const confirmRemove = (txn: Transaction) => {
    setPendingDelete(txn);
  };
  const deleteWarning = (txn: Transaction) => {
    const linkedContribution = contributions.some((item) =>
      contributionReferencesTransaction(item, txn.id, contributionTransactions),
    );
    const linkedWarning = linkedIncome.has(txn.id)
      ? " This credit is linked to an income confirmation; deleting it will keep the receipt but remove its statement link."
      : "";
    const contributionWarning = linkedContribution
      ? " This row is evidence for a shared contribution; deleting it will remove that link and recalculate settlement."
      : "";
    return `Delete ${txn.description} from the household ledger?${linkedWarning}${contributionWarning} This cannot be undone.`;
  };

  const controls = (txn: Transaction) => (
    <div className="movement-controls">
      <select aria-label={`Movement for ${txn.description}`} value={txn.kind} onChange={(event) => onSetKind(txn.id, event.target.value as MovementKind)}>
        {MOVEMENT_OPTIONS.filter((option) => kindAllowedFor(option.kind, txn.direction)).map((option) => (
          <option key={option.kind} value={option.kind}>{option.label}</option>
        ))}
      </select>
      {kindNeedsCategory(txn.kind) && (
        <select aria-label={`Category for ${txn.description}`} value={txn.category} onChange={(event) => onSetCategory(txn.id, event.target.value as CategoryKey)}>
          {allOptions.map((option) => (
            <option key={option.key} value={option.key}>{option.label}</option>
          ))}
        </select>
      )}
      {isSpend(txn) && !solo && (
        <span className="beneficiary-control">
          <select
            aria-label={`Who it was for: ${txn.description}`}
            value={beneficiaryFilterOf(txn.beneficiary)}
            onChange={(event) => onSetBeneficiary(
              txn.id,
              beneficiaryFromFilter(event.target.value as Exclude<BeneficiaryFilter, "all">),
            )}
          >
            <option value="unassigned">Who was it for?</option>
            <option value="household">Household</option>
            {members.map((member) => (
              <option key={member.id} value={`member:${member.id}`}>{member.name}</option>
            ))}
          </select>
          {txn.beneficiarySource === "account_default" && <small>Account default</small>}
        </span>
      )}
      {kindNeedsCounterparty(txn.kind) && (
        <select
          aria-label={`Person for ${txn.description}`}
          value={txn.counterpartyId ?? ""}
          onChange={(event) => onSetCounterparty(txn.id, event.target.value || undefined)}
        >
          <option value="">Who?</option>
          {counterparties.map((cp) => (
            <option key={cp.id} value={cp.id}>{cp.name}</option>
          ))}
        </select>
      )}
      {txn.kind === "investment_transfer" && (
        <select
          aria-label={`Asset holding for ${txn.description}`}
          value={txn.holdingId ?? ""}
          onChange={(event) => onSetHolding(txn.id, event.target.value || undefined)}
        >
          <option value="">Choose holding</option>
          {assetHoldings.filter((holding) => holding.status !== "closed").map((holding) => (
            <option key={holding.id} value={holding.id}>{holding.label}</option>
          ))}
        </select>
      )}
      {txn.classificationLocked && (
        <button
          type="button"
          className="link-button"
          disabled={needsClassificationReview(txn)}
          onClick={() => onRememberMerchant(txn.id)}
        >
          Save merchant default
        </button>
      )}
    </div>
  );

  const accountControl = (txn: Transaction) => {
    const exact = configuredAccounts.find((account) => account.label.localeCompare(txn.account, undefined, { sensitivity: "accent" }) === 0);
    const selectedId = txn.accountId && configuredAccounts.some((account) => account.id === txn.accountId) ? txn.accountId : exact?.id ?? "";
    return (
      <select
        className={selectedId ? "account-select" : "account-select unresolved"}
        aria-label={`Account for ${txn.description}`}
        value={selectedId}
        onChange={(event) => onSetAccount(txn.id, event.target.value)}
      >
        {!selectedId && <option value="">Unassigned: {txn.account}</option>}
        {configuredAccounts.map((account) => (
          <option key={account.id} value={account.id}>{account.label}</option>
        ))}
      </select>
    );
  };

  const contributionControl = (txn: Transaction) => {
    const funded = contributions.flatMap((item) => {
      const allocation = item.allocations.find((candidate) => candidate.expenseTransactionId === txn.id);
      return allocation ? [{ contribution: item, allocatedAmount: allocation.amount }] : [];
    });
    const evidence = contributions.find((item) => item.transferDebitTransactionId === txn.id || item.transferCreditTransactionId === txn.id);
    const sharedLoan = txn.kind === "loan_payment" && txn.beneficiary.type === "household";
    if (!funded.length && !evidence && !sharedLoan) return null;
    return (
      <div className="contribution-links">
        {funded.map(({ contribution, allocatedAmount }) => {
          const member = members.find((candidate) => candidate.id === contribution.contributorMemberId);
          return (
            <button className="link-button" key={contribution.id} onClick={() => onEditContribution?.(contribution)}>
              {member?.name ?? "Member"} funded <MoneyValue formatted={money(allocatedAmount)} hidden={financialValuesHidden} />
            </button>
          );
        })}
        {evidence && <small className="movement-badge">Contribution evidence</small>}
        {sharedLoan && !funded.length && (
          <button className="link-button" onClick={() => onLinkContribution?.(txn.id)}>Link contribution</button>
        )}
      </div>
    );
  };

  return {
    summary, members, accounts, assetHoldings, customCategories, counterparties, queue, transferCandidates,
    undoLabel, filters, onFiltersChange, money, transactionMoney, financialValuesHidden, solo,
    onCategorizeMerchant, onCategorizeMerchants, onUndo, onResetClassification, onUnlinkCommitment,
    onConfirmTransfer, onDismissTransfer,
    onSplit, onRemove, onOpenImport, onAddTransaction, linkedIncome,
    allOptions, accountFilter, setAccountFilter, movementFilter, setMovementFilter,
    filtersOpen, setFiltersOpen, reviewOpen, setReviewOpen, setSelectedTransactionId,
    pendingDelete, setPendingDelete, accountsInMonth, categoryLabel,
    beneficiaryLabel, counterpartyName, visible, beneficiaryFilterLabel, payerFilterLabel,
    hasFilters, filterCount, selectedTransaction, monthEnd, clearAllFilters, canReset,
    confirmRemove, deleteWarning, controls, accountControl, contributionControl,
  };
}

type TransactionsViewModel = ReturnType<typeof useTransactionsViewModel>;

function TransactionReviewSections({ model }: { model: TransactionsViewModel }) {
  const [showTail, setShowTail] = useState(false);
  useEffect(() => setShowTail(false), [model.summary.month]);
  const {
    undoLabel, onUndo, transferCandidates, money, financialValuesHidden, onConfirmTransfer,
    onDismissTransfer, queue, reviewOpen, setReviewOpen, members, accounts, assetHoldings, customCategories,
    counterparties, onCategorizeMerchant, onCategorizeMerchants, summary, solo,
  } = model;

  const tiers = useMemo(
    () => reviewTiers(queue, { anchorTotal: summary.totalSpend }),
    [queue, summary.totalSpend],
  );
  // Settlement-critical merchants first: they change who owes whom, not just a chart.
  const asked = useMemo(() => [...tiers.mustAsk, ...tiers.worthAsking], [tiers]);
  // Only merchants whose suggestion is already a complete rule can be accepted in bulk.
  const acceptable = useMemo(
    () => asked
      .map((item) => ({ item, controls: reviewControlDefaults(item) }))
      .filter(({ controls }) => reviewControlsComplete(controls, solo)),
    [asked, solo],
  );

  const acceptAllSuggestions = () => onCategorizeMerchants(acceptable.map(({ item, controls }) => ({
    merchant: item.merchant,
    rule: ruleFromControls(
      controls.kind, controls.category, controls.beneficiary, controls.counterpartyId, solo, controls.holdingId,
    ),
  })));

  const reviewCardFor = (item: ReviewItem) => (
    <ReviewCard
      key={item.merchant}
      item={item}
      members={members}
      accounts={accounts}
      assetHoldings={assetHoldings}
      customCategories={customCategories}
      counterparties={counterparties}
      money={money}
      financialValuesHidden={financialValuesHidden}
      onCategorize={onCategorizeMerchant}
    />
  );

  return (
    <>
      {undoLabel && (
        <section className="friendly-section undo-strip">
          <div className="friendly-heading">
            <div>
              <span className="soft-label">Recent ledger change</span>
              <h3>{undoLabel}</h3>
            </div>
            <div className="undo-actions">
              <p>Undo restores the affected rows and merchant rule.</p>
              <Button variant="primary" onClick={onUndo}>Undo</Button>
            </div>
          </div>
        </section>
      )}

      {transferCandidates.length > 0 && (
        <section className="friendly-section transfer-strip">
          <div className="friendly-heading">
            <div>
              <span className="soft-label">Possible transfers</span>
              <h3>Are these internal transfers?</h3>
            </div>
            <p>Matching amounts between your own accounts. Confirm to exclude both legs from spend.</p>
          </div>
          <div className="review-list">
            {transferCandidates.map((pair) => (
              <div className="review-card" key={`${pair.debit.id}:${pair.credit.id}`}>
                <div>
                  <span className="review-merchant"><MoneyValue formatted={money(netAmount(pair.debit))} hidden={financialValuesHidden} /></span>
                  <small>
                    {pair.debit.account} → {pair.credit.account}
                    {pair.daysApart > 0 ? ` · ${pair.daysApart}d apart` : " · same day"}
                  </small>
                </div>
                <div className="row-actions">
                  <Button variant="primary" onClick={() => onConfirmTransfer(pair.debit.id, pair.credit.id)}>Mark as transfer</Button>
                  <Button variant="secondary" onClick={() => onDismissTransfer(pair.debit.id, pair.credit.id)}>Not a transfer</Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {asked.length > 0 && (
        <section className="friendly-section review-strip merchant-review-strip">
          <div className="review-queue-heading">
            <div>
              <span className="soft-label">Review queue</span>
              <h3>{asked.length} merchant{asked.length === 1 ? "" : "s"} need a default</h3>
            </div>
            <div className="review-queue-actions">
              <p>
                Set purpose and who it was for once. Matching history and future imports follow that default.
                {tiers.mustAsk.length > 0
                  ? ` ${tiers.mustAsk.length} of these change${tiers.mustAsk.length === 1 ? "s" : ""} who owes whom.`
                  : ""}
              </p>
              <Button variant="secondary" aria-expanded={reviewOpen} onClick={() => setReviewOpen((current) => !current)}>
                {reviewOpen ? "Hide review queue" : "Review merchants"}
              </Button>
              {reviewOpen && acceptable.length > 1 && (
                <Button variant="primary" onClick={acceptAllSuggestions}>
                  Accept all {acceptable.length} suggestions
                </Button>
              )}
            </div>
          </div>
          {reviewOpen && <div className="review-list merchant-review-list">
            {asked.map(reviewCardFor)}
          </div>}
        </section>
      )}

      {tiers.tail.length > 0 && (
        <section className="friendly-section review-strip merchant-review-strip">
          <div className="review-queue-heading">
            <div>
              <span className="soft-label">Not asking about these</span>
              <h3>
                {tiers.tail.length} smaller merchant{tiers.tail.length === 1 ? "" : "s"}
                {" · "}
                <MoneyValue formatted={money(tiers.tailTotal)} hidden={financialValuesHidden} />
              </h3>
            </div>
            <div className="review-queue-actions">
              <p>
                {tiers.tailRowCount} transaction{tiers.tailRowCount === 1 ? "" : "s"} already counted in your
                spend and save rate. Classifying them sharpens the breakdown and nothing else, so Mizan stopped asking.
              </p>
              <Button variant="secondary" aria-expanded={showTail} onClick={() => setShowTail((current) => !current)}>
                {showTail ? "Hide these" : "Classify them anyway"}
              </Button>
            </div>
          </div>
          {showTail && <div className="review-list merchant-review-list">
            {tiers.tail.map(reviewCardFor)}
          </div>}
        </section>
      )}

    </>
  );
}


function TransactionFilterBar({ model }: { model: TransactionsViewModel }) {
  const {
    filters, onFiltersChange, filtersOpen, setFiltersOpen, filterCount, summary, monthEnd,
    allOptions, members, movementFilter, setMovementFilter, accountFilter, setAccountFilter,
    accountsInMonth, hasFilters, categoryLabel, beneficiaryFilterLabel, payerFilterLabel,
    clearAllFilters, solo,
  } = model;
  return (
    <>
        <div className="table-toolbar">
          <div className="ledger-search-row">
            <label className="ledger-search">
              <Search size={18} aria-hidden="true" />
              <span className="sr-only">Search transactions</span>
              <input
                type="search"
                aria-label="Search transactions"
                placeholder="Search description, account, purpose, or person"
                value={filters.query ?? ""}
                onChange={(event) => onFiltersChange({ ...filters, query: event.target.value || undefined })}
              />
            </label>
            <Button
              type="button"
              variant="secondary" className="filter-toggle"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((current) => !current)}
            >
              <SlidersHorizontal size={18} aria-hidden="true" />
              Filters{filterCount ? ` (${filterCount})` : ""}
            </Button>
          </div>
          <div className={`toolbar-filters filter-panel ${filtersOpen ? "open" : ""}`} aria-label="Ledger filters">
            <label><span>From</span><input aria-label="From date" type="date" min={`${summary.month}-01`} max={monthEnd} value={filters.dateFrom ?? ""} onChange={(event) => onFiltersChange({ ...filters, dateFrom: event.target.value || undefined })} /></label>
            <label><span>To</span><input aria-label="To date" type="date" min={`${summary.month}-01`} max={monthEnd} value={filters.dateTo ?? ""} onChange={(event) => onFiltersChange({ ...filters, dateTo: event.target.value || undefined })} /></label>
            <label><span>Purpose</span><select aria-label="What for" value={filters.category} onChange={(event) => onFiltersChange({ ...filters, category: event.target.value as CategoryKey | "all" })}>
              <option value="all">All purposes</option>
              {allOptions.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}
            </select></label>
            {!solo && <label><span>Who it was for</span><select aria-label="Who it was for" value={filters.beneficiary} onChange={(event) => onFiltersChange({ ...filters, beneficiary: event.target.value as BeneficiaryFilter })}>
              <option value="all">Everyone</option><option value="household">Household</option>
              {members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.name}</option>)}
              <option value="unassigned">Unassigned</option>
            </select></label>}
            {!solo && <label><span>Paid from</span><select aria-label="Paid from" value={filters.payer} onChange={(event) => onFiltersChange({ ...filters, payer: event.target.value as PayerFilter })}>
              <option value="all">All payment sources</option>
              {members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.name}</option>)}
              <option value="joint">Joint / unregistered</option>
            </select></label>}
            <label><span>Movement</span><select aria-label="Movement" value={movementFilter} onChange={(event) => setMovementFilter(event.target.value as MovementKind | "all")}>
              <option value="all">All movements</option>
              {MOVEMENT_OPTIONS.map((option) => <option value={option.kind} key={option.kind}>{option.label}</option>)}
            </select></label>
            <label><span>Account</span><select aria-label="Account" value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
              <option value="all">All accounts</option>
              {accountsInMonth.map((account) => <option value={account} key={account}>{account}</option>)}
            </select></label>
          </div>
          {hasFilters && (
            <div className="filter-chips" aria-label="Active ledger filters">
              {filters.category !== "all" && <Button variant="primary" type="button" onClick={() => onFiltersChange({ ...filters, category: "all" })}>{categoryLabel(filters.category)} ×</Button>}
              {beneficiaryFilterLabel && <Button variant="primary" type="button" onClick={() => onFiltersChange({ ...filters, beneficiary: "all" })}>{beneficiaryFilterLabel} ×</Button>}
              {payerFilterLabel && <Button variant="primary" type="button" onClick={() => onFiltersChange({ ...filters, payer: "all" })}>{payerFilterLabel} ×</Button>}
              {filters.merchant && <Button variant="primary" type="button" onClick={() => onFiltersChange({ ...filters, merchant: undefined })}>Merchant: {filters.merchant} ×</Button>}
              {filters.spendOnly && <Button variant="primary" type="button" onClick={() => onFiltersChange({ ...filters, spendOnly: undefined })}>Recorded spend only ×</Button>}
              {filters.dateFrom && <Button variant="primary" type="button" onClick={() => onFiltersChange({ ...filters, dateFrom: undefined })}>From {filters.dateFrom} ×</Button>}
              {filters.dateTo && <Button variant="primary" type="button" onClick={() => onFiltersChange({ ...filters, dateTo: undefined })}>To {filters.dateTo} ×</Button>}
              {accountFilter !== "all" && <Button variant="primary" type="button" onClick={() => setAccountFilter("all")}>Account: {accountFilter} ×</Button>}
              {movementFilter !== "all" && <Button variant="primary" type="button" onClick={() => setMovementFilter("all")}>{movementInfo(movementFilter).label} ×</Button>}
              <button type="button" className="clear-filter-button" onClick={clearAllFilters}>Clear all</button>
            </div>
          )}
        </div>
    </>
  );
}


function TransactionsBody({ model }: { model: TransactionsViewModel }) {
  const {
    summary, money, transactionMoney, financialValuesHidden, onResetClassification, onUnlinkCommitment,
    onSplit, onRemove, onOpenImport, onAddTransaction, linkedIncome, setSelectedTransactionId,
    pendingDelete, setPendingDelete, categoryLabel, beneficiaryLabel, counterpartyName, visible,
    selectedTransaction, clearAllFilters, canReset, confirmRemove, deleteWarning, controls,
    accountControl, contributionControl,
  } = model;
  return (
    <div className="household-home">
      <TransactionReviewSections model={model} />

      <section className="panel transactions-panel">
        <div className="section-title ledger-heading">
          <div>
            <h3>Monthly transactions</h3>
            <p className="muted">Full ledger: {visible.length} rows. <MoneyValue formatted={money(spendTotal(visible))} hidden={financialValuesHidden} /> counts as spend; credits and transfers remain visible but are excluded.</p>
          </div>
        </div>
        <TransactionFilterBar model={model} />
        {!visible.length && (
          <EmptyState
            eyebrow={summary.monthTransactions.length ? "No matching activity" : "No recorded activity"}
            title={summary.monthTransactions.length ? "No transactions match these filters" : `No activity in ${monthLabel(summary.month)}`}
            compact
            action={summary.monthTransactions.length ? (
              <Button variant="secondary" onClick={clearAllFilters}>Clear filters</Button>
            ) : (
              <div className="empty-state-actions">
                {onOpenImport && <Button variant="secondary" onClick={onOpenImport}>Import activity</Button>}
                {onAddTransaction && <Button variant="primary" onClick={onAddTransaction}>Add transaction</Button>}
              </div>
            )}
          >
            <p>{summary.monthTransactions.length
              ? "Clear or adjust the active filters to bring ledger rows back into view."
              : "Import a statement or add a transaction to start this month’s ledger."}</p>
          </EmptyState>
        )}
        {!!visible.length && <>
        <div className="table-wrap ledger-table">
          <table>
            <colgroup>
              <col className="ledger-col-date" />
              <col className="ledger-col-description" />
              <col className="ledger-col-account" />
              <col className="ledger-col-classification" />
              <col className="ledger-col-net" />
              <col className="ledger-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Account</th>
                <th>Purpose / who it was for</th>
                <th className="right">Net</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((txn) => {
                const badge = movementInfo(txn.kind).badge;
                return (
                  <tr key={txn.id}>
                    <td>{txn.date}</td>
                    <td>
                      <button type="button" className="transaction-open-button" onClick={() => setSelectedTransactionId(txn.id)}>
                        <strong>{txn.description}</strong>
                        <span>Open details</span>
                      </button>
                      {badge && <small className="movement-badge">{badge}{counterpartyName(txn.counterpartyId) ? ` · ${counterpartyName(txn.counterpartyId)}` : ""}</small>}
                      {linkedIncome.has(txn.id) && <small className="movement-badge income-linked-badge">Linked income evidence</small>}
                      {txn.note && <small>{txn.note}</small>}
                    </td>
                    <td><span className="transaction-account">{txn.account}</span></td>
                    <td>
                      <div className="classification-summary">
                        <span>{categoryLabel(txn.category)}</span>
                        <small>{beneficiaryLabel(txn.beneficiary)} · {movementInfo(txn.kind).label}</small>
                      </div>
                    </td>
                    <td className="right">
                      <strong className={txn.direction === "credit" ? "credit-amount" : ""}>
                        {!financialValuesHidden && txn.direction === "credit" ? "+" : ""}<MoneyValue formatted={transactionMoney(txn, netAmount(txn))} hidden={financialValuesHidden} />
                      </strong>
                      {txn.split && <small>{txn.split.mine}/{txn.split.of} of <MoneyValue formatted={transactionMoney(txn, txn.amount)} hidden={financialValuesHidden} /></small>}
                    </td>
                    <td className="row-actions">
                      <IconButton label={`Open details for ${txn.description}`} icon={ChevronRight} onClick={() => setSelectedTransactionId(txn.id)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="transaction-cards">
          {visible.map((txn) => (
            <article className="transaction-card" key={txn.id}>
              <button type="button" className="transaction-card-open" onClick={() => setSelectedTransactionId(txn.id)}>
                <span className="transaction-card-copy">
                  <strong>{txn.description}</strong>
                  <small>{txn.date} · {txn.account}</small>
                  <span>{categoryLabel(txn.category)} · {beneficiaryLabel(txn.beneficiary)}</span>
                </span>
                <span className="transaction-card-value">
                  <b className={txn.direction === "credit" ? "credit-amount" : ""}>
                    {!financialValuesHidden && txn.direction === "credit" ? "+" : ""}<MoneyValue formatted={transactionMoney(txn, netAmount(txn))} hidden={financialValuesHidden} />
                  </b>
                  <ChevronRight size={18} aria-hidden="true" />
                </span>
              </button>
            </article>
          ))}
        </div>
        </>}
      </section>

      {selectedTransaction && (
        <Modal
          title={selectedTransaction.description}
          meta={`${selectedTransaction.date} · ${selectedTransaction.account}`}
          variant="drawer"
          onClose={() => setSelectedTransactionId(null)}
        >
          <div className="transaction-detail">
            <div className="transaction-detail-amount">
              <span>{movementInfo(selectedTransaction.kind).label}</span>
              <strong className={selectedTransaction.direction === "credit" ? "credit-amount" : ""}>
                {!financialValuesHidden && selectedTransaction.direction === "credit" ? "+" : ""}<MoneyValue formatted={transactionMoney(selectedTransaction, netAmount(selectedTransaction))} hidden={financialValuesHidden} />
              </strong>
              {selectedTransaction.split && <small>{selectedTransaction.split.mine}/{selectedTransaction.split.of} of <MoneyValue formatted={transactionMoney(selectedTransaction, selectedTransaction.amount)} hidden={financialValuesHidden} /></small>}
            </div>

            <section className="drawer-section">
              <h3>Account</h3>
              {accountControl(selectedTransaction)}
            </section>

            <section className="drawer-section">
              <h3>Classification</h3>
              {controls(selectedTransaction)}
              {needsClassificationReview(selectedTransaction)
                ? <StatusBadge tone="warning">Needs review</StatusBadge>
                : <StatusBadge tone="success">Classified</StatusBadge>}
            </section>

            {(selectedTransaction.note || linkedIncome.has(selectedTransaction.id) || contributionControl(selectedTransaction)) && (
              <section className="drawer-section">
                <h3>Context</h3>
                {selectedTransaction.note && <p>{selectedTransaction.note}</p>}
                {linkedIncome.has(selectedTransaction.id) && <StatusBadge tone="info">Linked income evidence</StatusBadge>}
                {contributionControl(selectedTransaction)}
              </section>
            )}

            <section className="drawer-section transaction-detail-actions">
              <h3>Actions</h3>
              <Button variant="secondary" onClick={() => onSplit(selectedTransaction)}><Scissors size={17} aria-hidden="true" /> Split transaction</Button>
              {selectedTransaction.commitmentId && (
                <Button variant="secondary" onClick={() => {
                  onUnlinkCommitment(selectedTransaction.id);
                  setSelectedTransactionId(null);
                }}>
                  <RotateCcw size={17} aria-hidden="true" /> Unlink from commitment
                </Button>
              )}
              {canReset(selectedTransaction) && (
                <Button variant="secondary" onClick={() => { onResetClassification(selectedTransaction.id); setSelectedTransactionId(null); }}>
                  <RotateCcw size={17} aria-hidden="true" /> Return to review
                </Button>
              )}
              <Button variant="danger" onClick={() => { confirmRemove(selectedTransaction); setSelectedTransactionId(null); }}>
                <Trash2 size={17} aria-hidden="true" /> Delete transaction
              </Button>
            </section>
          </div>
        </Modal>
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="Delete transaction"
          confirmLabel="Delete transaction"
          onClose={() => setPendingDelete(null)}
          onConfirm={() => {
            onRemove(pendingDelete.id);
            setPendingDelete(null);
            setSelectedTransactionId(null);
          }}
        >
          <p>{deleteWarning(pendingDelete)}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

export function TransactionsView(props: Parameters<typeof useTransactionsViewModel>[0]) {
  return <TransactionsBody model={useTransactionsViewModel(props)} />;
}

/** One review card teaches both independent classification axes. */
function ReviewCard({
  item,
  members,
  accounts,
  assetHoldings,
  customCategories,
  counterparties,
  money,
  financialValuesHidden,
  onCategorize,
}: {
  item: ReviewItem;
  members: Member[];
  accounts: Account[];
  assetHoldings: AssetHolding[];
  customCategories: CustomCategory[];
  counterparties: Counterparty[];
  money: (value: number) => string;
  financialValuesHidden: boolean;
  onCategorize: (merchant: string, rule: MerchantRule) => void;
}) {
  // A one-member household has no "for whom?" question: the account default
  // resolves to that member, so review only asks for purpose.
  const solo = members.length === 1;
  const defaults = reviewControlDefaults(item);
  const [kind, setKind] = useState<MovementKind>(defaults.kind);
  const [showMovement, setShowMovement] = useState(defaults.kind !== "expense");
  const [counterpartyId, setCounterpartyId] = useState(defaults.counterpartyId);
  const [holdingId, setHoldingId] = useState(defaults.holdingId);
  const [category, setCategory] = useState<CategoryKey>(defaults.category);
  const [beneficiary, setBeneficiary] = useState<RuleBeneficiaryValue>(defaults.beneficiary);
  const canApply = reviewControlsComplete({ kind, category, beneficiary, counterpartyId, holdingId }, solo);

  const apply = () => onCategorize(item.merchant, ruleFromControls(kind, category, beneficiary, counterpartyId, solo, holdingId));

  const transactionLabel = `${item.count} transaction${item.count === 1 ? "" : "s"}`;
  const accountContextLabel = (context: ReviewItem["accountContexts"][number]) => {
    const registered = context.accountId ? accounts.find((account) => account.id === context.accountId) : undefined;
    const accountLabel = registered?.label.trim() || context.account || "Unmatched statement account";
    if (!registered) return `${accountLabel}${context.count > 1 ? ` ×${context.count}` : ""}`;
    const owner = registered.owner === "joint"
      ? "Joint"
      : registered.owner === "unassigned"
        ? "Paid-from owner needs review"
        : members.find((member) => member.id === registered.owner)?.name ?? "Former member";
    return `${accountLabel} · ${owner}${context.count > 1 ? ` ×${context.count}` : ""}`;
  };

  return (
    <article className="review-card merchant-review-card">
      <div className="review-card-summary">
        <span className="review-merchant" title={item.merchant}>{item.merchant}</span>
        <small>{transactionLabel} · <MoneyValue formatted={money(item.total)} hidden={financialValuesHidden} /></small>
        <div className="review-account-contexts">
          <span>Paid from:</span>
          <span>{item.accountContexts.map(accountContextLabel).join("; ")}</span>
        </div>
        {item.suggestedCategorySource === "seed" && (
          <small className="muted">Purpose suggested from Mizan's starter list — check it before saving.</small>
        )}
      </div>
      <div className="review-fields">
        {showMovement && (
          <label className="review-field">
            <span>Movement</span>
            <select aria-label={`Movement for ${item.merchant}`} value={kind} onChange={(event) => setKind(event.target.value as MovementKind)}>
              {MOVEMENT_OPTIONS.map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}
            </select>
          </label>
        )}
        {kindNeedsCategory(kind) && (
          <label className="review-field">
            <span>Purpose</span>
            <select aria-label={`Category for ${item.merchant}`} value={category} onChange={(event) => setCategory(event.target.value as CategoryKey)}>
              <option value="uncategorized" disabled>Choose purpose</option>
              {spendingCategoryOptions(customCategories).map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>
        )}
        {isSpendKind(kind) && !solo && (
          <label className="review-field">
            <span>Who it was for</span>
            <select
              aria-label={`Who it was for: ${item.merchant}`}
              value={beneficiary}
              onChange={(event) => setBeneficiary(event.target.value as RuleBeneficiaryValue)}
            >
              <option value="unassigned" disabled>Choose who it was for</option>
              <option value="account_default">Use account default</option>
              <option value="household">Household</option>
              {members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.name}</option>)}
            </select>
          </label>
        )}
        {kindNeedsCounterparty(kind) && (
          <label className="review-field">
            <span>Other person</span>
            <select aria-label={`Person for ${item.merchant}`} value={counterpartyId} onChange={(event) => setCounterpartyId(event.target.value)}>
              <option value="">Optional</option>
              {counterparties.map((counterparty) => <option key={counterparty.id} value={counterparty.id}>{counterparty.name}</option>)}
            </select>
          </label>
        )}
        {kind === "investment_transfer" && (
          <label className="review-field">
            <span>Asset holding</span>
            <select aria-label={`Asset holding for ${item.merchant}`} value={holdingId} onChange={(event) => setHoldingId(event.target.value)}>
              <option value="">Choose holding</option>
              {assetHoldings.filter((holding) => holding.status !== "closed").map((holding) => (
                <option value={holding.id} key={holding.id}>{holding.label}</option>
              ))}
            </select>
          </label>
        )}
        {!showMovement && (
          <button
            type="button"
            className="link-button"
            aria-label={`Change movement for ${item.merchant}`}
            onClick={() => setShowMovement(true)}
          >
            Change movement
          </button>
        )}
      </div>
      <button
        type="button"
        className="review-apply-button"
        aria-label={`Save merchant default for ${item.merchant}`}
        disabled={!canApply}
        onClick={apply}
      >
        <span>Save merchant default</span>
        <small>Apply to {transactionLabel}</small>
      </button>
    </article>
  );
}
