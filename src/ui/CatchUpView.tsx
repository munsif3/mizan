import { Check, Upload } from "lucide-react";
import { computeAccountCoverage, statementDayForAccount, type AccountCoverageRow } from "../domain/accountCoverage";
import { isoDateOf } from "../domain/dates";
import type { MonthSummary, Transfer } from "../domain/summary";
import type { Account, Member, Transaction } from "../domain/types";
import type { AccountCoverageConfirmation } from "./AccountCoverageConfirm";
import { Button, MoneyValue } from "./bits";

function dateLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date || "not confirmed";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1)));
}

function ordinal(day: number): string {
  const remainder = day % 100;
  if (remainder >= 11 && remainder <= 13) return `${day}th`;
  if (day % 10 === 1) return `${day}st`;
  if (day % 10 === 2) return `${day}nd`;
  if (day % 10 === 3) return `${day}rd`;
  return `${day}th`;
}

function daysSince(confirmedAt: string | undefined, today: Date): number | null {
  if (!confirmedAt) return null;
  const timestamp = Date.parse(confirmedAt);
  if (!Number.isFinite(timestamp)) return null;
  const confirmed = new Date(timestamp);
  const todayStart = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const confirmedStart = Date.UTC(confirmed.getFullYear(), confirmed.getMonth(), confirmed.getDate());
  return Math.max(0, Math.floor((todayStart - confirmedStart) / 86_400_000));
}

function ownerMember(row: AccountCoverageRow, members: Member[]): Member | undefined {
  return members.find((member) => member.id === row.account.owner);
}

function accountTransactions(account: Account, transactions: Transaction[]): Transaction[] {
  return transactions.filter((transaction) => transaction.accountId === account.id
    || (!transaction.accountId && transaction.account.trim().toLocaleLowerCase() === account.label.trim().toLocaleLowerCase()));
}

function accountSubline(
  row: AccountCoverageRow,
  transactions: Transaction[],
  today: Date,
): string {
  const count = accountTransactions(row.account, transactions).length;
  const statementDay = statementDayForAccount(row.account);
  if (row.status !== "current") {
    const readTo = row.throughDate ? `Read to ${dateLabel(row.throughDate)}` : "Not confirmed yet";
    const usual = statementDay ? `statement usually arrives the ${ordinal(statementDay)}` : "statement arrival day not learned yet";
    return `${readTo} · ${usual}`;
  }
  const addedDays = daysSince(row.account.coverage?.confirmedAt, today);
  const added = addedDays === null
    ? "coverage confirmed"
    : `added ${addedDays} day${addedDays === 1 ? "" : "s"} ago`;
  return `Read to ${dateLabel(row.throughDate)} · ${added} · ${count} row${count === 1 ? "" : "s"}`;
}

function CoverageRow({
  row,
  members,
  transactions,
  today,
  onOpenImport,
  onConfirmCoverage,
}: {
  row: AccountCoverageRow;
  members: Member[];
  transactions: Transaction[];
  today: Date;
  onOpenImport: (accountId: string) => void;
  onConfirmCoverage: (confirmations: AccountCoverageConfirmation[], source?: "statement" | "manual") => void;
}) {
  const member = ownerMember(row, members);
  const initial = member?.name.trim().charAt(0).toUpperCase() || row.ownerLabel.trim().charAt(0).toUpperCase() || "?";
  const behind = row.status !== "current";
  return (
    <article className={`catch-up-account-row ${behind ? "behind" : "current"}`} data-account-id={row.account.id}>
      <span
        className="catch-up-owner-avatar"
        style={{ background: member?.color ?? "var(--ql-brand)" }}
        title={row.ownerLabel}
        aria-label={row.ownerLabel}
      >
        {initial}
      </span>
      <div className="catch-up-account-copy">
        <strong>{row.account.label}</strong>
        <span className={behind ? "catch-up-behind-copy" : undefined}>
          {accountSubline(row, transactions, today)}
        </span>
      </div>
      {behind ? (
        <div className="catch-up-account-actions">
          <Button variant="primary" onClick={() => onOpenImport(row.account.id)}>
            <Upload size={15} aria-hidden="true" />
            Add it
          </Button>
          <Button
            variant="secondary"
            onClick={() => onConfirmCoverage([
              { accountId: row.account.id, throughDate: isoDateOf(today) },
            ], "manual")}
          >
            Nothing new
          </Button>
        </div>
      ) : (
        <span className="catch-up-current-pill"><Check size={13} strokeWidth={3} aria-hidden="true" />Current</span>
      )}
    </article>
  );
}

function PredictionCard({
  summary,
  transactionCount,
  money,
  financialValuesHidden,
}: {
  summary: MonthSummary;
  transactionCount: number;
  money: (value: number) => string;
  financialValuesHidden: boolean;
}) {
  const merchantCount = summary.reviewQueueCount;
  const transfer: Transfer | undefined = summary.transfers[0];
  return (
    <section className="catch-up-prediction-card">
      <span className="mz-eyebrow">When this one lands</span>
      <div className="catch-up-predictions">
        <div><i aria-hidden="true" /><span>The hollow segment on Balance closes and the save rate stops carrying an asterisk.</span></div>
        <div>
          <i aria-hidden="true" />
          <span>
            Roughly <strong>{merchantCount} new merchant{merchantCount === 1 ? "" : "s"}</strong> will need naming
            {merchantCount > 0 ? ` — about ${merchantCount * 5} seconds` : ""}.
          </span>
        </div>
        <div><i aria-hidden="true" /><span>Duplicates against the {transactionCount.toLocaleString("en")} rows you already have are dropped automatically.</span></div>
        {transfer && (
          <div className="catch-up-danger-prediction">
            <i aria-hidden="true" />
            <span>
              Settlement may move. {transfer.fromName} currently owes {transfer.toName}{" "}
              <strong><MoneyValue formatted={money(transfer.amount)} hidden={financialValuesHidden} /></strong> — don&apos;t settle until this is in.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

export function CatchUpView({
  accounts,
  members,
  transactions,
  summary,
  money,
  financialValuesHidden = false,
  today = new Date(),
  onOpenImport,
  onConfirmCoverage,
}: {
  accounts: Account[];
  members: Member[];
  transactions: Transaction[];
  summary: MonthSummary;
  money: (value: number) => string;
  financialValuesHidden?: boolean;
  today?: Date;
  onOpenImport: (accountId?: string) => void;
  onConfirmCoverage: (confirmations: AccountCoverageConfirmation[], source?: "statement" | "manual") => void;
}) {
  const rows = computeAccountCoverage(accounts, members, today);
  const currentCount = rows.filter((row) => row.status === "current").length;
  const behindCount = rows.length - currentCount;
  const month = monthLabel(today);
  const hollowLabel = behindCount === 0
    ? "all boxes closed"
    : `${behindCount} hollow box${behindCount === 1 ? "" : "es"} left to close`;

  return (
    <main className="catch-up-view">
      <header className="catch-up-header">
        <div className="catch-up-header-copy">
          <span className="mz-eyebrow">Catch up · step 1 of the weekly close</span>
          <h1 className="mz-display-l">
            {currentCount} of your {rows.length} account{rows.length === 1 ? "" : "s"} are read through {month}.
          </h1>
          <p className="mz-body">Statements arrive on a schedule. Mizan learned yours, so it can tell you what&apos;s late instead of waiting to be asked.</p>
        </div>
        <div className="catch-up-progress" aria-label={`${currentCount} of ${rows.length} accounts current`}>
          <div className="catch-up-progress-boxes">
            {rows.map((row) => <span key={row.account.id} className={row.status === "current" ? "filled" : "hollow"} />)}
          </div>
          <span>{hollowLabel}</span>
        </div>
      </header>

      <div className="catch-up-layout">
        <div className="catch-up-account-list">
          {rows.map((row) => (
            <CoverageRow
              key={row.account.id}
              row={row}
              members={members}
              transactions={transactions}
              today={today}
              onOpenImport={(accountId) => onOpenImport(accountId)}
              onConfirmCoverage={onConfirmCoverage}
            />
          ))}
          <button
            type="button"
            className="catch-up-dropzone"
            onClick={() => onOpenImport()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              onOpenImport();
            }}
          >
            <Upload size={26} strokeWidth={1.7} aria-hidden="true" />
            <strong>Drop any statement here</strong>
            <span>PDF, CSV, or the encrypted files your banks send. Decryption happens on this device — Mizan never uploads the file or the password.</span>
          </button>
        </div>

        <div className="catch-up-side-column">
          <PredictionCard
            summary={summary}
            transactionCount={transactions.length}
            money={money}
            financialValuesHidden={financialValuesHidden}
          />
        </div>
      </div>
    </main>
  );
}
