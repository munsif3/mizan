import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { csvPresetSignature, headerSignature, inferMapping, mapCsvRows, parseSignedAmount } from "./csvMap";

describe("parseSignedAmount", () => {
  it("reads leading minus, parentheses, and trailing CR as negative", () => {
    expect(parseSignedAmount("1,234.50")).toBe(1234.5);
    expect(parseSignedAmount("-45.00")).toBe(-45);
    expect(parseSignedAmount("(45.00)")).toBe(-45);
    expect(parseSignedAmount("45.00 CR")).toBe(-45);
    expect(parseSignedAmount("$1,000")).toBe(1000);
    expect(parseSignedAmount("")).toBe(0);
  });
});

describe("inferMapping", () => {
  it("detects a single signed-amount column from the header", () => {
    const rows = parseCsv("Date,Description,Amount\n01/07/2026,SHOP,-20");
    const mapping = inferMapping(rows);
    expect(mapping).toMatchObject({ hasHeader: true, dateColumn: 0, descriptionColumn: 1, amountMode: "single", amountColumn: 2 });
  });

  it("detects separate debit/credit columns", () => {
    const rows = parseCsv("Date,Narration,Debit,Credit\n01/07/2026,SHOP,20,");
    const mapping = inferMapping(rows);
    expect(mapping).toMatchObject({ amountMode: "debit_credit", debitColumn: 2, creditColumn: 3 });
  });
});

describe("mapCsvRows", () => {
  it("maps day-first single-amount rows, treating negatives as credits", () => {
    const rows = parseCsv("Date,Description,Amount\n01/07/2026,GROCERIES,-50.00\n02/07/2026,SALARY,3000.00");
    const mapping = inferMapping(rows);
    const { transactions, skipped } = mapCsvRows(rows, mapping, "My CSV Account");
    expect(skipped).toEqual([]);
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({ date: "2026-07-01", description: "GROCERIES", amount: 50, direction: "credit", account: "My CSV Account" });
    expect(transactions[1]).toMatchObject({ date: "2026-07-02", amount: 3000, direction: "debit" });
    expect(transactions.every((transaction) => transaction.beneficiary.type === "unassigned")).toBe(true);
  });

  it("maps month-first dates when told to", () => {
    const rows = parseCsv("Date,Description,Amount\n07/13/2026,SHOP,20");
    const mapping = { ...inferMapping(rows), dateOrder: "mdy" as const };
    const { transactions } = mapCsvRows(rows, mapping, "acct");
    expect(transactions[0]!.date).toBe("2026-07-13");
  });

  it("maps separate debit and credit columns to directions", () => {
    const rows = parseCsv("Date,Narration,Debit,Credit\n01/07/2026,SHOP,20.00,\n02/07/2026,REFUND,,15.00");
    const mapping = inferMapping(rows);
    const { transactions } = mapCsvRows(rows, mapping, "acct");
    expect(transactions[0]).toMatchObject({ amount: 20, direction: "debit" });
    expect(transactions[1]).toMatchObject({ amount: 15, direction: "credit" });
  });

  it("rejects an ambiguous row with both debit and credit values", () => {
    const rows = parseCsv("Date,Narration,Debit,Credit\n01/07/2026,AMBIGUOUS,20.00,15.00");
    const result = mapCsvRows(rows, inferMapping(rows), "acct");
    expect(result.transactions).toEqual([]);
    expect(result.skipped).toEqual([{ row: 2, reason: "both debit and credit amounts are populated" }]);
  });

  it("uses a per-row account column when present, else the fallback", () => {
    const rows = parseCsv("Date,Description,Amount,Account\n01/07/2026,SHOP,20,Visa 1234\n02/07/2026,SHOP,20,");
    const mapping = inferMapping(rows);
    const { transactions } = mapCsvRows(rows, mapping, "Fallback");
    expect(transactions[0]!.account).toBe("Visa 1234");
    expect(transactions[1]!.account).toBe("Fallback");
  });

  it("skips rows with an unrecognized date and reports them", () => {
    const rows = parseCsv("Date,Description,Amount\nnope,SHOP,20\n01/07/2026,OK,20");
    const { transactions, skipped } = mapCsvRows(rows, inferMapping(rows), "acct");
    expect(transactions).toHaveLength(1);
    expect(skipped).toEqual([{ row: 2, reason: "unrecognized date" }]);
  });

  it("computes a stable header signature", () => {
    const a = headerSignature(parseCsv("Date, Description ,Amount\n1,2,3"));
    const b = headerSignature(parseCsv("date,description,amount\nx,y,z"));
    expect(a).toBe(b);
  });

  it("uses the column count rather than the first data row for headerless presets", () => {
    expect(csvPresetSignature(parseCsv("01/07/2026,SHOP,20"), false))
      .toBe(csvPresetSignature(parseCsv("02/07/2026,OTHER,30"), false));
  });
});
