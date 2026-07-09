import { dfccPdfParser } from "./dfccPdf";
import { ntbHtmlParser } from "./ntbHtml";
import type { StatementParser } from "./types";

// To support a new bank, implement StatementParser (see ./types) and add it
// here — that's the whole extension point. Generic CSV is handled separately
// (see ./csv + ui/CsvImportModal) because it needs an interactive column-mapping
// step that doesn't fit the file-in/transactions-out parser contract.
export const statementParsers: StatementParser[] = [ntbHtmlParser, dfccPdfParser];

/** Parsers willing to handle this file, in registration order. */
export function parsersFor(file: File): StatementParser[] {
  return statementParsers.filter((parser) => parser.canHandle(file));
}
