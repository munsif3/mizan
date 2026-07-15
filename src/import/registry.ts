import type { StatementParser } from "./types";

// To support a new bank, implement StatementParser (see ./types) and add it
// here — that's the whole extension point. Generic CSV is handled separately
// (see ./csv + ui/CsvImportModal) because it needs an interactive column-mapping
// step that doesn't fit the file-in/transactions-out parser contract.
// Keep bank-specific parsing code out of the everyday dashboard bundle. In
// particular, PDF.js is large and is only useful after someone selects a PDF.
const ntbHtmlParser: StatementParser = {
  id: "ntb-html",
  label: "NTB (HTML)",
  passwordLabel: "DOB password",
  passwordPlaceholder: "DDMMYYYY",
  canHandle: (file) => /\.html?$/i.test(file.name),
  parse: async (file, password) => (await import("./ntbHtml")).ntbHtmlParser.parse(file, password),
};

const dfccPdfParser: StatementParser = {
  id: "dfcc-visa-pdf",
  label: "DFCC (PDF)",
  passwordLabel: "NIC password",
  passwordPlaceholder: "NIC number",
  canHandle: (file) => /\.pdf$/i.test(file.name),
  parse: async (file, password) => (await import("./dfccPdf")).dfccPdfParser.parse(file, password),
};

const statementParsers: StatementParser[] = [ntbHtmlParser, dfccPdfParser];

/** Parsers willing to handle this file, in registration order. */
export function parsersFor(file: File): StatementParser[] {
  return statementParsers.filter((parser) => parser.canHandle(file));
}
