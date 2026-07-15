import { describe, expect, it } from "vitest";
import {
  applyAccountBeneficiaryDefaults,
  applyAccounts,
  guessOwner,
  ownerOfTransaction,
  resolveAccountLabel,
  seedAccounts,
  transactionDisplayCurrency,
} from "./accounts";
import type { Account, Member, Transaction } from "./types";

const MEMBERS: Member[] = [
  { id: "alex", name: "Alex", color: "#5b8cff", portions: [] },
  { id: "sam", name: "Sam", color: "#ff80b5", portions: [] },
];

const REGISTRY: Account[] = [
  { id: "a1", label: "Alex AMEX", owner: "alex", beneficiaryDefault: "review", match: ["37xx 1234", "amex"] },
  { id: "a2", label: "Alex Master Debit", owner: "alex", beneficiaryDefault: "review", match: ["5xxx 7788"] },
  { id: "a3", label: "Joint Debit (forex)", owner: "joint", beneficiaryDefault: "review", match: ["4321 0099"] },
  { id: "a4", label: "Alex Visa", owner: "alex", beneficiaryDefault: "review", match: ["dfcc"] },
  { id: "a5", label: "Sam HNB Visa", owner: "sam", beneficiaryDefault: "review", match: ["hnb", "4567 8800"] },
];

function txn(account: string): Transaction {
  return {
    id: "t",
    date: "2026-07-01",
    description: "X",
    amount: 100,
    category: "food",
    beneficiary: { type: "household" },
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
      { id: "x", label: "Generic", owner: "joint", beneficiaryDefault: "review", match: ["1234"] },
      { id: "y", label: "Specific", owner: "alex", beneficiaryDefault: "review", match: ["37xx 1234"] },
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
      { id: "z", label: "Zebra", owner: "joint", beneficiaryDefault: "review", match: [] },
      { id: "a", label: "Apple", owner: "alex", beneficiaryDefault: "review", match: ["Zebra"] },
    ];
    expect(resolveAccountLabel("Zebra", accounts)).toBe("Apple");
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
    const configured: Account[] = [{ id: "rfc", label: "RFC Savings", currency: "USD", owner: "sam", beneficiaryDefault: "review", match: ["2250"] }];
    expect(applyAccounts(imported, configured)[0]).toMatchObject({
      account: "RFC Savings",
      accountId: "rfc",
      rawAccount: "Savings RFC 270080002250",
    });
  });

  it("does not bind unknown rows to a blank account draft", () => {
    const draft: Account[] = [{ id: "draft", label: "", currency: "USD", owner: "joint", beneficiaryDefault: "review", match: [] }];
    expect(applyAccounts([txn("New account")], draft)[0]).toEqual(txn("New account"));
  });
});

describe("account beneficiary defaults", () => {
  const accounts: Account[] = [
    { id: "sara", label: "Sara Card", owner: "sara", beneficiaryDefault: "owner", match: ["1111"] },
    { id: "munsif", label: "Munsif Card", owner: "munsif", beneficiaryDefault: "owner", match: ["2222"] },
    { id: "home", label: "Home Card", owner: "munsif", beneficiaryDefault: "household", match: ["3333"] },
    { id: "joint", label: "Joint Card", owner: "joint", beneficiaryDefault: "owner", match: ["4444"] },
  ];
  const members: Member[] = [
    { id: "sara", name: "Sara", color: "#5b8cff", portions: [] },
    { id: "munsif", name: "Munsif", color: "#ff80b5", portions: [] },
  ];

  it("resolves owner and household defaults through stable account ids", () => {
    const rows = applyAccountBeneficiaryDefaults([
      { ...txn("Old Sara Label"), accountId: "sara", beneficiary: { type: "unassigned" } },
      { ...txn("Home Card"), accountId: "home", beneficiary: { type: "unassigned" } },
    ], accounts, members);
    expect(rows[0]).toMatchObject({ beneficiary: { type: "member", memberId: "sara" }, beneficiarySource: "account_default" });
    expect(rows[1]).toMatchObject({ beneficiary: { type: "household" }, beneficiarySource: "account_default" });
    expect(ownerOfTransaction(rows[0]!, accounts)).toBe("sara");
  });

  it("leaves joint-owner and non-spend rows unresolved", () => {
    const rows = applyAccountBeneficiaryDefaults([
      { ...txn("Joint Card"), accountId: "joint", beneficiary: { type: "unassigned" } },
      { ...txn("Sara Card"), accountId: "sara", beneficiary: { type: "unassigned" }, kind: "internal_transfer" },
    ], accounts, members);
    expect(rows.map((row) => row.beneficiary)).toEqual([{ type: "unassigned" }, { type: "unassigned" }]);
    expect(rows.every((row) => row.beneficiarySource === undefined)).toBe(true);
  });

  it("recomputes inferred rows and fills unlocked unassigned rows without rewriting explicit or locked values", () => {
    const rows = applyAccountBeneficiaryDefaults([
      { ...txn("Sara Card"), accountId: "sara", beneficiary: { type: "member", memberId: "munsif" }, beneficiarySource: "account_default" },
      { ...txn("Sara Card"), accountId: "sara", beneficiary: { type: "unassigned" } },
      { ...txn("Sara Card"), accountId: "sara", beneficiary: { type: "household" } },
      { ...txn("Sara Card"), accountId: "sara", beneficiary: { type: "unassigned" }, classificationLocked: true },
    ], accounts, members);
    expect(rows.map((row) => row.beneficiary)).toEqual([
      { type: "member", memberId: "sara" },
      { type: "member", memberId: "sara" },
      { type: "household" },
      { type: "unassigned" },
    ]);
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
    const accounts: Account[] = [{ id: "rfc", label: "RFC Savings", currency: "USD", owner: "sam", beneficiaryDefault: "review", match: ["2250"] }];

  it("uses the account currency for a native account row", () => {
    expect(transactionDisplayCurrency({ ...txn("RFC Savings"), accountId: "rfc", direction: "credit", kind: "account_credit" }, accounts, "LKR")).toBe("USD");
  });

  it("uses household currency after explicit FX normalization", () => {
    expect(transactionDisplayCurrency({ ...txn("RFC Savings"), accountId: "rfc", note: "FX conversion: USD 1,900 at 332 = LKR 630,800" }, accounts, "LKR")).toBe("LKR");
    expect(transactionDisplayCurrency({ ...txn("RFC Savings"), accountId: "rfc", note: "Reviewed; FX conversion: USD 1,900 at 332 = LKR 630,800" }, accounts, "LKR")).toBe("LKR");
  });
});
