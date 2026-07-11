import { describe, expect, it } from "vitest";
import { parseLines } from "./dfccPdf";
import type { PdfLine } from "./pdfText";

function line(y: number, ...cells: string[]): PdfLine {
  return { y, cells };
}

describe("parseLines", () => {
  it("extracts debits and inline-CR payments, joins a wrapped description line, and finds the account from the statement banner", () => {
    // y-spacing matches a real statement: ~14-15 units between transaction rows, ~9 for a genuine wrap.
    const lines: PdfLine[] = [
      // trilingual header: verified real layout has no single row with every English label
      line(540, ".sKqï .; l< Èkh", ".kqfokq l< Èkh", ".kqfokqfõ úia;rh", "/ Transaction Description", ".kqfokqfõ", "jákdlu"),
      line(531, "Post Date", "Transaction Date", "nfhLf;fy; thq;fy; tpguk;", "Transaction Amount"),
      line(523, "gpy; jpfjp", "nfhLf;fy; thq;fy; jpfjp", "nfhLf;fy; thq;fy; nra;j njhif"),
      line(502, "489099******0001 - 000011112222 - ALEX EXAMPLE"),
      line(486, "07/06/2026", "05/06/2026", "THE FAB", "COLOMBO 03", "1,100.00"),
      line(472, "08/06/2026", "08/06/2026", "FX FEE Google YouTube", "32.52"),
      line(463, "6502530000-ADJUSTMENT"), // wrapped continuation of the row above, no date cells
      line(448, "13/06/2026", "13/06/2026", "Credit Transfer", "70,710.29 (CR)"),
      line(433, "16/06/2026", "15/06/2026", "Dialog Axiata PLC", "Colombo 02", "200.00"),
      line(418, "489099******0001 SUB TOTAL - DEBITS", "1,332.52"),
    ];

    const txns = parseLines(lines, "fallback");
    expect(txns).toHaveLength(4);
    expect(txns.every((t) => t.account === "DFCC 489099******0001")).toBe(true);

    expect(txns[0]).toMatchObject({ date: "2026-06-05", description: "THE FAB COLOMBO 03", amount: 1100 });
    expect(txns[1]).toMatchObject({
      date: "2026-06-08",
      description: "FX FEE Google YouTube 6502530000-ADJUSTMENT",
      amount: 32.52,
    });
    expect(txns[2]).toMatchObject({
      date: "2026-06-13",
      description: "Credit Transfer",
      amount: 70710.29,
      direction: "credit",
      kind: "account_credit",
    });
    expect(txns[3]).toMatchObject({ date: "2026-06-15", description: "Dialog Axiata PLC Colombo 02", amount: 200 });
  });

  it("does not attach a continuation line across a non-transaction row", () => {
    const lines: PdfLine[] = [
      line(486, "07/06/2026", "05/06/2026", "THE FAB", "1,100.00"),
      line(472, "489099******0001 SUB TOTAL - DEBITS", "1,100.00"), // two cells: not a lone-cell continuation
      line(458, "stray text that should not attach to anything"),
    ];
    const txns = parseLines(lines, "fallback");
    expect(txns).toHaveLength(1);
    expect(txns[0]!.description).toBe("THE FAB");
  });

  it("does not attach a lone-cell line that's far below the transaction row (e.g. a page footer)", () => {
    const lines: PdfLine[] = [
      line(486, "07/06/2026", "05/06/2026", "THE FAB", "1,100.00"),
      // A real wrap sits ~9 units below; this is 40 units below, well past MAX_CONTINUATION_GAP —
      // consistent with a page-footer/disclaimer line separated from the table by extra whitespace.
      line(446, "Page 1 of 4"),
    ];
    const txns = parseLines(lines, "fallback");
    expect(txns).toHaveLength(1);
    expect(txns[0]!.description).toBe("THE FAB");
  });

  it("throws a clear error when no rows match the DD/MM/YYYY DD/MM/YYYY ... amount shape", () => {
    expect(() => parseLines([line(0, "hi", "there", "friend")], "x")).toThrow(/could not find a transaction table/i);
  });
});
