import { useEffect, useState } from "react";
import { RotateCcw, Scissors, Trash2 } from "lucide-react";
import { ownerOfTransaction } from "../domain/accounts";
import { categoryOptions, spendingCategoryOptions } from "../domain/categories";
import { contributionReferencesTransaction } from "../domain/contributions";
import { isSpendKind, kindAllowedFor, kindNeedsCategory, kindNeedsCounterparty, movementInfo, MOVEMENT_OPTIONS } from "../domain/movements";
import { cleanMerchant } from "../domain/rules";
import { isSpend, needsClassificationReview, netAmount, spendTotal, type MonthSummary, type ReviewItem } from "../domain/summary";
import type { TransferCandidate } from "../domain/transfers";
import { defaultKind, type Account, type CategoryKey, type Counterparty, type CustomCategory, type MerchantRule, type Member, type MovementKind, type SharedContribution, type SpendBeneficiary, type Transaction } from "../domain/types";
import { IconButton } from "./bits";

export type BeneficiaryFilter = "all" | "household" | "unassigned" | `member:${string}`;
export type PayerFilter = "all" | "joint" | `member:${string}`;

export interface LedgerFilters {
  category: CategoryKey | "all";
  beneficiary: BeneficiaryFilter;
  payer: PayerFilter;
  merchant?: string;
  spendOnly?: boolean;
}

function beneficiaryFilterOf(beneficiary: SpendBeneficiary): Exclude<BeneficiaryFilter, "all"> {
  return beneficiary.type === "member" ? `member:${beneficiary.memberId}` : beneficiary.type;
}

function beneficiaryFromFilter(value: Exclude<BeneficiaryFilter, "all">): SpendBeneficiary {
  return value.startsWith("member:")
    ? { type: "member", memberId: value.slice("member:".length) }
    : { type: value as "household" | "unassigned" };
}

type RuleBeneficiaryValue = "unassigned" | "account_default" | "household" | `member:${string}`;

function ruleBeneficiaryValue(beneficiary: MerchantRule["beneficiary"] | undefined): RuleBeneficiaryValue {
  if (!beneficiary) return "unassigned";
  return beneficiary.type === "member" ? `member:${beneficiary.memberId}` : beneficiary.type;
}

function ruleBeneficiaryFromValue(value: Exclude<RuleBeneficiaryValue, "unassigned">): MerchantRule["beneficiary"] {
  return value.startsWith("member:")
    ? { type: "member", memberId: value.slice("member:".length) }
    : { type: value as "account_default" | "household" };
}

export function TransactionsView({
  summary,
  members,
  accounts,
  customCategories,
  counterparties,
  queue,
  transferCandidates,
  undoLabel,
  filters,
  onFiltersChange,
  money,
  transactionMoney,
  onSetCategory,
  onSetBeneficiary,
  onSetKind,
  onSetCounterparty,
  onSetAccount,
  onCategorizeMerchant,
  onRememberMerchant,
  onUndo,
  onResetClassification,
  onConfirmTransfer,
  onDismissTransfer,
  onSplit,
  onRemove,
  incomeLinkedIds,
  allTransactions,
  sharedContributions,
  onLinkContribution,
  onEditContribution,
}: {
  summary: MonthSummary;
  members: Member[];
  accounts: Account[];
  customCategories: CustomCategory[];
  counterparties: Counterparty[];
  queue: ReviewItem[];
  transferCandidates: TransferCandidate[];
  undoLabel: string;
  filters: LedgerFilters;
  onFiltersChange: (value: LedgerFilters) => void;
  money: (value: number) => string;
  transactionMoney: (txn: Transaction, value: number) => string;
  onSetCategory: (id: string, category: CategoryKey) => void;
  onSetBeneficiary: (id: string, beneficiary: SpendBeneficiary) => void;
  onSetKind: (id: string, kind: MovementKind) => void;
  onSetCounterparty: (id: string, counterpartyId: string | undefined) => void;
  onSetAccount: (id: string, accountId: string) => void;
  onCategorizeMerchant: (merchant: string, rule: MerchantRule) => void;
  onRememberMerchant: (id: string) => void;
  onUndo: () => void;
  onResetClassification: (id: string) => void;
  onConfirmTransfer: (debitId: string, creditId: string) => void;
  onDismissTransfer: (debitId: string, creditId: string) => void;
  onSplit: (txn: Transaction) => void;
  onRemove: (id: string) => void;
  incomeLinkedIds?: Set<string>;
  allTransactions?: Transaction[];
  sharedContributions?: SharedContribution[];
  onLinkContribution?: (expenseId: string) => void;
  onEditContribution?: (contribution: SharedContribution) => void;
}) {
  const linkedIncome = incomeLinkedIds ?? new Set<string>();
  const contributions = sharedContributions ?? [];
  const contributionTransactions = allTransactions ?? summary.monthTransactions;
  const allOptions = categoryOptions(members, customCategories);
  const configuredAccounts = accounts.filter((account) => account.label.trim());
  const [accountFilter, setAccountFilter] = useState("all");
  const [movementFilter, setMovementFilter] = useState<MovementKind | "all">("all");
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
    if (netAmount(txn) - funded > 0.005) values.add(owner === "joint" ? "joint" : `member:${owner}`);
    return [...values];
  };
  const visible = summary.monthTransactions.filter(
    (txn) =>
      (filters.category === "all" || txn.category === filters.category) &&
      (filters.beneficiary === "all" || beneficiaryFilterOf(txn.beneficiary) === filters.beneficiary) &&
      (filters.payer === "all" || payerFiltersFor(txn).includes(filters.payer)) &&
      (!filters.merchant || cleanMerchant(txn.description) === cleanMerchant(filters.merchant)) &&
      (!filters.spendOnly || isSpend(txn)) &&
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
    Boolean(filters.merchant) || Boolean(filters.spendOnly) || accountFilter !== "all" || movementFilter !== "all";

  const counterpartyName = (id: string | undefined) => (id ? (counterparties.find((cp) => cp.id === id)?.name ?? "") : "");
  const canReset = (txn: Transaction) =>
    txn.category !== "uncategorized" || txn.beneficiary.type !== "unassigned" ||
    txn.kind !== defaultKind(txn.direction) || Boolean(txn.counterpartyId) || Boolean(txn.classificationLocked);
  const confirmRemove = (txn: Transaction) => {
    const linkedContribution = contributions.some((item) =>
      contributionReferencesTransaction(item, txn.id, contributionTransactions),
    );
    const linkedWarning = linkedIncome.has(txn.id)
      ? " This credit is linked to an income confirmation; deleting it will keep the receipt but remove its statement link."
      : "";
    const contributionWarning = linkedContribution
      ? " This row is evidence for a shared contribution; deleting it will remove that link and recalculate settlement."
      : "";
    if (window.confirm(`Delete ${txn.description} from the household ledger?${linkedWarning}${contributionWarning} This cannot be undone.`)) {
      onRemove(txn.id);
    }
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
      {isSpend(txn) && (
        <span className="beneficiary-control">
          <select
            aria-label={`Beneficiary for ${txn.description}`}
            value={beneficiaryFilterOf(txn.beneficiary)}
            onChange={(event) => onSetBeneficiary(
              txn.id,
              beneficiaryFromFilter(event.target.value as Exclude<BeneficiaryFilter, "all">),
            )}
          >
            <option value="unassigned">For whom?</option>
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
      {txn.classificationLocked && (
        <button
          type="button"
          className="link-button"
          disabled={needsClassificationReview(txn)}
          onClick={() => onRememberMerchant(txn.id)}
        >
          Remember for merchant
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
              {member?.name ?? "Member"} funded {money(allocatedAmount)}
            </button>
          );
        })}
        {evidence && <small className="movement-badge">Contribution evidence</small>}
        {sharedLoan && !funded.length && (
          <button className="link-button" onClick={() => onLinkContribution?.(txn.id)}>+ Link contribution</button>
        )}
      </div>
    );
  };

  return (
    <div className="household-home">
      {undoLabel && (
        <section className="friendly-section undo-strip">
          <div className="friendly-heading">
            <div>
              <span className="soft-label">Recent ledger change</span>
              <h3>{undoLabel}</h3>
            </div>
            <div className="undo-actions">
              <p>Undo restores the affected rows and merchant rule.</p>
              <button onClick={onUndo}>Undo</button>
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
                  <span className="review-merchant">{money(netAmount(pair.debit))}</span>
                  <small>
                    {pair.debit.account} → {pair.credit.account}
                    {pair.daysApart > 0 ? ` · ${pair.daysApart}d apart` : " · same day"}
                  </small>
                </div>
                <div className="row-actions">
                  <button onClick={() => onConfirmTransfer(pair.debit.id, pair.credit.id)}>Mark as transfer</button>
                  <button className="secondary" onClick={() => onDismissTransfer(pair.debit.id, pair.credit.id)}>Not a transfer</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {queue.length > 0 && (
        <section className="friendly-section review-strip merchant-review-strip">
          <div className="review-queue-heading">
            <div>
              <span className="soft-label">Review queue</span>
              <h3>{queue.length} merchant{queue.length === 1 ? "" : "s"} need a default</h3>
            </div>
            <p>Set purpose and beneficiary once. Matching history and future imports follow that default; one-off ledger edits stay protected.</p>
          </div>
          <div className="review-list merchant-review-list">
            {queue.map((item) => (
              <ReviewCard
                key={item.merchant}
                item={item}
                members={members}
                customCategories={customCategories}
                counterparties={counterparties}
                money={money}
                onCategorize={onCategorizeMerchant}
              />
            ))}
          </div>
        </section>
      )}

      <section className="panel transactions-panel">
        <div className="section-title ledger-heading">
          <div>
            <h3>Monthly transactions</h3>
            <p className="muted">Full ledger: {visible.length} rows. {money(spendTotal(visible))} counts as spend; credits and transfers remain visible but are excluded.</p>
          </div>
        </div>
        <div className="table-toolbar">
          <div className="toolbar-filters" aria-label="Ledger filters">
            <select aria-label="What for" value={filters.category} onChange={(event) => onFiltersChange({ ...filters, category: event.target.value as CategoryKey | "all" })}>
              <option value="all">What for: All</option>
              {allOptions.map((option) => (
                <option value={option.key} key={option.key}>{option.label}</option>
              ))}
            </select>
            <select aria-label="For whom" value={filters.beneficiary} onChange={(event) => onFiltersChange({ ...filters, beneficiary: event.target.value as BeneficiaryFilter })}>
              <option value="all">For whom: All</option>
              <option value="household">Household</option>
              {members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.name}</option>)}
              <option value="unassigned">Unassigned</option>
            </select>
            <select aria-label="Paid from" value={filters.payer} onChange={(event) => onFiltersChange({ ...filters, payer: event.target.value as PayerFilter })}>
              <option value="all">Paid from: All</option>
              {members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.name}</option>)}
              <option value="joint">Joint / unregistered</option>
            </select>
            <select aria-label="Movement" value={movementFilter} onChange={(event) => setMovementFilter(event.target.value as MovementKind | "all")}>
              <option value="all">All movements</option>
              {MOVEMENT_OPTIONS.map((option) => (
                <option value={option.kind} key={option.kind}>{option.label}</option>
              ))}
            </select>
            <select aria-label="Account" value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
              <option value="all">All accounts</option>
              {accountsInMonth.map((account) => (
                <option value={account} key={account}>{account}</option>
              ))}
            </select>
          </div>
          {hasFilters && (
            <div className="filter-chips" aria-label="Active ledger filters">
              {filters.category !== "all" && <span>{allOptions.find((option) => option.key === filters.category)?.label ?? filters.category}</span>}
              {beneficiaryFilterLabel && <span>{beneficiaryFilterLabel}</span>}
              {payerFilterLabel && <span>{payerFilterLabel}</span>}
              {filters.merchant && <span>Merchant: {filters.merchant}</span>}
              {filters.spendOnly && <span>Recorded spend only</span>}
              {accountFilter !== "all" && <span>Account: {accountFilter}</span>}
              {movementFilter !== "all" && <span>{movementInfo(movementFilter).label}</span>}
              <button type="button" className="link-button" onClick={() => {
                onFiltersChange({ category: "all", beneficiary: "all", payer: "all" });
                setAccountFilter("all");
                setMovementFilter("all");
              }}>Clear all</button>
            </div>
          )}
        </div>
        {!visible.length && (
          <div className="ledger-empty-state compact">
            <span className="soft-label">No matching activity</span>
            <h3>The ledger is clear for this view</h3>
            <p>Import or add a transaction, or loosen the active filters to bring rows back into view.</p>
          </div>
        )}
        <div className="table-wrap ledger-table">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Account</th>
                <th>Purpose / beneficiary</th>
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
                      <strong>{txn.description}</strong>
                      {badge && <small className="movement-badge">{badge}{counterpartyName(txn.counterpartyId) ? ` · ${counterpartyName(txn.counterpartyId)}` : ""}</small>}
                      {linkedIncome.has(txn.id) && <small className="movement-badge income-linked-badge">Linked income evidence</small>}
                      {contributionControl(txn)}
                      {txn.note && <small>{txn.note}</small>}
                    </td>
                    <td>{accountControl(txn)}</td>
                    <td>{controls(txn)}</td>
                    <td className="right">
                      <strong className={txn.direction === "credit" ? "credit-amount" : ""}>
                        {txn.direction === "credit" ? "+" : ""}{transactionMoney(txn, netAmount(txn))}
                      </strong>
                      {txn.split && <small>{txn.split.mine}/{txn.split.of} of {transactionMoney(txn, txn.amount)}</small>}
                    </td>
                    <td className="row-actions">
                      <IconButton label={`Split ${txn.description}`} icon={Scissors} onClick={() => onSplit(txn)} />
                      {canReset(txn) && <IconButton label={`Return ${txn.description} to review`} icon={RotateCcw} onClick={() => onResetClassification(txn.id)} />}
                      <IconButton label={`Delete ${txn.description}`} icon={Trash2} danger onClick={() => confirmRemove(txn)} />
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
              <div className="transaction-primary">
                <div>
                  <strong>{txn.description}</strong>
                  <small>{txn.date} - {txn.account}</small>
                </div>
                <b className={txn.direction === "credit" ? "credit-amount" : ""}>
                  {txn.direction === "credit" ? "+" : ""}{transactionMoney(txn, netAmount(txn))}
                </b>
              </div>
              {txn.note && <p>{txn.note}</p>}
              {linkedIncome.has(txn.id) && <small className="movement-badge income-linked-badge">Linked income evidence</small>}
              {contributionControl(txn)}
              {txn.split && <small>{txn.split.mine}/{txn.split.of} of {transactionMoney(txn, txn.amount)}</small>}
              <div className="transaction-card-actions">
                 {accountControl(txn)}
                 {controls(txn)}
                 <IconButton label={`Split ${txn.description}`} icon={Scissors} onClick={() => onSplit(txn)} />
                 {canReset(txn) && <IconButton label={`Return ${txn.description} to review`} icon={RotateCcw} onClick={() => onResetClassification(txn.id)} />}
                 <IconButton label={`Delete ${txn.description}`} icon={Trash2} danger onClick={() => confirmRemove(txn)} />
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

/** One review card teaches both independent classification axes. */
function ReviewCard({
  item,
  members,
  customCategories,
  counterparties,
  money,
  onCategorize,
}: {
  item: ReviewItem;
  members: Member[];
  customCategories: CustomCategory[];
  counterparties: Counterparty[];
  money: (value: number) => string;
  onCategorize: (merchant: string, rule: MerchantRule) => void;
}) {
  const spendingOptions = spendingCategoryOptions(members, customCategories);
  const [kind, setKind] = useState<MovementKind>(item.suggestedKind ?? "expense");
  const [showType, setShowType] = useState(item.suggestedKind !== undefined && item.suggestedKind !== "expense");
  const [counterpartyId, setCounterpartyId] = useState(item.suggestedCounterpartyId ?? "");
  const [category, setCategory] = useState<CategoryKey>(item.suggestedCategory ?? "uncategorized");
  const [beneficiary, setBeneficiary] = useState<RuleBeneficiaryValue>(
    ruleBeneficiaryValue(item.suggestedBeneficiary),
  );
  const needsCategory = kindNeedsCategory(kind);
  const needsCounterparty = kindNeedsCounterparty(kind);
  const spendKind = isSpendKind(kind);
  const canApply = (!needsCategory || category !== "uncategorized") && (!spendKind || beneficiary !== "unassigned");

  const apply = () =>
    onCategorize(item.merchant, {
      category: needsCategory ? category : "uncategorized",
      beneficiary: spendKind
        ? ruleBeneficiaryFromValue(beneficiary as Exclude<RuleBeneficiaryValue, "unassigned">)
        : { type: "unassigned" },
      kind,
      ...(needsCounterparty && counterpartyId ? { counterpartyId } : {}),
    });

  const transactionLabel = `${item.count} transaction${item.count === 1 ? "" : "s"}`;

  return (
    <article className="review-card merchant-review-card">
      <div className="review-card-summary">
        <span className="review-merchant" title={item.merchant}>{item.merchant}</span>
        <small>{transactionLabel} · {money(item.total)}</small>
      </div>
      <div className="review-fields">
        {showType || kind !== "expense" ? (
          <label className="review-field">
            <span>Movement</span>
            <select aria-label={`Movement for ${item.merchant}`} value={kind} onChange={(event) => setKind(event.target.value as MovementKind)}>
              {MOVEMENT_OPTIONS.map((option) => (
                <option key={option.kind} value={option.kind}>{option.label}</option>
              ))}
            </select>
          </label>
        ) : (
          <div className="review-field">
            <span>Movement</span>
            <button type="button" className="review-value-button" onClick={() => setShowType(true)}>
              Expense <small>Change</small>
            </button>
          </div>
        )}
        {needsCategory && (
          <label className="review-field">
            <span>What was it?</span>
            <select aria-label={`Category for ${item.merchant}`} value={category} onChange={(event) => setCategory(event.target.value as CategoryKey)}>
              <option value="uncategorized" disabled>Choose purpose</option>
              {spendingOptions.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>
        )}
        {spendKind && (
          <label className="review-field">
            <span>Who was it for?</span>
            <select aria-label={`Beneficiary for ${item.merchant}`} value={beneficiary} onChange={(event) => setBeneficiary(event.target.value as RuleBeneficiaryValue)}>
              <option value="unassigned" disabled>Choose beneficiary</option>
              <option value="account_default">Use account default</option>
              <option value="household">Household</option>
              {members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.name}</option>)}
            </select>
          </label>
        )}
        {needsCounterparty && (
          <label className="review-field">
            <span>Other person</span>
            <select aria-label={`Person for ${item.merchant}`} value={counterpartyId} onChange={(event) => setCounterpartyId(event.target.value)}>
              <option value="">Optional</option>
              {counterparties.map((cp) => (
                <option key={cp.id} value={cp.id}>{cp.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <button
        type="button"
        className="review-apply-button"
        aria-label={`Save default for ${item.merchant}`}
        disabled={!canApply}
        onClick={apply}
      >
        <span>Save default</span>
        <small>Apply to {transactionLabel}</small>
      </button>
    </article>
  );
}
