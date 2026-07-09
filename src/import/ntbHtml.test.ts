import CryptoJS from "crypto-js";
import { describe, expect, it } from "vitest";
import { decryptNTBStatement, extractEncryptedParts, ntbHtmlParser } from "./ntbHtml";

/** jsdom's File/Blob shim doesn't implement `.text()`; the parser needs it. */
function fileWithText(content: string, name: string): File {
  const file = new File([content], name);
  Object.defineProperty(file, "text", { value: async () => content });
  return file;
}

const CARD_SCRIPT = `
  var cardTransactionsDataList = [{"cardNo":"1234","primaryCardStatus":"true","consumerTransactions":[
    {"txId":1,"postDate":"02 JUL","txDate":"02 JUL","description":"KEELLS SUPER","txCurrency":"LKR","txAmount":12450,"txConvertedAmount":12450,"crDr":"Dr"}
  ]}];
  var statementPeriod = "24-Jun-2026 to 23-Jul-2026" ;
`;

const SAVINGS_SCRIPT = `
  var savingsDataList = [];
  var currentDataList = [];
  var stData = [];
  stData.push({
    transactionDateFull: "01-07-2026",
    savingsTransactionDetails: "SALARY",
    transactionDebit: "0",
    transactionCredit: "500000"
  });
  savingsDataList.push({ savingsAccountNo: "999999", transactionData: stData });
`;

describe("encrypted statement pipeline", () => {
  const SALT = "aabbccddeeff00112233445566778899";
  const IV = "99887766554433221100ffeeddccbbaa";
  const DOB = "14071995";

  function buildEncryptedHtml(body: string): string {
    // Matches the real NTB scheme: PBKDF2 default keySize/iterations with an
    // explicit SHA1 hasher (CryptoJS's PBKDF2 default changed to SHA-256 in
    // 4.2.0 — pinning it here is what makes this fixture representative).
    const key = CryptoJS.PBKDF2(DOB, CryptoJS.enc.Hex.parse(SALT), { keySize: 4, iterations: 15000, hasher: CryptoJS.algo.SHA1 });
    const cipher = CryptoJS.AES.encrypt(body, key, { iv: CryptoJS.enc.Hex.parse(IV) }).ciphertext.toString(
      CryptoJS.enc.Base64,
    );
    return `<html><script>
      var salt = "${SALT}";
      var iv = "${IV}";
      var embedded = "${cipher}";
    </script></html>`;
  }

  it("extracts salt, iv, and ciphertext from the wrapper page", () => {
    const parts = extractEncryptedParts(buildEncryptedHtml("x".repeat(100)));
    expect(parts.salt).toBe(SALT);
    expect(parts.iv).toBe(IV);
    expect(parts.embedded.length).toBeGreaterThan(80);
  });

  it("decrypts end-to-end with the DOB password", async () => {
    const html = buildEncryptedHtml(`<html>${CARD_SCRIPT}</html>`);
    await expect(decryptNTBStatement(html, DOB)).resolves.toContain("cardTransactionsDataList");
  });

  it("rejects a malformed DOB before touching crypto", async () => {
    await expect(decryptNTBStatement("<html></html>", "123")).rejects.toThrow(/DDMMYYYY/);
  });

  it("reports a wrong password as a decryption failure", async () => {
    const html = buildEncryptedHtml(`<html>${CARD_SCRIPT}</html>`);
    await expect(decryptNTBStatement(html, "01011990")).rejects.toThrow(/Decryption failed/);
  });
});

describe("ntbHtmlParser", () => {
  it("dispatches a decrypted card statement to the card parser", async () => {
    const file = fileWithText(`<html>${CARD_SCRIPT}</html>`, "statement.html");
    const txns = await ntbHtmlParser.parse(file, "");
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ description: "KEELLS SUPER", direction: "debit" });
  });

  it("throws a clear error for an NTB page that matches neither known format", async () => {
    const file = fileWithText("<html><body>not a statement</body></html>", "statement.html");
    await expect(ntbHtmlParser.parse(file, "")).rejects.toThrow(/not a format Mizan recognizes/i);
  });

  it("parses both sections when a statement contains both card and savings/current markers", async () => {
    const file = fileWithText(`<html>${CARD_SCRIPT}${SAVINGS_SCRIPT}</html>`, "statement.html");
    const txns = await ntbHtmlParser.parse(file, "");
    expect(txns.map((t) => t.description).sort()).toEqual(["KEELLS SUPER", "SALARY"]);
  });

  it("routes .html/.htm files to itself", () => {
    expect(ntbHtmlParser.canHandle(new File(["x"], "statement.html"))).toBe(true);
    expect(ntbHtmlParser.canHandle(new File(["x"], "statement.HTM"))).toBe(true);
    expect(ntbHtmlParser.canHandle(new File(["x"], "statement.pdf"))).toBe(false);
  });
});
