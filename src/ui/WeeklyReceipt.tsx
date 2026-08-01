import { Scale, Share2 } from "lucide-react";
import { Button, MoneyValue } from "./bits";

export interface WeeklyReceiptValues {
  weekNumber: number;
  sortedCount: number;
  sortedAmount: number;
  statementAdded: number;
  accountsCurrent: number;
  accountsTotal: number;
  saveRateBefore: number;
  saveRateAfter: number;
  committedMonthlySavings: number;
}

export interface WeeklyReceiptProps extends WeeklyReceiptValues {
  money: (value: number) => string;
  percent: (value: number, digits?: number) => string;
  financialValuesHidden?: boolean;
  solo?: boolean;
  onBack: () => void;
}

function receiptText({
  weekNumber,
  sortedCount,
  sortedAmount,
  statementAdded,
  accountsCurrent,
  accountsTotal,
  saveRateBefore,
  saveRateAfter,
  committedMonthlySavings,
  money,
  percent,
}: WeeklyReceiptProps): string {
  const sortedSentence = sortedCount
    ? `Sorting the ${sortedCount} row${sortedCount === 1 ? "" : "s"} moved ${money(sortedAmount)} out of "unassigned" and into real purposes`
    : "No rows needed sorting this week";
  const statementSentence = statementAdded > 0
    ? `the statements you caught up added ${money(statementAdded)}`
    : "the statements you caught up did not add new spend";
  return [
    `Week ${weekNumber} is closed.`,
    `${sortedSentence}, and ${statementSentence}. Your savings didn't change — the measurement got honest.`,
    `Accounts current: ${accountsCurrent} of ${accountsTotal}. Save rate: ${percent(saveRateBefore)} to ${percent(saveRateAfter)}.`,
    committedMonthlySavings > 0 ? `Committed this week: ${money(committedMonthlySavings)} per month.` : "Nothing committed this week.",
  ].join(" ");
}

export function WeeklyReceipt({
  weekNumber,
  sortedCount,
  sortedAmount,
  statementAdded,
  accountsCurrent,
  accountsTotal,
  saveRateBefore,
  saveRateAfter,
  committedMonthlySavings,
  money,
  percent,
  financialValuesHidden = false,
  solo = false,
  onBack,
}: WeeklyReceiptProps) {
  const shareableText = receiptText({
    weekNumber,
    sortedCount,
    sortedAmount,
    statementAdded,
    accountsCurrent,
    accountsTotal,
    saveRateBefore,
    saveRateAfter,
    committedMonthlySavings,
    money,
    percent,
    financialValuesHidden,
    solo,
    onBack,
  });

  async function shareReceipt() {
    if (typeof navigator !== "undefined" && "share" in navigator && typeof navigator.share === "function") {
      await navigator.share({ title: `Mizan · Week ${weekNumber}`, text: shareableText });
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) await navigator.clipboard.writeText(shareableText);
  }

  return (
    <main className="weekly-receipt" aria-labelledby="weekly-receipt-title">
      <div className="weekly-receipt-inner">
        <div className="weekly-receipt-mark" aria-hidden="true"><Scale size={30} strokeWidth={1.8} /></div>
        <span className="mz-eyebrow">The weekly close · receipt</span>
        <h1 id="weekly-receipt-title" className="mz-display-l">Week {weekNumber} is closed.</h1>

        <div className="weekly-receipt-stats" aria-label="Weekly close results">
          <div><span>Unsorted</span><strong>{sortedCount} → 0</strong></div>
          <div><span>Accounts current</span><strong>{accountsCurrent} of {accountsTotal}</strong></div>
          <div>
            <span>Save rate, now measured</span>
            <strong>{percent(saveRateBefore)} → <em>{percent(saveRateAfter)}</em></strong>
          </div>
          <div>
            <span>Committed this week</span>
            <strong>
              {committedMonthlySavings > 0
                ? <><MoneyValue formatted={money(committedMonthlySavings)} hidden={financialValuesHidden} />/mo</>
                : "Nothing this week"}
            </strong>
          </div>
        </div>

        <div className="weekly-receipt-honesty">
          <span className="weekly-receipt-label">Why the rate moved</span>
          <p>
            {sortedCount > 0
              ? <>Sorting the {sortedCount} row{sortedCount === 1 ? "" : "s"} moved <MoneyValue formatted={money(sortedAmount)} hidden={financialValuesHidden} /> out of &quot;unassigned&quot; and into real purposes,</>
              : <>There were no unsorted rows to move this week,</>}
            {statementAdded > 0
              ? <> and the statements you caught up added <MoneyValue formatted={money(statementAdded)} hidden={financialValuesHidden} />.</>
              : <> and the statements you caught up did not add new spend.</>}
            {" "}Your savings didn&apos;t change — the measurement got honest.
          </p>
        </div>

        <div className="weekly-receipt-actions">
          {!solo && (
            <Button variant="primary" onClick={() => void shareReceipt()}>
              <Share2 size={17} aria-hidden="true" /> Send the receipt
            </Button>
          )}
          <Button variant="ghost" onClick={onBack}>Back to Balance</Button>
        </div>
      </div>
    </main>
  );
}
