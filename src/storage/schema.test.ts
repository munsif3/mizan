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
  income: { munsif: 600000, sara: 800000 },
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

  it("normalizes rule keys and drops rules with unknown categories", () => {
    expect(data.merchantRules).toEqual({ "KEELLS SUPER": "food" });
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
      { id: "munsif", name: "Munsif", color: "#5b8cff", income: 600000 },
      { id: "sara", name: "Sara", color: "#ff80b5", income: 800000 },
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

describe("migrate (v4 couple -> v5 members)", () => {
  const v4 = {
    schemaVersion: 4,
    transactions: [
      { id: "t1", date: "2026-07-01", description: "GYM", amount: 5000, category: "munsif_personal", account: "Munsif Visa", direction: "debit", source: "imported" },
      { id: "t2", date: "2026-07-02", description: "SPA", amount: 8000, category: "sara_personal", account: "Sara Visa", direction: "debit", source: "imported" },
    ],
    accounts: [
      { id: "a1", label: "Munsif Visa", owner: "munsif", match: [] },
      { id: "a2", label: "Sara Visa", owner: "sara", match: [] },
      { id: "a3", label: "Old Card", owner: "ghost", match: [] },
    ],
    merchantRules: { GYM: "munsif_personal" },
    fixedCosts: [],
    settings: { income: { munsif: 600000, sara: 800000 }, targetSaveRate: 30 },
  };
  const data = migrate(v4);

  it("maps legacy per-person categories to personal:<id> in transactions and rules", () => {
    expect(data.transactions[0]!.category).toBe("personal:munsif");
    expect(data.transactions[1]!.category).toBe("personal:sara");
    expect(data.merchantRules).toEqual({ GYM: "personal:munsif" });
  });

  it("keeps owners that match members and forces unknown owners to joint", () => {
    expect(data.accounts.map((account) => account.owner)).toEqual(["munsif", "sara", "joint"]);
  });

  it("seeds the member list and preserves the target save rate", () => {
    expect(data.settings.members.map((member) => member.id)).toEqual(["munsif", "sara"]);
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
    expect(data.settings.members).toEqual([{ id: "kai", name: "Kai", color: "#5b8cff", income: 1000 }]);
    expect(data.settings.currency).toBe("EUR");
    // A personal category with no matching member is valid data — kept, not dropped.
    expect(data.transactions[0]!.category).toBe("personal:ghost");
  });

  it("yields an empty member list (triggers onboarding) for data with no couple markers", () => {
    expect(migrate(emptyData()).settings.members).toEqual([]);
  });
});
