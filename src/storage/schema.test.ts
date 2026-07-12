import { describe, expect, it } from "vitest";
import { emptyData, migrate } from "./schema";

/** Shape produced by trackr's "Export JSON" (schema v1). */
const TRACKR_BACKUP = {
  schemaVersion: 1,
  transactions: [
    {
      id: "txn_abc",
      date: "2026-06-14",
      description: "KEELLS SUPER",
      amount: 12450,
      category: "food",
      card: "Alex Visa",
      note: "",
      source: "imported",
    },
    {
      id: "txn_def",
      date: "2026-06-20",
      description: "GROUP DINNER",
      amount: 9000,
      category: "lifestyle",
      card: "Cash",
      note: "with friends",
      source: "manual",
    },
    { id: "bad", date: "not-a-date", description: "junk", amount: "NaN" },
  ],
  splits: { txn_def: { of: 3, mine: 1 } },
  merchantRules: { "keells super": "food", BADCAT: "not_a_category" },
  income: { primary: 600000, secondary: 800000 },
  fixedCosts: [
    { id: "rent", label: "Rent", amount: 120000, category: "housing", until: "" },
    { id: "car", label: "Car loan", amount: 250000, category: "transport", until: "2026-09" },
  ],
};

describe("migrate (trackr v1 -> mizan v5)", () => {
  const data = migrate(TRACKR_BACKUP);

  it("carries transactions over, renaming card -> account and dropping invalid rows", () => {
    expect(data.transactions).toHaveLength(2);
    expect(data.transactions[0]!.account).toBe("Alex Visa");
    expect(data.transactions[1]!.source).toBe("manual");
  });

  it("defaults direction to debit for pre-v4 data, which was always spend-only", () => {
    expect(data.transactions[0]!.direction).toBe("debit");
    expect(data.transactions[1]!.direction).toBe("debit");
    expect(migrate({ transactions: [{ id: "c1", date: "2026-07-01", amount: 500, direction: "credit" }] }).transactions[0]!.direction).toBe(
      "credit",
    );
  });

  it("folds the splits map into the owning transaction", () => {
    const dinner = data.transactions.find((txn) => txn.id === "txn_def");
    expect(dinner?.split).toEqual({ mine: 1, of: 3 });
    const groceries = data.transactions.find((txn) => txn.id === "txn_abc");
    expect(groceries?.split).toBeUndefined();
  });

  it("normalizes rule keys, upgrades v5 string rules to payloads, drops unknown categories", () => {
    expect(data.merchantRules).toEqual({ "KEELLS SUPER": { category: "food", kind: "expense" } });
  });

  it("defaults kind from direction: debits → expense, credits → account_credit", () => {
    expect(data.transactions[0]!.kind).toBe("expense");
    expect(migrate({ transactions: [{ id: "c1", date: "2026-07-01", amount: 500, direction: "credit" }] }).transactions[0]!.kind).toBe(
      "account_credit",
    );
  });

  it("seeds the account registry from distinct labels, guessing owners from member names", () => {
    // "Cash" contains no member name, so it seeds as joint (no bank/card heuristic any more).
    expect(data.accounts.map((account) => [account.label, account.owner])).toEqual([
      ["Alex Visa", "joint"],
      ["Cash", "joint"],
    ]);
  });

  it("seeds two members from legacy income, pins the legacy currency, keeps fixed costs", () => {
    expect(data.settings.members).toEqual([
      { id: "primary", name: "Member 1", color: "#5b8cff", portions: [{ id: "por_primary", label: "Monthly income", amount: 600000, currency: "LKR", taxRate: 0, taxWithheld: true, window: null }] },
      { id: "secondary", name: "Member 2", color: "#ff80b5", portions: [{ id: "por_secondary", label: "Monthly income", amount: 800000, currency: "LKR", taxRate: 0, taxWithheld: true, window: null }] },
    ]);
    expect(data.settings.currency).toBe("LKR");
    expect(data.settings.locale).toBe("en-LK");
    expect(data.settings.targetSaveRate).toBe(25);
    expect(data.fixedCosts.find((cost) => cost.id === "car")?.until).toBe("2026-09");
    expect(data.fixedCosts.find((cost) => cost.id === "rent")?.until).toBeUndefined();
  });

  it("round-trips v5 data unchanged", () => {
    expect(migrate(data)).toEqual(data);
  });

  it("degrades garbage to empty data instead of throwing", () => {
    expect(migrate(null)).toEqual(emptyData());
    expect(migrate("nonsense")).toEqual(emptyData());
    expect(migrate({ transactions: "not-an-array" })).toEqual(emptyData());
  });
});

describe("migrate (legacy member data -> v5 members)", () => {
  const v4 = {
    schemaVersion: 4,
    transactions: [
      { id: "t1", date: "2026-07-01", description: "GYM", amount: 5000, category: "primary_personal", account: "Primary Visa", direction: "debit", source: "imported" },
      { id: "t2", date: "2026-07-02", description: "SPA", amount: 8000, category: "secondary_personal", account: "Secondary Visa", direction: "debit", source: "imported" },
    ],
    accounts: [
      { id: "a1", label: "Primary Visa", owner: "primary", match: [] },
      { id: "a2", label: "Secondary Visa", owner: "secondary", match: [] },
      { id: "a3", label: "Old Card", owner: "ghost", match: [] },
    ],
    merchantRules: { GYM: "primary_personal" },
    fixedCosts: [],
    settings: { income: { primary: 600000, secondary: 800000 }, targetSaveRate: 30 },
  };
  const data = migrate(v4);

  it("maps legacy per-person categories to personal:<id> in transactions and rules", () => {
    expect(data.transactions[0]!.category).toBe("personal:primary");
    expect(data.transactions[1]!.category).toBe("personal:secondary");
    expect(data.merchantRules).toEqual({ GYM: { category: "personal:primary", kind: "expense" } });
  });

  it("keeps owners that match members and forces unknown owners to joint", () => {
    expect(data.accounts.map((account) => account.owner)).toEqual(["primary", "secondary", "joint"]);
  });

  it("seeds the member list and preserves the target save rate", () => {
    expect(data.settings.members.map((member) => member.id)).toEqual(["primary", "secondary"]);
    expect(data.settings.targetSaveRate).toBe(30);
    expect(data.settings.currency).toBe("LKR");
  });
});

describe("migrate (v5 passthrough and fresh data)", () => {
  it("passes a v5 member list through and preserves an orphaned personal category", () => {
    const v5 = {
      schemaVersion: 5,
      transactions: [
        { id: "t", date: "2026-07-01", description: "X", amount: 100, category: "personal:ghost", account: "Cash", direction: "debit", source: "manual" },
      ],
      accounts: [],
      merchantRules: {},
      fixedCosts: [],
      settings: {
        members: [{ id: "kai", name: "Kai", color: "#5b8cff", income: 1000 }],
        targetSaveRate: 20,
        currency: "EUR",
        locale: "de-DE",
        csvPresets: {},
      },
    };
    const data = migrate(v5);
    expect(data.settings.members).toEqual([{ id: "kai", name: "Kai", color: "#5b8cff", portions: [{ id: "por_kai", label: "Monthly income", amount: 1000, currency: "EUR", taxRate: 0, taxWithheld: true, window: null }] }]);
    expect(data.settings.currency).toBe("EUR");
    // A personal category with no matching member is valid data — kept, not dropped.
    expect(data.transactions[0]!.category).toBe("personal:ghost");
  });

  it("yields an empty member list (triggers onboarding) for data with no legacy member markers", () => {
    expect(migrate(emptyData()).settings.members).toEqual([]);
  });
});

describe("migrate (v6 movement kinds, counterparties, custom categories)", () => {
  const v6 = {
    schemaVersion: 6,
    transactions: [
      { id: "t1", date: "2026-07-01", description: "CASH TO SAM", amount: 5000, category: "uncategorized", account: "Cash", direction: "debit", source: "manual", kind: "money_lent", counterpartyId: "sam" },
      { id: "t2", date: "2026-07-02", description: "SAM PAID BACK", amount: 5000, category: "uncategorized", account: "Cash", direction: "credit", source: "manual", kind: "repayment_received", counterpartyId: "sam" },
      { id: "t3", date: "2026-07-03", description: "GADGET", amount: 3000, category: "custom:tech", account: "Cash", direction: "debit", source: "manual", kind: "expense" },
    ],
    accounts: [],
    merchantRules: { "CASH TO SAM": { category: "uncategorized", kind: "money_lent", counterpartyId: "sam" } },
    fixedCosts: [],
    settings: {
      members: [{ id: "kai", name: "Kai", color: "#5b8cff", income: 1000 }],
      targetSaveRate: 20,
      currency: "EUR",
      locale: "de-DE",
      csvPresets: {},
      counterparties: [{ id: "sam", name: "Sam" }],
      customCategories: [{ id: "tech", label: "Tech", color: "#67d66f" }],
    },
  };
  const data = migrate(v6);

  it("preserves movement kind, counterparty, and object rules", () => {
    expect(data.transactions[0]!.kind).toBe("money_lent");
    expect(data.transactions[0]!.counterpartyId).toBe("sam");
    expect(data.merchantRules["CASH TO SAM"]).toEqual({ category: "uncategorized", kind: "money_lent", counterpartyId: "sam" });
  });

  it("keeps custom categories and the custom: category key on a transaction", () => {
    expect(data.settings.customCategories).toEqual([{ id: "tech", label: "Tech", color: "#67d66f" }]);
    expect(data.settings.counterparties).toEqual([{ id: "sam", name: "Sam" }]);
    expect(data.transactions[2]!.category).toBe("custom:tech");
  });

  it("round-trips v6 data unchanged", () => {
    expect(migrate(data)).toEqual(data);
  });
});

describe("migrate (v7 income portions)", () => {
  it("migrates v6 income to an identical net monthly portion", () => {
    const data = migrate({
      schemaVersion: 6,
      settings: { members: [{ id: "m", name: "Member", color: "#123456", income: 1000 }], currency: "LKR" },
    });
    expect(data.schemaVersion).toBe(10);
    expect(data.settings.members[0]?.portions).toEqual([
      { id: "por_m", label: "Monthly income", amount: 1000, currency: "LKR", taxRate: 0, taxWithheld: true, window: null },
    ]);
  });

  it("round-trips portions, receipts, and normalized FX rates", () => {
    const data = migrate({
      schemaVersion: 7,
      incomeReceipts: [{ id: "anything", month: "2026-07", memberId: "m", portionId: "usd", amount: 305000, receivedAmount: 1000, receivedCurrency: "usd", fxRate: 305, date: "2026-07-12" }],
      settings: {
        members: [{
          id: "m",
          name: "Member",
          color: "#123456",
          portions: [{ id: "usd", label: "Salary", amount: 1000, currency: "usd", taxRate: 15, taxWithheld: false, window: { startDay: 15, endDay: 10 } }],
        }],
        currency: "LKR",
        fxRates: { usd: 305, bad: -1, "US D": 2 },
      },
    });
    expect(data.settings.fxRates).toEqual({ USD: 305 });
    expect(data.settings.members[0]?.portions[0]?.window).toEqual({ startDay: 10, endDay: 15 });
    expect(data.incomeReceipts).toEqual([{ id: "rcpt_2026-07_usd", month: "2026-07", memberId: "m", portionId: "usd", amount: 305000, receivedAmount: 1000, receivedCurrency: "USD", fxRate: 305, date: "2026-07-12" }]);
    expect(migrate(data)).toEqual(data);
  });

  it("drops junk and orphan receipts and defaults unsafe tax/window values", () => {
    const data = migrate({
      incomeReceipts: [
        { month: "July", memberId: "m", portionId: "p", amount: 1 },
        { month: "2026-07", memberId: "m", portionId: "missing", amount: 1 },
      ],
      settings: {
        members: [{ id: "m", name: "Member", portions: [{ id: "p", amount: "bad", taxRate: 150, window: { startDay: 0, endDay: 40 } }] }],
        currency: "LKR",
      },
    });
    expect(data.incomeReceipts).toEqual([]);
    expect(data.settings.members[0]?.portions[0]).toMatchObject({ amount: 0, taxRate: 99.999999, taxWithheld: true, window: null });
  });

  it("keeps valid receipt provenance and self-heals dangling or invalid links", () => {
    const base = {
      schemaVersion: 7,
      transactions: [{
        id: "salary-credit", date: "2026-07-12", description: "SALARY", amount: 1000,
        category: "uncategorized", account: "Savings", note: "", source: "imported",
        direction: "credit", kind: "account_credit",
      }],
      incomeReceipts: [
        { month: "2026-07", memberId: "m", portionId: "p", amount: 1000, transactionId: "salary-credit" },
        { month: "2026-06", memberId: "m", portionId: "p", amount: 900, transactionId: 42 },
      ],
      settings: {
        members: [{ id: "m", name: "Member", portions: [{ id: "p", amount: 1000, currency: "LKR" }] }],
        currency: "LKR",
      },
    };
    const linked = migrate(base);
    expect(linked.incomeReceipts.find((item) => item.month === "2026-07")?.transactionId).toBe("salary-credit");
    expect(linked.incomeReceipts.find((item) => item.month === "2026-06")?.transactionId).toBeUndefined();
    expect(migrate(linked)).toEqual(linked);

    const dangling = migrate({ ...base, transactions: [] });
    expect(dangling.incomeReceipts.find((item) => item.month === "2026-07")).toMatchObject({ amount: 1000 });
    expect(dangling.incomeReceipts.find((item) => item.month === "2026-07")?.transactionId).toBeUndefined();
  });
});

describe("migrate (v8 account identity and currency)", () => {
  it("defaults old accounts to household currency and preserves explicit account currency", () => {
    const data = migrate({
      schemaVersion: 7,
      accounts: [
        { id: "lkr", label: "Savings", owner: "joint", match: ["6204"] },
        { id: "usd", label: "RFC", currency: "usd", owner: "joint", match: ["2250"] },
      ],
      settings: { currency: "LKR", members: [] },
    });
    expect(data.accounts.map((account) => [account.id, account.currency])).toEqual([["lkr", "LKR"], ["usd", "USD"]]);
  });

  it("round-trips stable account linkage and raw statement text", () => {
    const data = migrate({
      schemaVersion: 8,
      transactions: [{
        id: "fx",
        date: "2026-06-25",
        description: "FUND TRANSFER USD 1900 @332",
        amount: 630800,
        account: "RFC",
        accountId: "usd",
        rawAccount: "Savings RFC 270080002250",
        direction: "debit",
        kind: "internal_transfer",
      }],
      settings: { currency: "LKR", members: [] },
    });
    expect(data.transactions[0]).toMatchObject({ account: "RFC", accountId: "usd", rawAccount: "Savings RFC 270080002250" });
  });
});

describe("migrate (v9 shared contributions -> v10 allocations)", () => {
  const source = {
    schemaVersion: 9,
    settings: {
      currency: "LKR",
      members: [
        { id: "owner", name: "Owner", color: "#5b8cff", portions: [] },
        { id: "contributor", name: "Contributor", color: "#ff80b5", portions: [] },
      ],
      customCategories: [{ id: "vehicle-loan", label: "Vehicle loan", color: "#7b8194" }],
    },
    accounts: [
      { id: "mine", label: "Owner Savings", owner: "owner", match: [] },
      { id: "contributor", label: "Contributor Savings", owner: "contributor", match: [] },
    ],
    transactions: [
      { id: "out", date: "2026-07-01", description: "MEMBER CAR LOAN", amount: 125000, account: "Contributor Savings", direction: "debit", kind: "internal_transfer" },
      { id: "in", date: "2026-07-01", description: "MEMBER CAR LOAN", amount: 125000, account: "Owner Savings", direction: "credit", kind: "internal_transfer" },
      { id: "loan", date: "2026-07-03", description: "BANK STANDING ORDER", amount: 250000, category: "custom:vehicle-loan", account: "Owner Savings", direction: "debit", kind: "loan_payment" },
    ],
    sharedContributions: [{ id: "c1", expenseTransactionId: "loan", transferDebitTransactionId: "out", transferCreditTransactionId: "in", contributorMemberId: "contributor", amount: 125000 }],
  };

  it("preserves valid statement-backed contribution links", () => {
    const data = migrate(source);
    expect(data.schemaVersion).toBe(10);
    expect(data.sharedContributions).toEqual([{
      id: "c1",
      allocations: [{ expenseTransactionId: "loan", amount: 125000 }],
      transferDebitTransactionId: "out",
      transferCreditTransactionId: "in",
      contributorMemberId: "contributor",
      amount: 125000,
    }]);
  });

  it("drops malformed, dangling, and conflicting contribution links", () => {
    const data = migrate({
      ...source,
      sharedContributions: [
        ...source.sharedContributions,
        { ...source.sharedContributions[0], id: "duplicate" },
        { ...source.sharedContributions[0], id: "dangling", transferCreditTransactionId: "missing" },
        { id: "junk" },
      ],
    });
    expect(data.sharedContributions).toHaveLength(1);
    expect(data.sharedContributions[0]?.allocations).toEqual([{ expenseTransactionId: "loan", amount: 125000 }]);
  });

  it("adds an empty contribution collection to v8 data", () => {
    expect(migrate({ schemaVersion: 8, settings: { members: [] } }).sharedContributions).toEqual([]);
  });

  it("round-trips v10 multi-row allocations", () => {
    const data = migrate({
      ...source,
      schemaVersion: 10,
      transactions: [
        ...source.transactions,
        { id: "loan-2", date: "2026-07-04", description: "BANK STANDING ORDER", amount: 100000, category: "custom:vehicle-loan", account: "Owner Savings", direction: "debit", kind: "loan_payment" },
      ],
      sharedContributions: [{
        id: "multi",
        allocations: [
          { expenseTransactionId: "loan", amount: 75000 },
          { expenseTransactionId: "loan-2", amount: 50000 },
        ],
        transferDebitTransactionId: "out",
        transferCreditTransactionId: "in",
        contributorMemberId: "contributor",
        amount: 125000,
      }],
    });
    expect(data.sharedContributions[0]?.allocations).toEqual([
      { expenseTransactionId: "loan", amount: 75000 },
      { expenseTransactionId: "loan-2", amount: 50000 },
    ]);
  });
});
