import { defaultKind, uid, type Transaction } from "../domain/types";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

interface ConsumerTransaction {
  txId?: number;
  postDate?: string;
  txDate?: string;
  description?: string;
  txCurrency?: string;
  txAmount?: number;
  txConvertedAmount?: number;
  crDr?: string;
}

interface CardBlock {
  cardNo?: string;
  primaryCardStatus?: string;
  consumerTransactions?: ConsumerTransaction[];
}

/**
 * NTB's card statement builds its transaction table at render time from a JS
 * variable (`cardTransactionsDataList`), not static `<table>` rows — the
 * `<tbody>` is empty in the decrypted HTML. This isolates that variable's
 * array literal by balanced-bracket scanning (a regex alone can't find where
 * a ~2MB embedded array ends) and parses it as JSON — it's valid JSON, just
 * embedded inside a larger `<script>` block.
 */
function extractJsonArray(html: string, varName: string): unknown[] | null {
  const declIndex = html.indexOf(`var ${varName}`);
  if (declIndex < 0) return null;
  const start = html.indexOf("[", declIndex);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < html.length; i++) {
    if (html[i] === "[") depth++;
    else if (html[i] === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

interface PeriodBoundary {
  day: number;
  month: number; // 0-indexed
  year: number;
}

function parseBoundary(day: string, month: string, year: string): PeriodBoundary | null {
  const monthIndex = MONTHS.indexOf(month.toUpperCase());
  if (monthIndex < 0) return null;
  return { day: Number(day), month: monthIndex, year: Number(year) };
}

/** e.g. `var statementPeriod = "24-May-2026 to 23-Jun-2026" ;` */
function extractStatementPeriod(html: string): { start: PeriodBoundary; end: PeriodBoundary } | null {
  const match = html.match(
    /statementPeriod\s*=\s*"(\d{1,2})-([A-Za-z]{3})-(\d{4})\s*to\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})"/,
  );
  if (!match) return null;
  const start = parseBoundary(match[1]!, match[2]!, match[3]!);
  const end = parseBoundary(match[4]!, match[5]!, match[6]!);
  if (!start || !end) return null;
  return { start, end };
}

/** Every (month, year) pair the statement period spans, in order. */
function monthYearsInPeriod(period: { start: PeriodBoundary; end: PeriodBoundary }): Map<number, number> {
  const map = new Map<number, number>();
  let { month, year } = period.start;
  for (let guard = 0; guard < 24; guard++) {
    map.set(month, year);
    if (month === period.end.month && year === period.end.year) break;
    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }
  return map;
}

/** "25 MAY" (no year) resolved against the statement period's month/year map. */
function resolveShortDate(shortDate: string | undefined, monthYears: Map<number, number>): string {
  const match = String(shortDate ?? "")
    .trim()
    .match(/^(\d{1,2})\s+([A-Za-z]{3})$/);
  if (!match) return "";
  const day = Number(match[1]);
  const monthIndex = MONTHS.indexOf(match[2]!.toUpperCase());
  const year = monthYears.get(monthIndex);
  if (monthIndex < 0 || year == null || !day) return "";
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parses NTB's card (Amex) statement from its embedded `cardTransactionsDataList`
 * data. Debit and credit rows are both retained: purchases are spend, while
 * payments/refunds remain visible account credits and can pair with the paying
 * bank-account leg. `txDate` has no year of its own, so it's resolved against
 * the statement's own period.
 */
export function parseCardStatement(html: string, fallbackAccount: string): Transaction[] {
  const cardBlocks = extractJsonArray(html, "cardTransactionsDataList") as CardBlock[] | null;
  if (!cardBlocks) {
    throw new Error("Decrypted the file, but could not find card transaction data in a known format.");
  }
  const period = extractStatementPeriod(html);
  const monthYears = period ? monthYearsInPeriod(period) : new Map<number, number>();

  const transactions: Transaction[] = [];
  for (const block of cardBlocks) {
    const account = block.cardNo ? `NTB ${block.cardNo}` : fallbackAccount;
    for (const txn of block.consumerTransactions ?? []) {
      if (txn.crDr !== "Dr" && txn.crDr !== "Cr") continue;
      const date = resolveShortDate(txn.txDate, monthYears);
      const description = (txn.description ?? "").trim();
      const amount = Math.abs(Number(txn.txConvertedAmount));
      if (!date || !description || !amount || amount < 0) continue;
      const direction = txn.crDr === "Cr" ? "credit" : "debit";
      transactions.push({
        id: uid("txn"),
        date,
        description,
        amount: Number(amount.toFixed(2)),
        category: "uncategorized",
        account,
        note: "",
        source: "imported",
        direction,
        kind: defaultKind(direction),
      });
    }
  }

  if (!transactions.length) {
    throw new Error("Decrypted the file, but found no card transactions to import.");
  }
  return transactions;
}
