import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { dfccPdfParser, parseLines } from "./dfccPdf";
import type { PdfLine } from "./pdfText";

function line(y: number, ...cells: string[]): PdfLine {
  return { y, cells };
}

async function generatedLegacyStatement(): Promise<File> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([600, 800]);
  const row = (y: number, cells: { x: number; text: string }[]) => {
    for (const cell of cells) page.drawText(cell.text, { x: cell.x, y, size: 10, font });
  };

  row(700, [{ x: 20, text: "512345******6789 - 000011112222 - SAMPLE HOLDER" }]);
  row(670, [
    { x: 20, text: "09/12/2025" },
    { x: 100, text: "05/12/2025" },
    { x: 190, text: "LEGACY MARKET" },
    { x: 500, text: "580.00" },
  ]);
  row(658, [
    { x: 20, text: "09/12/2025" },
    { x: 100, text: "08/12/2025" },
    { x: 190, text: "Credit Transfer" },
    { x: 470, text: "12,345.67 (CR)" },
  ]);

  const data = Uint8Array.from(await pdf.save()).buffer;
  const file = new File([data], "legacy-dfcc.pdf", { type: "application/pdf" });
  // jsdom's File shim does not implement arrayBuffer(), while the browser does.
  Object.defineProperty(file, "arrayBuffer", { value: async () => data.slice(0) });
  return file;
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
    expect(txns.every((t) => t.beneficiary.type === "unassigned")).toBe(true);

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

  it("parses the sanitized historical layout without depending on its front matter", () => {
    const lines: PdfLine[] = [
      line(550, "CREDIT CARD STATEMENT"),
      line(528, "Statement Period", "2025-12-07 TO 2026-01-06"),
      line(502, "512345******6789 - 000011112222 - SAMPLE HOLDER"),
      // Historical rows are 11-12 PDF units apart, but are still identified by their own strict shape.
      line(448, "09/12/2025", "05/12/2025", "LEGACY MARKET", "CITY CENTER", "580.00"),
      line(436, "09/12/2025", "08/12/2025", "Credit Transfer", "12,345.67 (CR)"),
      line(425, "10/12/2025", "09/12/2025", "TRANSIT PASS", "700.00"),
      line(414, "512345******6789 SUB TOTAL - DEBITS", "1,280.00"),
    ];

    const txns = parseLines(lines, "fallback");
    expect(txns).toHaveLength(3);
    expect(txns.every((txn) => txn.account === "DFCC 512345******6789")).toBe(true);
    expect(txns[0]).toMatchObject({
      date: "2025-12-05",
      description: "LEGACY MARKET CITY CENTER",
      amount: 580,
      direction: "debit",
    });
    expect(txns[1]).toMatchObject({
      date: "2025-12-08",
      description: "Credit Transfer",
      amount: 12345.67,
      direction: "credit",
      kind: "account_credit",
    });
  });

  it("opens, extracts, parses, and tears down a generated PDF repeatedly", async () => {
    const file = await generatedLegacyStatement();

    const first = await dfccPdfParser.parse(file, "");
    const second = await dfccPdfParser.parse(file, "");

    expect(first).toHaveLength(2);
    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({
      date: "2025-12-05",
      description: "LEGACY MARKET",
      amount: 580,
      account: "DFCC 512345******6789",
      direction: "debit",
    });
    expect(first[1]).toMatchObject({
      date: "2025-12-08",
      description: "Credit Transfer",
      amount: 12345.67,
      direction: "credit",
    });
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
