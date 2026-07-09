import type { Transaction } from "../domain/types";

/** One bank/format's statement handler: detect, unlock, and parse into transactions. */
export interface StatementParser {
  id: string;
  /** shown in the UI, e.g. "NTB Amex (HTML)" */
  label: string;
  /** shown next to this parser's password field, e.g. "DOB password" */
  passwordLabel: string;
  passwordPlaceholder: string;
  /** cheap, synchronous check (extension/light sniff) used to route a file to this parser */
  canHandle(file: File): boolean;
  /** unlock (if needed) and parse the file into transactions; throws a descriptive Error on failure */
  parse(file: File, password: string): Promise<Transaction[]>;
}
