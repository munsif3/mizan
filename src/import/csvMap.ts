import { toISODateOrdered } from "../domain/dates";
import type { CsvMapping, Transaction } from "../domain/types";
import { makeImportedTransaction } from "./importedTransaction";

export interface CsvMapResult {
  transactions: Transaction[];
  skipped: { row: number; reason: string }[];
}

/** A stable key for a CSV's shape — its lowercased header row joined by "|". */
export function headerSignature(rows: string[][]): string {
  return (rows[0] ?? []).map((cell) => cell.trim().toLowerCase()).join("|");
}

/** Stable preset key for both headered and headerless exports. */
export function csvPresetSignature(rows: string[][], hasHeader: boolean): string {
  if (hasHeader) return `header:${headerSignature(rows)}`;
  return `headerless:${Math.max(0, ...rows.map((row) => row.length))}`;
}

export function isCsvMapping(value: unknown): value is CsvMapping {
  if (!value || typeof value !== "object") return false;
  const mapping = value as Partial<CsvMapping>;
  const index = (candidate: unknown) => Number.isInteger(candidate) && Number(candidate) >= 0;
  if (typeof mapping.hasHeader !== "boolean" || !index(mapping.dateColumn) || !index(mapping.descriptionColumn)) return false;
  if (mapping.dateOrder !== "dmy" && mapping.dateOrder !== "mdy" && mapping.dateOrder !== "ymd") return false;
  if (mapping.accountColumn != null && !index(mapping.accountColumn)) return false;
  if (mapping.amountMode === "single") {
    return index(mapping.amountColumn)
      && (mapping.signConvention === "negative_is_credit"
        || mapping.signConvention === "positive_is_credit"
        || mapping.signConvention === "all_debits");
  }
  return mapping.amountMode === "debit_credit" && index(mapping.debitColumn) && index(mapping.creditColumn);
}

/** A sign-aware amount parser: leading "-", "(1,200)" parentheses, and a trailing "CR" all mean negative. */
export function parseSignedAmount(value: unknown): number {
  let text = String(value ?? "").trim();
  if (!text) return 0;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (/cr$/i.test(text)) negative = true;
  const cleaned = text.replace(/[^0-9.\-]/g, "");
  const number = Number(cleaned);
  if (!Number.isFinite(number)) return 0;
  return negative ? -Math.abs(number) : number;
}

/** Best-guess column mapping from the header row's names. */
export function inferMapping(rows: string[][]): CsvMapping {
  const header = (rows[0] ?? []).map((cell) => cell.trim().toLowerCase());
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  const dateColumn = Math.max(0, find(/date/));
  const descriptionColumn = Math.max(0, find(/desc|narrat|detail|payee|memo|particular|reference/));
  const debitColumn = find(/debit|withdraw/);
  const creditColumn = find(/credit|deposit/);
  const amountColumn = find(/amount|value/);
  const accountColumn = find(/account|card/);
  const hasHeader = header.some((h) => /date|desc|amount|debit|credit|payee|narrat/.test(h));

  if (debitColumn >= 0 && creditColumn >= 0) {
    return {
      hasHeader,
      dateColumn,
      dateOrder: "dmy",
      descriptionColumn,
      amountMode: "debit_credit",
      debitColumn,
      creditColumn,
      ...(accountColumn >= 0 ? { accountColumn } : {}),
    };
  }
  return {
    hasHeader,
    dateColumn,
    dateOrder: "dmy",
    descriptionColumn,
    amountMode: "single",
    amountColumn: amountColumn >= 0 ? amountColumn : Math.max(0, header.length - 1),
    signConvention: "negative_is_credit",
    ...(accountColumn >= 0 ? { accountColumn } : {}),
  };
}

/** Apply a mapping to parsed CSV rows, producing transactions and a skip log. */
export function mapCsvRows(rows: string[][], mapping: CsvMapping, fallbackAccount: string): CsvMapResult {
  if (!isCsvMapping(mapping)) throw new Error("The saved CSV mapping is incomplete or invalid.");
  const body = mapping.hasHeader ? rows.slice(1) : rows;
  const transactions: Transaction[] = [];
  const skipped: { row: number; reason: string }[] = [];

  body.forEach((cells, index) => {
    const rowNumber = index + (mapping.hasHeader ? 2 : 1);
    const date = toISODateOrdered(cells[mapping.dateColumn], mapping.dateOrder);
    if (!date) {
      skipped.push({ row: rowNumber, reason: "unrecognized date" });
      return;
    }
    const description = String(cells[mapping.descriptionColumn] ?? "").trim();
    if (!description) {
      skipped.push({ row: rowNumber, reason: "missing description" });
      return;
    }

    let amount: number;
    let direction: Transaction["direction"];
    if (mapping.amountMode === "debit_credit") {
      const debit = Math.abs(parseSignedAmount(cells[mapping.debitColumn ?? -1]));
      const credit = Math.abs(parseSignedAmount(cells[mapping.creditColumn ?? -1]));
      if (debit > 0 && credit > 0) {
        skipped.push({ row: rowNumber, reason: "both debit and credit amounts are populated" });
        return;
      }
      if (debit > 0) {
        amount = debit;
        direction = "debit";
      } else if (credit > 0) {
        amount = credit;
        direction = "credit";
      } else {
        skipped.push({ row: rowNumber, reason: "no debit or credit amount" });
        return;
      }
    } else {
      const raw = parseSignedAmount(cells[mapping.amountColumn ?? -1]);
      if (!raw) {
        skipped.push({ row: rowNumber, reason: "no amount" });
        return;
      }
      const convention = mapping.signConvention ?? "negative_is_credit";
      if (convention === "all_debits") {
        direction = "debit";
      } else if (convention === "positive_is_credit") {
        direction = raw > 0 ? "credit" : "debit";
      } else {
        direction = raw < 0 ? "credit" : "debit";
      }
      amount = Math.abs(raw);
    }

    const account =
      mapping.accountColumn != null
        ? String(cells[mapping.accountColumn] ?? "").trim() || fallbackAccount
        : (mapping.accountLabel ?? "").trim() || fallbackAccount;

    transactions.push(makeImportedTransaction({
      date,
      description,
      amount,
      account,
      direction,
    }));
  });

  return { transactions, skipped };
}
