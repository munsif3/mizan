import { describe, expect, it } from "vitest";
import { reconstructTable } from "./pdfTable";
import type { PdfCell, PdfLine } from "./pdfText";

function cell(x: number, width: number, text: string): PdfCell {
  return { x, width, text };
}

function line(y: number, cells: PdfCell[]): PdfLine {
  return { y, cells: cells.map((item) => item.text), positioned: cells };
}

/**
 * A statement laid out the way a real one is: date and description left-aligned,
 * amount and balance right-aligned against a fixed right edge, so their left
 * edges move with the width of each number.
 */
function rightAligned(rightEdge: number, text: string, charWidth = 5): PdfCell {
  const width = text.length * charWidth;
  return cell(rightEdge - width, width, text);
}

describe("reconstructTable", () => {
  it("keeps a right-aligned amount column together despite moving left edges", () => {
    const lines = [
      line(700, [cell(50, 45, "05/06/2026"), cell(120, 90, "THE FAB COLOMBO 03"), rightAligned(400, "1,100.00")]),
      line(680, [cell(50, 45, "15/06/2026"), cell(120, 60, "DIALOG AXIATA"), rightAligned(400, "200.00")]),
      line(660, [cell(50, 45, "21/06/2026"), cell(120, 70, "KEELLS SUPER"), rightAligned(400, "12,450.75")]),
    ];

    const table = reconstructTable(lines);

    expect(table.bands).toHaveLength(3);
    expect(table.rows).toEqual([
      ["05/06/2026", "THE FAB COLOMBO 03", "1,100.00"],
      ["15/06/2026", "DIALOG AXIATA", "200.00"],
      ["21/06/2026", "KEELLS SUPER", "12,450.75"],
    ]);
  });

  it("joins a description split across several text runs into one column", () => {
    // pdf.js emits runs, not words or cells: one description can arrive in pieces.
    const lines = [
      line(700, [
        cell(50, 45, "05/06/2026"),
        cell(120, 30, "THE"),
        cell(152, 26, "FAB"),
        cell(180, 40, "COLOMBO"),
        rightAligned(400, "1,100.00"),
      ]),
    ];

    expect(reconstructTable(lines).rows).toEqual([["05/06/2026", "THE FAB COLOMBO", "1,100.00"]]);
  });

  it("does not let a page-wide banner bridge two real columns", () => {
    // The banner spans the date and description columns. Merging spans would
    // glue them into one column for the whole statement; coverage counting means
    // one banner line cannot outvote the body.
    const body = Array.from({ length: 10 }, (_, index) => line(700 - index * 20, [
      cell(50, 45, `0${index}/06/2026`),
      cell(120, 90, "THE FAB COLOMBO"),
      rightAligned(400, "1,100.00"),
    ]));
    const lines = [line(720, [cell(50, 160, "Statement of account")]), ...body];

    const table = reconstructTable(lines);

    expect(table.bands).toHaveLength(3);
    // Row 0 is the banner; row 1 is the first body row.
    expect(table.rows[1]).toEqual(["00/06/2026", "THE FAB COLOMBO", "1,100.00"]);
  });

  it("pads every row to the same column count", () => {
    // Header and footer junk has fewer runs; the mapper drops those rows for
    // having no parseable date, but only if the matrix is rectangular first.
    const body = Array.from({ length: 10 }, (_, index) => line(700 - index * 20, [
      cell(50, 45, `0${index}/06/2026`),
      cell(120, 90, "THE FAB"),
      rightAligned(400, "1,100.00"),
    ]));
    const lines = [line(720, [cell(120, 60, "Page 1 of 3")]), ...body];

    const table = reconstructTable(lines);

    expect(table.rows.every((row) => row.length === table.bands.length)).toBe(true);
    expect(table.rows[0]).toEqual(["", "Page 1 of 3", ""]);
  });

  it("separates adjacent columns but not words inside one", () => {
    const lines = [
      line(700, [
        cell(50, 20, "ONE"),
        cell(72, 20, "TWO"), // 2pt gap: same column
        cell(200, 20, "FAR"), // 108pt gap: its own column
      ]),
    ];

    const table = reconstructTable(lines);

    expect(table.bands).toHaveLength(2);
    expect(table.rows[0]).toEqual(["ONE TWO", "FAR"]);
  });

  it("survives next month's statement but not a different bank's layout", () => {
    // The saved mapping has to be found again next month, when every amount has
    // a different width and so a different left edge.
    const statement = (amount: string, dateColumnX: number, rightEdge: number) =>
      Array.from({ length: 10 }, (_, index) => line(700 - index * 20, [
        cell(dateColumnX, 45, `0${index}/06/2026`),
        cell(dateColumnX + 70, 90, "THE FAB"),
        rightAligned(rightEdge, amount),
      ]));

    const june = reconstructTable(statement("1,100.00", 50, 400)).signature;
    const july = reconstructTable(statement("980.00", 50, 400)).signature;
    const otherBank = reconstructTable(statement("1,100.00", 140, 300)).signature;

    expect(july).toBe(june);
    expect(otherBank).not.toBe(june);
    expect(june).toMatch(/^pdf:3:/);
  });

  it("returns nothing rather than a bogus table for empty or noisy input", () => {
    expect(reconstructTable([])).toEqual({ rows: [], bands: [], signature: "" });

    // Every run in its own column is scattered text, not a table.
    const noise = [line(700, Array.from({ length: 60 }, (_, index) => cell(index * 50, 4, `${index}`)))];
    expect(reconstructTable(noise).rows).toEqual([]);
  });

  it("drops rows that reconstruct to nothing", () => {
    const lines = [
      line(700, [cell(50, 45, "05/06/2026"), rightAligned(400, "1,100.00")]),
      line(690, []),
    ];

    expect(reconstructTable(lines).rows).toHaveLength(1);
  });
});
