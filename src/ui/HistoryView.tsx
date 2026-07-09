import { monthLabel } from "../domain/dates";
import type { HistoryRow } from "../domain/summary";

export function HistoryView({
  rows,
  targetSaveRate,
  money,
}: {
  rows: HistoryRow[];
  targetSaveRate: number;
  money: (value: number) => string;
}) {
  return (
    <section className="ledger-panel history-ledger">
      <span className="panel-kicker">History</span>
      <div className="history-table">
        {rows.map((row) => (
          <div key={row.month}>
            <strong>{monthLabel(row.month)}</strong>
            <span>Spend {money(row.spend)}</span>
            <span>Saved {money(row.saved)}</span>
            <b className={row.rate >= targetSaveRate ? "good-text" : "bad-text"}>{row.rate.toFixed(1)}%</b>
          </div>
        ))}
      </div>
    </section>
  );
}
