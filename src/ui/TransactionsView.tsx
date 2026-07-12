import { useEffect, useState } from "react";
import { RotateCcw, Scissors, Trash2 } from "lucide-react";
import { categoryOptions, spendingCategoryOptions } from "../domain/categories";
import { contributionReferencesTransaction, recoveryRowsForContribution } from "../domain/contributions";
import { kindAllowedFor, kindNeedsCategory, kindNeedsCounterparty, movementInfo, MOVEMENT_OPTIONS } from "../domain/movements";
import { netAmount, spendTotal, type MonthSummary, type ReviewItem } from "../domain/summary";
import type { TransferCandidate } from "../domain/transfers";
import { defaultKind, personalMemberId, type Account, type CategoryKey, type Counterparty, type CustomCategory, type MerchantRule, type Member, type MovementKind, type SharedContribution, type Transaction } from "../domain/types";
import { IconButton } from "./bits";

export function TransactionsView({
  summary,
  members,
  accounts,
  customCategories,
  counterparties,
  queue,
  transferCandidates,
  undoLabel,
  categoryFilter,
  onCategoryFilter,
  money,
  transactionMoney,
  onSetCategory,
  onSetKind,
  onSetCounterparty,
  onSetAccount,
  onCategorizeMerchant,
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
  categoryFilter: CategoryKey | "all";
  onCategoryFilter: (value: CategoryKey | "all") => void;
  money: (value: number) => string;
  transactionMoney: (txn: Transaction, value: number) => string;
  onSetCategory: (id: string, category: CategoryKey) => void;
  onSetKind: (id: string, kind: MovementKind) => void;
  onSetCounterparty: (id: string, counterpartyId: string | undefined) => void;
  onSetAccount: (id: string, accountId: string) => void;
  onCategorizeMerchant: (merchant: string, rule: MerchantRule) => void;
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
  const visible = summary.monthTransactions.filter(
    (txn) =>
      (categoryFilter === "all" || txn.category === categoryFilter) &&
      (accountFilter === "all" || txn.account === accountFilter) &&
      (movementFilter === "all" || txn.kind === movementFilter),
  );

  const counterpartyName = (id: string | undefined) => (id ? (counterparties.find((cp) => cp.id === id)?.name ?? "") : "");
  const canReset = (txn: Transaction) =>
    txn.category !== "uncategorized" || txn.kind !== defaultKind(txn.direction) || Boolean(txn.counterpartyId);
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
    const funded = contributions.filter((item) => recoveryRowsForContribution(item, contributionTransactions).some((expense) => expense.id === txn.id));
    const evidence = contributions.find((item) => item.transferDebitTransactionId === txn.id || item.transferCreditTransactionId === txn.id);
    if (!funded.length && !evidence && !(txn.kind === "loan_payment" && !personalMemberId(txn.category))) return null;
    return (
      <div className="contribution-links">
        {funded.map((item) => {
          const member = members.find((candidate) => candidate.id === item.contributorMemberId);
          return (
            <button className="link-button" key={item.id} onClick={() => onEditContribution?.(item)}>
              {member?.name ?? "Member"} funded {money(item.amount)}
            </button>
          );
        })}
        {evidence && <small className="movement-badge">Contribution evidence</small>}
        {txn.kind === "loan_payment" && !personalMemberId(txn.category) && !funded.length && (
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
        <section className="friendly-section review-strip">
          <div className="friendly-heading">
            <div>
              <span className="soft-label">Review queue</span>
              <h3>Teach Mizan these merchants</h3>
            </div>
            <p>Pick what kind of movement it is, then a category. Mizan creates a rule and applies it to matching transactions; the recent-change panel can undo it. This queue covers every month, not just the one selected below — a statement period usually spans two.</p>
          </div>
          <div className="review-list">
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
            <select value={categoryFilter} onChange={(event) => onCategoryFilter(event.target.value as CategoryKey | "all")}>
              <option value="all">All categories</option>
              {allOptions.map((option) => (
                <option value={option.key} key={option.key}>{option.label}</option>
              ))}
            </select>
            <select value={movementFilter} onChange={(event) => setMovementFilter(event.target.value as MovementKind | "all")}>
              <option value="all">All movements</option>
              {MOVEMENT_OPTIONS.map((option) => (
                <option value={option.kind} key={option.kind}>{option.label}</option>
              ))}
            </select>
            <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
              <option value="all">All accounts</option>
              {accountsInMonth.map((account) => (
                <option value={account} key={account}>{account}</option>
              ))}
            </select>
          </div>
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
                <th>Movement</th>
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
                      {linkedIncome.has(txn.id) && <small className="movement-badge income-linked-badge">Counted as income</small>}
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
              {linkedIncome.has(txn.id) && <small className="movement-badge income-linked-badge">Counted as income</small>}
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

/** One review-queue card: lead with category, with movement details on demand. */
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
  const [kind, setKind] = useState<MovementKind>("expense");
  const [showType, setShowType] = useState(false);
  const [counterpartyId, setCounterpartyId] = useState("");
  const needsCategory = kindNeedsCategory(kind);
  const needsCounterparty = kindNeedsCounterparty(kind);

  const apply = (category: CategoryKey) =>
    onCategorize(item.merchant, {
      category,
      kind,
      ...(needsCounterparty && counterpartyId ? { counterpartyId } : {}),
    });

  return (
    <div className="review-card">
      <div>
        <span className="review-merchant">{item.merchant}</span>
        <small>{item.count}x - {money(item.total)}</small>
      </div>
      <div className="movement-controls">
        {!showType && kind === "expense" ? (
          <>
            <select aria-label={`Category for ${item.merchant}`} value="uncategorized" onChange={(event) => apply(event.target.value as CategoryKey)}>
              <option value="uncategorized" disabled>Choose category...</option>
              {spendingOptions.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
            <button type="button" className="link-button" onClick={() => setShowType(true)}>Not an expense?</button>
          </>
        ) : (
          <>
            <select aria-label={`Movement for ${item.merchant}`} value={kind} onChange={(event) => setKind(event.target.value as MovementKind)}>
              {MOVEMENT_OPTIONS.map((option) => (
                <option key={option.kind} value={option.kind}>{option.label}</option>
              ))}
            </select>
            {needsCounterparty && (
              <select aria-label={`Person for ${item.merchant}`} value={counterpartyId} onChange={(event) => setCounterpartyId(event.target.value)}>
                <option value="">Who?</option>
                {counterparties.map((cp) => (
                  <option key={cp.id} value={cp.id}>{cp.name}</option>
                ))}
              </select>
            )}
            {needsCategory ? (
              <select aria-label={`Category for ${item.merchant}`} value="uncategorized" onChange={(event) => apply(event.target.value as CategoryKey)}>
                <option value="uncategorized" disabled>Choose category...</option>
                {spendingOptions.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            ) : (
              <button onClick={() => apply("uncategorized")}>Apply</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
