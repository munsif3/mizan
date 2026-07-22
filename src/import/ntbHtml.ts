import { type Transaction } from "../domain/types";
import { decryptAesCbcPbkdf2 } from "./ntbCrypto";
import { parseCardStatement } from "./ntbAmexHtml";
import { parseDepositStatement } from "./ntbSavingsHtml";
import type { StatementParser } from "./types";
import { assertStatementFiles } from "../security/resourceLimits";

export interface EncryptedParts {
  salt: string;
  iv: string;
  embedded: string;
}

/** Pull the salt, IV, and base64 ciphertext out of an NTB encrypted HTML statement. */
export function extractEncryptedParts(html: string): EncryptedParts {
  const saltPatterns = [
    /salt\s*[:=]\s*["']([a-f0-9]{16,})["']/i,
    /CryptoJS\.enc\.Hex\.parse\(["']([a-f0-9]{16,})["']\)/i,
  ];
  const ivPatterns = [
    /iv\s*[:=]\s*CryptoJS\.enc\.Hex\.parse\(["']([a-f0-9]{16,})["']\)/i,
    /iv\s*[:=]\s*["']([a-f0-9]{16,})["']/i,
  ];
  const blobPatterns = [
    /(?:embedded|encrypted|ciphertext|data)\s*=\s*["']([A-Za-z0-9+/=\s]{80,})["']/i,
    /CryptoJS\.enc\.Base64\.parse\(["']([A-Za-z0-9+/=\s]{80,})["']\)/i,
  ];

  const salt = saltPatterns.map((rx) => html.match(rx)?.[1]).find(Boolean);
  const iv = ivPatterns.map((rx) => html.match(rx)?.[1]).find(Boolean);
  const embedded = blobPatterns
    .map((rx) => html.match(rx)?.[1])
    .find(Boolean)
    ?.replace(/\s+/g, "");

  if (!salt || !iv || !embedded) {
    throw new Error("This does not look like the NTB encrypted HTML format. Could not find the encrypted data, salt, and IV.");
  }
  return { salt, iv, embedded };
}

export async function decryptNTBStatement(html: string, dob: string): Promise<string> {
  const password = String(dob ?? "").replace(/\D/g, "");
  if (password.length !== 8) throw new Error("Enter the DOB password in DDMMYYYY format.");

  const { salt, iv, embedded } = extractEncryptedParts(html);
  let text: string;
  try {
    text = await decryptAesCbcPbkdf2(password, salt, iv, embedded);
  } catch {
    throw new Error("Decryption failed. Check the DOB password and try again.");
  }
  if (!text) throw new Error("Decryption failed. Check the DOB password and try again.");
  return text;
}

/**
 * NTB issues more than one statement format under the same DOB-password
 * encrypted-HTML wrapper (card/Amex, savings+current). `canHandle` runs
 * before decryption (filename only), so it can't tell them apart — instead
 * this decrypts once, then dispatches on content markers only present in the
 * decrypted page, keeping the registry to one entry (and one password field)
 * per bank rather than one per statement format.
 *
 * Each marker is checked independently and results are concatenated, rather
 * than returning on the first match — if a statement ever combined both a
 * card section and a savings/current section, an exclusive first-match
 * dispatch would silently drop whichever section came second. A sub-parser
 * failing outright (e.g. its marker matched but it found nothing usable) is
 * tolerated as long as at least one sub-parser found real transactions; if
 * none did, every sub-parser's error is surfaced together.
 */
async function parse(file: File, dob: string): Promise<Transaction[]> {
  assertStatementFiles([file]);
  const raw = await file.text();
  const html = /CryptoJS|encrypted|ciphertext|embedded/i.test(raw) ? await decryptNTBStatement(raw, dob) : raw;
  const fallbackAccount = file.name.replace(/\.[^.]+$/, "");

  const transactions: Transaction[] = [];
  const errors: string[] = [];
  const attempts: [RegExp, (html: string, fallbackAccount: string) => Transaction[]][] = [
    [/cardTransactionsDataList/, parseCardStatement],
    [/savingsDataList|currentDataList/, parseDepositStatement],
  ];
  for (const [marker, parser] of attempts) {
    if (!marker.test(html)) continue;
    try {
      transactions.push(...parser(html, fallbackAccount));
    } catch (error) {
      errors.push((error as Error).message);
    }
  }

  if (errors.length) {
    throw new Error(errors.join(" "));
  }
  if (!transactions.length) {
    throw new Error(
      errors.length ? errors.join(" ") : "This is a valid NTB statement, but not a format Mizan recognizes yet (card or savings/current).",
    );
  }
  return transactions;
}

export const ntbHtmlParser: StatementParser = {
  id: "ntb-html",
  label: "NTB (HTML)",
  passwordLabel: "DOB password",
  passwordPlaceholder: "DDMMYYYY",
  canHandle: (file) => /\.html?$/i.test(file.name),
  parse,
};
