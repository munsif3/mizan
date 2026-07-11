import { monthLabel } from "../domain/dates";
import type { HistoryRow } from "../domain/summary";

export function HistoryView({
  rows,
  currentMonth,
  targetSaveRate,
  money,
}: {
  rows: HistoryRow[];
  currentMonth: string;
  targetSaveRate: number;
  money: (value: number) => string;
}) {
  const best = [...rows].sort((a, b) => b.rate - a.rate || a.month.localeCompare(b.month))[0];
  const current = rows.find((row) => row.month === currentMonth) ?? rows[rows.length - 1];
  const averageRate = rows.length ? rows.reduce((sum, row) => sum + row.rate, 0) / rows.length : 0;

  if (!rows.length) {
    return (
      <section className="ledger-panel history-ledger">
        <span className="panel-kicker">History</span>
        <p className="muted">Import or add transactions to build a month-by-month view.</p>
      </section>
    );
  }

  return (
    <div className="history-view">
      <section className="history-summary">
        <div>
          <span className="soft-label">Current month</span>
          <strong className={current && current.rate >= targetSaveRate ? "good-text" : "bad-text"}>
            {current ? `${current.rate.toFixed(1)}%` : "0.0%"}
          </strong>
          <p>{current ? `${monthLabel(current.month)} save rate` : "No current month data yet"}</p>
        </div>
        <div>
          <span className="soft-label">Best month</span>
          <strong>{best ? monthLabel(best.month) : "None"}</strong>
          <p>{best ? `${best.rate.toFixed(1)}% save rate` : "No comparison yet"}</p>
        </div>
        <div>
          <span className="soft-label">Average</span>
          <strong className={averageRate >= targetSaveRate ? "good-text" : "bad-text"}>{averageRate.toFixed(1)}%</strong>
          <p>Target is {targetSaveRate}%</p>
        </div>
      </section>

      <section className="ledger-panel history-ledger">
        <div className="friendly-heading">
          <div>
            <span className="panel-kicker">Trend</span>
            <h3>Month by month</h3>
          </div>
          <p>Target line: {targetSaveRate}%</p>
        </div>
        <div className="history-table">
          {rows.map((row) => (
            <div className={row.month === currentMonth ? "current" : ""} key={row.month}>
              <strong>{monthLabel(row.month)}</strong>
              <span>Income {money(row.income)}</span>
              <span>Spend {money(row.spend)}</span>
              <span>Saved {money(row.saved)}</span>
              <span className="history-rate">
                <i style={{ width: `${Math.max(0, Math.min(100, row.rate))}%` }} />
                <b className={row.rate >= targetSaveRate ? "good-text" : "bad-text"}>{row.rate.toFixed(1)}%</b>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
