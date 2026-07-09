import { useEffect, useState } from "react";
import { categoryOptions, spendingCategoryOptions } from "../domain/categories";
import { netAmount, spendTotal, type MonthSummary, type ReviewItem } from "../domain/summary";
import type { CategoryKey, Member, Transaction } from "../domain/types";

export function TransactionsView({
  summary,
  members,
  queue,
  categoryFilter,
  onCategoryFilter,
  money,
  onSetCategory,
  onCategorizeMerchant,
  onSplit,
  onRemove,
}: {
  summary: MonthSummary;
  members: Member[];
  queue: ReviewItem[];
  categoryFilter: CategoryKey | "all";
  onCategoryFilter: (value: CategoryKey | "all") => void;
  money: (value: number) => string;
  onSetCategory: (id: string, category: CategoryKey) => void;
  onCategorizeMerchant: (merchant: string, category: CategoryKey) => void;
  onSplit: (txn: Transaction) => void;
  onRemove: (id: string) => void;
}) {
  const spendingOptions = spendingCategoryOptions(members);
  const allOptions = categoryOptions(members);
  const [accountFilter, setAccountFilter] = useState("all");
  useEffect(() => {
    setAccountFilter("all");
  }, [summary.month]);
  const accountsInMonth = [...new Set(summary.monthTransactions.map((txn) => txn.account))].sort();
  const visible = summary.monthTransactions.filter(
    (txn) =>
      (categoryFilter === "all" || txn.category === categoryFilter) &&
      (accountFilter === "all" || txn.account === accountFilter),
  );

  return (
    <div className="couple-home">
      {queue.length > 0 && (
        <section className="friendly-section review-strip">
          <div className="friendly-heading">
            <div>
              <span className="soft-label">Review queue</span>
              <h3>Teach Mizan these merchants</h3>
            </div>
            <p>Pick a category once — a rule is created and applied to every matching transaction, past and future.</p>
          </div>
          <div className="review-list">
            {queue.map((item) => (
              <div key={item.merchant}>
                <span className="review-merchant">{item.merchant}</span>
                <small>{item.count}× · {money(item.total)}</small>
                <select
                  value="uncategorized"
                  onChange={(event) => onCategorizeMerchant(item.merchant, event.target.value as CategoryKey)}
                >
                  <option value="uncategorized" disabled>Choose category…</option>
                  {spendingOptions.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <h3>Monthly transactions</h3>
        <div className="table-toolbar">
          <div className="toolbar-filters">
            <select value={categoryFilter} onChange={(event) => onCategoryFilter(event.target.value as CategoryKey | "all")}>
              <option value="all">All categories</option>
              {allOptions.map((option) => (
                <option value={option.key} key={option.key}>{option.label}</option>
              ))}
            </select>
            <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
              <option value="all">All accounts</option>
              {accountsInMonth.map((account) => (
                <option value={account} key={account}>{account}</option>
              ))}
            </select>
          </div>
          <span>
            {visible.length} rows, {money(spendTotal(visible))}
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Account</th>
                <th>Category</th>
                <th className="right">Net</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((txn) => (
                <tr key={txn.id}>
                  <td>{txn.date}</td>
                  <td>
                    <strong>{txn.description}</strong>
                    {txn.note && <small>{txn.note}</small>}
                  </td>
                  <td>{txn.account}</td>
                  <td>
                    <select value={txn.category} onChange={(event) => onSetCategory(txn.id, event.target.value as CategoryKey)}>
                      {allOptions.map((option) => (
                        <option key={option.key} value={option.key}>{option.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="right">
                    <strong className={txn.direction === "credit" ? "credit-amount" : ""}>
                      {txn.direction === "credit" ? "+" : ""}{money(netAmount(txn))}
                    </strong>
                    {txn.split && <small>{txn.split.mine}/{txn.split.of} of {money(txn.amount)}</small>}
                  </td>
                  <td className="row-actions">
                    <button className="icon" title="Split" onClick={() => onSplit(txn)}>/</button>
                    <button className="icon danger" title="Delete" onClick={() => onRemove(txn.id)}>x</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
