const MEBIBYTE = 1024 * 1024;

export const MAX_STATEMENT_FILES = 20;
export const MAX_STATEMENT_FILE_BYTES = 20 * MEBIBYTE;
export const MAX_STATEMENT_TOTAL_BYTES = 100 * MEBIBYTE;
export const MAX_CSV_ROWS = 50_000;
export const MAX_PDF_PAGES = 250;
export const MAX_BACKUP_FILE_BYTES = 40 * MEBIBYTE;
export const MAX_BACKUP_TEXT_CHARACTERS = 40 * MEBIBYTE;
export const MAX_BACKUP_PLAINTEXT_CHARACTERS = 25 * MEBIBYTE;

function fileSizeLabel(bytes: number): string {
  return `${Math.ceil(bytes / MEBIBYTE)} MB`;
}

export function assertStatementFiles(files: readonly Pick<File, "name" | "size">[]): void {
  if (files.length > MAX_STATEMENT_FILES) {
    throw new Error(`Choose at most ${MAX_STATEMENT_FILES} statements at a time.`);
  }
  for (const file of files) {
    if (file.size > MAX_STATEMENT_FILE_BYTES) {
      throw new Error(`${file.name} is larger than the ${fileSizeLabel(MAX_STATEMENT_FILE_BYTES)} statement limit.`);
    }
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_STATEMENT_TOTAL_BYTES) {
    throw new Error(`The selected statements exceed the ${fileSizeLabel(MAX_STATEMENT_TOTAL_BYTES)} combined limit.`);
  }
}

export function assertCsvFile(file: Pick<File, "name" | "size">): void {
  if (file.size > MAX_STATEMENT_FILE_BYTES) {
    throw new Error(`${file.name} is larger than the ${fileSizeLabel(MAX_STATEMENT_FILE_BYTES)} CSV limit.`);
  }
}

export function assertCsvRowCount(rowCount: number): void {
  if (rowCount > MAX_CSV_ROWS) {
    throw new Error(`CSV files may contain at most ${MAX_CSV_ROWS.toLocaleString("en-US")} rows.`);
  }
}

export function assertPdfPageCount(pageCount: number): void {
  if (pageCount > MAX_PDF_PAGES) {
    throw new Error(`PDF statements may contain at most ${MAX_PDF_PAGES} pages.`);
  }
}

export function assertBackupFile(file: Pick<File, "name" | "size">): void {
  if (file.size > MAX_BACKUP_FILE_BYTES) {
    throw new Error(`${file.name} is larger than the ${fileSizeLabel(MAX_BACKUP_FILE_BYTES)} backup limit.`);
  }
}

export function assertBackupText(text: string): void {
  if (text.length > MAX_BACKUP_TEXT_CHARACTERS) {
    throw new Error(`The backup payload exceeds the ${fileSizeLabel(MAX_BACKUP_FILE_BYTES)} limit.`);
  }
}

export function assertBackupPlaintext(text: string): void {
  if (text.length > MAX_BACKUP_PLAINTEXT_CHARACTERS) {
    throw new Error("The unencrypted household payload exceeds the 25 MB backup limit.");
  }
}
