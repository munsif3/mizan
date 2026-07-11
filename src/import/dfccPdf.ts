import { toISODate } from "../domain/dates";
import { parseAmount } from "../domain/money";
import { defaultKind, uid, type Transaction } from "../domain/types";
import { extractLines, openPdf, type PdfLine } from "./pdfText";
import type { StatementParser } from "./types";

const DATE_CELL = /^\d{2}\/\d{2}\/\d{4}$/;
const STOP_WORD = /^(sub\s*total|total|opening balance|closing balance)/i;
// Verified against a real statement: consecutive transaction rows sit ~14-15
// PDF-space units apart; a genuine wrapped-description continuation line sits
// closer (~9) beneath its parent. A page footer/disclaimer line, by contrast,
// typically has extra whitespace before it and lands well outside this gap —
// this bounds the continuation heuristic to lines that are actually adjacent,
// on top of the STOP_WORD denylist below.
const MAX_CONTINUATION_GAP = 12;

/**
 * Verified against a real DFCC statement. Two things rule out a
 * header-driven column heuristic like the other parsers use:
 *  - There's no DR/CR column — a single trailing "Transaction Amount" cell
 *    carries credits (payments, transfers in) as an inline "(CR)" suffix,
 *    which `parseAmount` already reads as negative.
 *  - The header is trilingual (Sinhala/English/Tamil) across three stacked
 *    lines per column, and which line carries the English label isn't
 *    consistent column-to-column (verified: "Transaction Description"
 *    lands on a different line than "Post Date"/"Transaction Date"/
 *    "Transaction Amount") — there's no single row containing all the
 *    English headers to search for.
 * So transaction rows are recognized by their own shape instead: the first
 * two cells are DD/MM/YYYY dates (post date, transaction date), the last
 * cell is the amount, everything between is the description. A long
 * description sometimes wraps onto its own line with no date cells at all
 * (verified: "6502530000-ADJUSTMENT" following a "FX FEE Google YouTube"
 * row) — a lone-cell line right after a transaction row is treated as a
 * continuation of that transaction's description, not a new row.
 */
export function parseLines(lines: PdfLine[], fallbackAccount: string): Transaction[] {
  const fullText = lines.map((line) => line.cells.join(" ")).join("\n");
  // e.g. "489099******0001 - 000011112222 - ALEX EXAMPLE"
  const banner = fullText.match(/(\d{4,6}\*+\d{4})\s*-\s*\d+\s*-\s*[A-Z .]+/);
  const account = banner ? `DFCC ${banner[1]}` : fallbackAccount;

  const transactions: Transaction[] = [];
  let pending: Transaction | null = null;
  let pendingY = 0;

  for (const line of lines) {
    const cells = line.cells;
    if (cells.length >= 3 && DATE_CELL.test(cells[0] ?? "") && DATE_CELL.test(cells[1] ?? "")) {
      pending = null;
      const date = toISODate(cells[1]); // transaction date, not post date
      const description = cells.slice(2, -1).join(" ").trim();
      const signedAmount = parseAmount(cells[cells.length - 1]);
      if (!date || !description) continue;
      if (!signedAmount) continue;
      const direction = signedAmount < 0 ? "credit" : "debit";
      const amount = Math.abs(signedAmount);
      const txn: Transaction = {
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
      };
      transactions.push(txn);
      pending = txn;
      pendingY = line.y;
    } else if (
      pending &&
      cells.length === 1 &&
      !STOP_WORD.test(cells[0] ?? "") &&
      Math.abs(pendingY - line.y) <= MAX_CONTINUATION_GAP
    ) {
      pending.description = `${pending.description} ${cells[0]}`.trim();
      pendingY = line.y;
    } else {
      pending = null;
    }
  }

  if (!transactions.length) {
    throw new Error("Opened the PDF, but could not find a transaction table in a known format.");
  }
  return transactions;
}

async function parse(file: File, password: string): Promise<Transaction[]> {
  const doc = await openPdf(file, password);
  const lines = await extractLines(doc);
  return parseLines(lines, file.name.replace(/\.[^.]+$/, ""));
}

export const dfccPdfParser: StatementParser = {
  id: "dfcc-visa-pdf",
  label: "DFCC (PDF)",
  passwordLabel: "NIC password",
  passwordPlaceholder: "NIC number",
  canHandle: (file) => /\.pdf$/i.test(file.name),
  parse,
};
