import { describe, expect, it } from "vitest";
import { parseDepositStatement } from "./ntbSavingsHtml";

/**
 * Shape verified against a real decrypted NTB savings/current statement: both
 * tables are empty in static HTML and rendered client-side from data built
 * via repeated `.push({...})` calls (not a single JSON array), one account
 * summary push followed by that account's transaction pushes, per account.
 */
function oneSavingsAccount(accountNo: string, rows: string): string {
  return `
    var stData = [];
    ${rows}
    savingsDataList.push({
      savingsAccountNo: "${accountNo}",
      savingsAccountType: "Savings - Salary Saver",
      savingsCurrency: "LKR",
      transactionData: stData
    });
  `;
}

function row(dateFull: string, details: string, debit: number, credit: number): string {
  return `stData.push({
    transactionDateFull: "${dateFull}",
    savingsTransactionDate: "x",
    savingsTransactionValueDate: "x",
    savingsTransactionDetails: "${details}",
    savingsTransactionRefNo: " S1",
    transactionDebit: "${debit}",
    transactionCredit: "${credit}",
    runningTotal: "0"
  });`;
}

describe("parseDepositStatement", () => {
  it("keeps both debit and credit rows, tagging direction, across multiple savings accounts", () => {
    const html = `<html><script>
      var savingsDataList = [];
      var currentDataList = [];
      ${oneSavingsAccount(
        "100000000001",
        row("23-06-2026", "monthly common share", 0, 150000) + row("31-05-2026", "SI TO 100000000003", 39895, 0),
      )}
      ${oneSavingsAccount("100000000002", row("09-06-2026", "ISLIPS 7092999", 0, 272199.53))}
    </script></html>`;

    const txns = parseDepositStatement(html, "fallback");
    expect(txns).toHaveLength(3);

    const credit = txns.find((t) => t.description === "monthly common share")!;
    expect(credit).toMatchObject({ date: "2026-06-23", amount: 150000, direction: "credit" });
    expect(credit.account).toContain("100000000001");

    const debit = txns.find((t) => t.description === "SI TO 100000000003")!;
    expect(debit).toMatchObject({ date: "2026-05-31", amount: 39895, direction: "debit" });

    const secondAccount = txns.find((t) => t.description === "ISLIPS 7092999")!;
    expect(secondAccount.account).toContain("100000000002");
    expect(secondAccount.direction).toBe("credit");
  });

  it("throws when neither savings nor current account data is present", () => {
    expect(() =>
      parseDepositStatement("<html><script>var savingsDataList = []; var currentDataList = [];</script></html>", "x"),
    ).toThrow(/found no savings\/current-account transactions/i);
  });

  it("handles an account with zero transactions in the period without misattributing later accounts", () => {
    const html = `<html><script>
      var savingsDataList = [];
      var currentDataList = [];
      ${oneSavingsAccount("111111", "")}
      ${oneSavingsAccount("222222", row("01-06-2026", "ONLY TXN", 500, 0))}
    </script></html>`;
    const txns = parseDepositStatement(html, "fallback");
    expect(txns).toHaveLength(1);
    expect(txns[0]!.account).toContain("222222");
  });

  it("does not truncate a transaction description containing an unescaped brace or an escaped quote", () => {
    const html = `<html><script>
      var savingsDataList = [];
      var currentDataList = [];
      ${oneSavingsAccount(
        "111111",
        `stData.push({
          transactionDateFull: "01-06-2026",
          savingsTransactionDetails: "REF {12345} CLOSED",
          transactionDebit: "100",
          transactionCredit: "0",
          runningTotal: "0"
        });
        stData.push({
          transactionDateFull: "02-06-2026",
          savingsTransactionDetails: "TFR TO \\"JOINT A/C\\"",
          transactionDebit: "200",
          transactionCredit: "0",
          runningTotal: "0"
        });`,
      )}
    </script></html>`;
    const txns = parseDepositStatement(html, "fallback");
    expect(txns).toHaveLength(2);
    expect(txns.find((t) => t.date === "2026-06-01")!.description).toBe("REF {12345} CLOSED");
    expect(txns.find((t) => t.date === "2026-06-02")!.description).toBe('TFR TO "JOINT A/C"');
  });

  it("throws instead of silently reporting success when real transaction blocks exist but none parse", () => {
    // Simulates the unverified current-account field names not matching a real statement's actual fields.
    const html = `<html><script>
      var savingsDataList = [];
      var currentDataList = [];
      currentDataList.push({ currentAccountNo: "999999", currentAccountType: "Current" });
      var ctData = [];
      ctData.push({
        transactionDateFull: "01-06-2026",
        someOtherFieldName: "not what we expect",
        transactionDebit: "100",
        transactionCredit: "0"
      });
    </script></html>`;
    expect(() => parseDepositStatement(html, "fallback")).toThrow(/couldn't read any of them/i);
  });

  it("throws rather than silently truncating when the account count and transaction-batch count disagree", () => {
    // Two accounts pushed, but only one "var stData = [];" reset — segments.length (1) !== accounts.length (2).
    const html = `<html><script>
      var savingsDataList = [];
      var currentDataList = [];
      var stData = [];
      ${row("01-06-2026", "TXN", 100, 0)}
      savingsDataList.push({ savingsAccountNo: "111111" });
      savingsDataList.push({ savingsAccountNo: "222222" });
    </script></html>`;
    expect(() => parseDepositStatement(html, "fallback")).toThrow(/can't reliably match transactions/i);
  });
});
