import { describe, expect, it } from "vitest";
import {
  assertBackupFile,
  assertBackupPlaintext,
  assertBackupText,
  assertCsvRowCount,
  assertPdfPageCount,
  assertStatementFiles,
  MAX_BACKUP_FILE_BYTES,
  MAX_BACKUP_PLAINTEXT_CHARACTERS,
  MAX_BACKUP_TEXT_CHARACTERS,
  MAX_CSV_ROWS,
  MAX_PDF_PAGES,
  MAX_STATEMENT_FILE_BYTES,
  MAX_STATEMENT_FILES,
  MAX_STATEMENT_TOTAL_BYTES,
} from "./resourceLimits";

const sizedFile = (name: string, size: number) => ({ name, size });

describe("local resource limits", () => {
  it("accepts ordinary statement batches and rejects count, file, and aggregate excess", () => {
    expect(() => assertStatementFiles([sizedFile("statement.pdf", 1024)])).not.toThrow();
    expect(() => assertStatementFiles(Array.from({ length: MAX_STATEMENT_FILES + 1 }, (_, index) => sizedFile(`${index}.pdf`, 1))))
      .toThrow(/at most/i);
    expect(() => assertStatementFiles([sizedFile("large.pdf", MAX_STATEMENT_FILE_BYTES + 1)])).toThrow(/larger/i);
    const chunk = Math.floor(MAX_STATEMENT_TOTAL_BYTES / 6);
    expect(() => assertStatementFiles(Array.from({ length: 7 }, (_, index) => sizedFile(`${index}.pdf`, chunk))))
      .toThrow(/combined/i);
  });

  it("bounds CSV rows and PDF pages", () => {
    expect(() => assertCsvRowCount(MAX_CSV_ROWS)).not.toThrow();
    expect(() => assertCsvRowCount(MAX_CSV_ROWS + 1)).toThrow(/rows/i);
    expect(() => assertPdfPageCount(MAX_PDF_PAGES)).not.toThrow();
    expect(() => assertPdfPageCount(MAX_PDF_PAGES + 1)).toThrow(/pages/i);
  });

  it("bounds backup files and parsed text", () => {
    expect(() => assertBackupFile(sizedFile("backup.json", MAX_BACKUP_FILE_BYTES))).not.toThrow();
    expect(() => assertBackupFile(sizedFile("backup.json", MAX_BACKUP_FILE_BYTES + 1))).toThrow(/larger/i);
    expect(() => assertBackupText("x".repeat(32))).not.toThrow();
    expect(() => assertBackupText("x".repeat(MAX_BACKUP_TEXT_CHARACTERS + 1))).toThrow(/exceeds/i);
    expect(() => assertBackupPlaintext("x".repeat(MAX_BACKUP_PLAINTEXT_CHARACTERS + 1))).toThrow(/payload exceeds/i);
  });
});
