import { useEffect, useState } from "react";
import { ChevronRight, RotateCcw, Scissors, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { ownerOfTransaction } from "../domain/accounts";
import { categoryOptions } from "../domain/categories";
import { contributionReferencesTransaction } from "../domain/contributions";
import { monthLabel } from "../domain/dates";
import { kindAllowedFor, kindNeedsCategory, kindNeedsCounterparty, movementInfo, MOVEMENT_OPTIONS } from "../domain/movements";
import { cleanMerchant } from "../domain/rules";
import { isSpend, needsClassificationReview, netAmount, spendTotal, type MonthSummary } from "../domain/summary";
import { defaultKind, type Account, type AssetHolding, type CategoryKey, type Counterparty, type CustomCategory, type Member, type MovementKind, type SharedContribution, type SpendBeneficiary, type Transaction } from "../domain/types";
import { Button, ConfirmDialog, EmptyState, IconButton, Modal, MoneyValue, StatusBadge } from "./bits";

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
  onRememberMerchant,
  onResetClassification,
  onUnlinkCommitment = () => undefined,
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
  onRememberMerchant: (id: string) => void;
  onResetClassification: (id: string) => void;
  onUnlinkCommitment?: (id: string) => void;
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
    summary, members, accounts, assetHoldings, customCategories, counterparties,
    filters, onFiltersChange, money, transactionMoney, financialValuesHidden, solo,
    onResetClassification, onUnlinkCommitment,
    onSplit, onRemove, onOpenImport, onAddTransaction, linkedIncome,
    allOptions, accountFilter, setAccountFilter, movementFilter, setMovementFilter,
    filtersOpen, setFiltersOpen, setSelectedTransactionId,
    pendingDelete, setPendingDelete, accountsInMonth, categoryLabel,
    beneficiaryLabel, counterpartyName, visible, beneficiaryFilterLabel, payerFilterLabel,
    hasFilters, filterCount, selectedTransaction, monthEnd, clearAllFilters, canReset,
    confirmRemove, deleteWarning, controls, accountControl, contributionControl,
  };
}

type TransactionsViewModel = ReturnType<typeof useTransactionsViewModel>;

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
