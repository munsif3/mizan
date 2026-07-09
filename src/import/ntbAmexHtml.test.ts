import { describe, expect, it } from "vitest";
import { parseCardStatement } from "./ntbAmexHtml";

/**
 * Shape verified against a real decrypted NTB card statement: the `<tbody>`
 * in the static HTML is empty; the page renders it client-side from
 * `cardTransactionsDataList`, valid JSON embedded in a `<script>` tag.
 * `postDate`/`txDate` carry no year — the page resolves them against
 * `statementPeriod`, also present in the script.
 */
function statementHtml(transactions: object[], period = "24-May-2026 to 23-Jun-2026"): string {
  const cardData = [{ cardNo: "370000*****0002", primaryCardStatus: "true", consumerTransactions: transactions }];
  return `<html><body><table><thead><tr><th>Post Date</th></tr></thead><tbody id="transaction-table-body"></tbody></table>
    <script>
      var cardTransactionsDataList = ${JSON.stringify(cardData)};
      var statementPeriod = "${period}" ;
      document.getElementById('statement-period').innerHTML = statementPeriod;
    </script></body></html>`;
}

describe("parseCardStatement", () => {
  it("extracts debits, resolves year-less dates against the statement period, and skips credits", () => {
    const html = statementHtml([
      { txId: 1, postDate: "25 MAY", txDate: "21 MAY", description: "UBER EATS", txCurrency: "LKR", txAmount: 4080, txConvertedAmount: 4080, crDr: "Dr" },
      { txId: 2, postDate: "25 MAY", txDate: "25 MAY", description: "CASH PAYMENT-FINACLE", txCurrency: "LKR", txAmount: 70524.25, txConvertedAmount: 70524.25, crDr: "Cr" },
      { txId: 3, postDate: "02 JUN", txDate: "01 JUN", description: "KEELLS SUPER WATTALA", txCurrency: "LKR", txAmount: 12450, txConvertedAmount: 12450, crDr: "Dr" },
    ]);

    const txns = parseCardStatement(html, "fallback");
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({ date: "2026-05-21", description: "UBER EATS", amount: 4080, direction: "debit", category: "uncategorized" });
    // "01 JUN" resolves to 2026 (the period's end month/year), not the start year
    expect(txns[1]).toMatchObject({ date: "2026-06-01", amount: 12450 });
    expect(txns.every((t) => t.account.includes("0002"))).toBe(true);
  });

  it("uses the converted (billed) amount, not the original-currency amount, for a foreign-currency purchase", () => {
    const html = statementHtml([
      { txId: 1, postDate: "10 JUN", txDate: "10 JUN", description: "GOOGLE YOUTUBE", txCurrency: "USD", txAmount: 12.99, txConvertedAmount: 4180.5, crDr: "Dr" },
    ]);
    const txns = parseCardStatement(html, "fallback");
    expect(txns[0]!.amount).toBe(4180.5);
  });

  it("throws when the card transaction data isn't present", () => {
    expect(() => parseCardStatement("<html><body>nothing here</body></html>", "x")).toThrow(
      /could not find card transaction data/i,
    );
  });

  it("throws when every row is a credit/payment", () => {
    const html = statementHtml([
      { txId: 1, postDate: "25 MAY", txDate: "25 MAY", description: "PAYMENT", txCurrency: "LKR", txAmount: 1000, txConvertedAmount: 1000, crDr: "Cr" },
    ]);
    expect(() => parseCardStatement(html, "x")).toThrow(/found no debit transactions/i);
  });
});
