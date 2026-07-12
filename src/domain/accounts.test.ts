import { describe, expect, it } from "vitest";
import { applyAccounts, guessOwner, ownerOf, resolveAccountLabel, seedAccounts, transactionDisplayCurrency } from "./accounts";
import type { Account, Member, Transaction } from "./types";

const MEMBERS: Member[] = [
  { id: "alex", name: "Alex", color: "#5b8cff", portions: [] },
  { id: "sam", name: "Sam", color: "#ff80b5", portions: [] },
];

const REGISTRY: Account[] = [
  { id: "a1", label: "Alex AMEX", owner: "alex", match: ["37xx 1234", "amex"] },
  { id: "a2", label: "Alex Master Debit", owner: "alex", match: ["5xxx 7788"] },
  { id: "a3", label: "Joint Debit (forex)", owner: "joint", match: ["4321 0099"] },
  { id: "a4", label: "Alex Visa", owner: "alex", match: ["dfcc"] },
  { id: "a5", label: "Sam HNB Visa", owner: "sam", match: ["hnb", "4567 8800"] },
];

function txn(account: string): Transaction {
  return {
    id: "t",
    date: "2026-07-01",
    description: "X",
    amount: 100,
    category: "food",
    account,
    note: "",
    source: "imported",
    direction: "debit",
    kind: "expense",
  };
}

describe("resolveAccountLabel", () => {
  it("maps statement-detected card numbers to the registered account", () => {
    expect(resolveAccountLabel("Card Number: 37XX 1234", REGISTRY)).toBe("Alex AMEX");
    expect(resolveAccountLabel("statement-4321 0099-jul", REGISTRY)).toBe("Joint Debit (forex)");
    expect(resolveAccountLabel("DFCC estatement july", REGISTRY)).toBe("Alex Visa");
  });

  it("prefers the longest matching pattern deterministically", () => {
    const overlapping: Account[] = [
      { id: "x", label: "Generic", owner: "joint", match: ["1234"] },
      { id: "y", label: "Specific", owner: "alex", match: ["37xx 1234"] },
    ];
    expect(resolveAccountLabel("card 37xx 1234", overlapping)).toBe("Specific");
  });

  it("passes unknown text through unchanged", () => {
    expect(resolveAccountLabel("Mystery Bank 0000", REGISTRY)).toBe("Mystery Bank 0000");
  });

  it("keeps an exact label match stable", () => {
    expect(resolveAccountLabel("Alex AMEX", REGISTRY)).toBe("Alex AMEX");
  });

  it("breaks a tie between an exact-label match and a same-length pattern alphabetically", () => {
    const accounts: Account[] = [
      { id: "z", label: "Zebra", owner: "joint", match: [] },
      { id: "a", label: "Apple", owner: "alex", match: ["Zebra"] },
    ];
    expect(resolveAccountLabel("Zebra", accounts)).toBe("Apple");
  });
});

describe("ownerOf", () => {
  it("attributes by exact label, then patterns, defaulting to joint", () => {
    expect(ownerOf("Alex AMEX", REGISTRY)).toBe("alex");
    expect(ownerOf("Sam HNB Visa", REGISTRY)).toBe("sam");
    expect(ownerOf("something with dfcc inside", REGISTRY)).toBe("alex");
    expect(ownerOf("Unknown Card", REGISTRY)).toBe("joint");
  });

  it("never disagrees with resolveAccountLabel on overlapping patterns", () => {
    const accounts: Account[] = [
      { id: "short", label: "Card Short", owner: "alex", match: ["12"] },
      { id: "long", label: "Card Long", owner: "sam", match: ["1234"] },
    ];
    expect(resolveAccountLabel("account 1234", accounts)).toBe("Card Long");
    expect(ownerOf("account 1234", accounts)).toBe("sam");
  });
});

describe("applyAccounts", () => {
  it("rewrites raw account text onto canonical labels", () => {
    const result = applyAccounts([txn("Card: 37xx 1234"), txn("Cash")], REGISTRY);
    expect(result[0]!.account).toBe("Alex AMEX");
    expect(result[0]!.accountId).toBe("a1");
    expect(result[0]!.rawAccount).toBe("Card: 37xx 1234");
    expect(result[1]!.account).toBe("Cash");
  });

  it("keeps existing rows attached when a registered account is renamed", () => {
    const linked = applyAccounts([txn("Card: 37xx 1234")], REGISTRY);
    const renamed = REGISTRY.map((account) => account.id === "a1" ? { ...account, label: "Alex USD AMEX" } : account);
    expect(applyAccounts(linked, renamed)[0]).toMatchObject({
      account: "Alex USD AMEX",
      accountId: "a1",
      rawAccount: "Card: 37xx 1234",
    });
  });

  it("re-resolves an unmatched imported row after a matching account is added", () => {
    const imported = applyAccounts([txn("Savings RFC 270080002250")], []);
    const configured: Account[] = [{ id: "rfc", label: "RFC Savings", currency: "USD", owner: "sam", match: ["2250"] }];
    expect(applyAccounts(imported, configured)[0]).toMatchObject({
      account: "RFC Savings",
      accountId: "rfc",
      rawAccount: "Savings RFC 270080002250",
    });
  });

  it("does not bind unknown rows to a blank account draft", () => {
    const draft: Account[] = [{ id: "draft", label: "", currency: "USD", owner: "joint", match: [] }];
    expect(applyAccounts([txn("New account")], draft)[0]).toEqual(txn("New account"));
  });
});

describe("seeding", () => {
  it("guesses owner from a member name in the label, else joint", () => {
    expect(guessOwner("Alex Visa", MEMBERS)).toBe("alex");
    expect(guessOwner("sam amex", MEMBERS)).toBe("sam");
    expect(guessOwner("Joint Savings", MEMBERS)).toBe("joint");
    expect(guessOwner("Cash", MEMBERS)).toBe("joint");
    expect(guessOwner("Unknown Bank", MEMBERS)).toBe("joint");
  });

  it("builds a registry from distinct labels in existing data", () => {
    const seeded = seedAccounts([txn("Alex Visa"), txn("Sam Visa"), txn("Alex Visa")], MEMBERS);
    expect(seeded.map((account) => [account.label, account.owner])).toEqual([
      ["Alex Visa", "alex"],
      ["Sam Visa", "sam"],
    ]);
  });

  it("seeds each account with its own label as a starter match pattern", () => {
    const seeded = seedAccounts([txn("Alex Visa")], MEMBERS);
    expect(seeded[0]!.match).toEqual(["Alex Visa"]);
  });
});

describe("transactionDisplayCurrency", () => {
  const accounts: Account[] = [{ id: "rfc", label: "RFC Savings", currency: "USD", owner: "sam", match: ["2250"] }];

  it("uses the account currency for a native account row", () => {
    expect(transactionDisplayCurrency({ ...txn("RFC Savings"), accountId: "rfc", direction: "credit", kind: "account_credit" }, accounts, "LKR")).toBe("USD");
  });

  it("uses household currency after explicit FX normalization", () => {
    expect(transactionDisplayCurrency({ ...txn("RFC Savings"), accountId: "rfc", note: "FX conversion: USD 1,900 at 332 = LKR 630,800" }, accounts, "LKR")).toBe("LKR");
  });
});
