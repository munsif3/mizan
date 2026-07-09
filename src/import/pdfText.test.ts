import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { extractLines } from "./pdfText";

async function buildPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 200]);
  const row = (y: number, cells: { x: number; text: string }[]) => {
    for (const cell of cells) page.drawText(cell.text, { x: cell.x, y, size: 12, font });
  };
  // Header row, then one data row, written with each "cell" as a separate drawText
  // call (as a real statement's column layout would produce) to exercise the
  // left-to-right, same-y grouping logic in extractLines.
  row(150, [
    { x: 10, text: "Date" },
    { x: 100, text: "Description" },
    { x: 300, text: "Amount" },
  ]);
  row(120, [
    { x: 10, text: "02/07/2026" },
    { x: 100, text: "KEELLS SUPER" },
    { x: 300, text: "12,450.00" },
  ]);
  return doc.save();
}

describe("extractLines", () => {
  it("reconstructs left-to-right rows from positioned text items", async () => {
    const data = await buildPdf();
    const doc = await getDocument({ data }).promise;
    const lines = await extractLines(doc);

    expect(lines).toHaveLength(2);
    expect(lines[0]!.cells).toEqual(["Date", "Description", "Amount"]);
    expect(lines[1]!.cells).toEqual(["02/07/2026", "KEELLS SUPER", "12,450.00"]);
  });
});
