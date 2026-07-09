/**
 * Parse CSV text into a grid of string cells (RFC 4180): handles quoted fields,
 * escaped quotes (""), embedded commas/newlines inside quotes, and CRLF or LF
 * line endings. Deterministic and dependency-free. Fully blank lines are
 * dropped; every other row is kept as-is (ragged rows are allowed).
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, ""); // strip a leading BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < source.length) {
    const char = source[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    if (char === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  // Flush any trailing field/row not terminated by a newline.
  if (field.length > 0 || row.length > 0) pushRow();

  // Drop fully-blank lines (a single empty field with nothing else).
  return rows.filter((cells) => !(cells.length === 1 && cells[0]!.trim() === ""));
}
