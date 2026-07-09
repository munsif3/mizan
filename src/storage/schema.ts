import { seedAccounts } from "../domain/accounts";
import { isCategoryKey } from "../domain/categories";
import { cleanMerchant } from "../domain/rules";
import { personalCategory, RESERVED_IDS, uid } from "../domain/types";
import type {
  Account,
  AppData,
  CategoryKey,
  CsvMapping,
  FixedCost,
  Member,
  MerchantRules,
  Split,
  Transaction,
} from "../domain/types";

export const SCHEMA_VERSION = 5 as const;

export function emptyData(): AppData {
  return {
    schemaVersion: SCHEMA_VERSION,
    transactions: [],
    merchantRules: {},
    accounts: [],
    fixedCosts: [],
    settings: {
      members: [],
      targetSaveRate: 25,
      currency: "",
      locale: "",
      csvPresets: {},
    },
  };
}

function asCategory(value: unknown): CategoryKey {
  if (typeof value === "string") {
    // Legacy per-person keys (e.g. "munsif_personal") become "personal:<id>".
    const legacy = value.match(/^(.+)_personal$/);
    if (legacy) return personalCategory(legacy[1]!);
    if (isCategoryKey(value)) return value;
  }
  return "uncategorized";
}

function asSplit(value: unknown): Split | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { mine?: unknown; of?: unknown };
  const of = Number(raw.of);
  const mine = Number(raw.mine);
  if (!Number.isFinite(of) || !Number.isFinite(mine) || of < 2) return undefined;
  return { mine: Math.min(of, Math.max(0, mine)), of };
}

function asTransaction(value: unknown, splits: Record<string, unknown>): Transaction | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const date = String(raw.date ?? "");
  const amount = Number(raw.amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount)) return null;
  const id = String(raw.id ?? "") || `txn_${Math.random().toString(36).slice(2, 11)}`;
  const split = asSplit(raw.split) ?? asSplit(splits[id]);
  return {
    id,
    date,
    description: String(raw.description ?? ""),
    amount,
    category: asCategory(raw.category),
    // v1 stored the paying account under `card`
    account: String(raw.account ?? raw.card ?? "Unknown"),
    note: String(raw.note ?? ""),
    source: raw.source === "manual" ? "manual" : "imported",
    // pre-v4 data has no direction: every stored transaction was debit-only by construction
    direction: raw.direction === "credit" ? "credit" : "debit",
    ...(split ? { split } : {}),
  };
}

function asFixedCost(value: unknown): FixedCost | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return {
    id: String(raw.id ?? "") || `fixed_${Math.random().toString(36).slice(2, 11)}`,
    label: String(raw.label ?? "Fixed cost"),
    amount: Number(raw.amount) || 0,
    category: asCategory(raw.category),
    until: String(raw.until ?? "") || undefined,
  };
}

function asAccount(value: unknown): Account | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const label = String(raw.label ?? "").trim();
  if (!label) return null;
  // Owner may be any member id or "joint"; validated against the member list in migrate().
  const owner = typeof raw.owner === "string" && raw.owner.trim() ? raw.owner.trim() : "joint";
  const match = (Array.isArray(raw.match) ? raw.match : []).map((item) => String(item ?? "").trim()).filter(Boolean);
  return {
    id: String(raw.id ?? "") || uid("acc"),
    label,
    owner,
    match,
  };
}

function asMember(value: unknown): Member | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? "").trim();
  const name = String(raw.name ?? "").trim();
  if (!id || !name || (RESERVED_IDS as readonly string[]).includes(id)) return null;
  return {
    id,
    name,
    color: typeof raw.color === "string" && raw.color ? raw.color : "#5b8cff",
    income: Number(raw.income) || 0,
  };
}

function asRules(value: unknown): MerchantRules {
  if (!value || typeof value !== "object") return {};
  const rules: MerchantRules = {};
  for (const [merchant, category] of Object.entries(value as Record<string, unknown>)) {
    const key = cleanMerchant(merchant);
    const mapped = asCategory(category);
    // Only keep an explicit rule, not a fallback to uncategorized.
    if (key && mapped !== "uncategorized") rules[key] = mapped;
  }
  return rules;
}

function asCsvPresets(value: unknown): Record<string, CsvMapping> {
  if (!value || typeof value !== "object") return {};
  const presets: Record<string, CsvMapping> = {};
  for (const [key, mapping] of Object.entries(value as Record<string, unknown>)) {
    // Trust the persisted shape; the CSV importer re-validates before applying.
    if (mapping && typeof mapping === "object") presets[key] = mapping as CsvMapping;
  }
  return presets;
}

/**
 * True when the source is legacy two-person (Munsif + Sara) data that predates
 * the member list — v4 or a trackr v1 backup. Such data seeds two members whose
 * ids are the literal names, so account owners and category keys carry forward
 * without a lookup table.
 */
function hasLegacyCoupleData(settingsRaw: Record<string, unknown>, incomeRaw: Record<string, unknown>, source: Record<string, unknown>): boolean {
  if (Array.isArray(settingsRaw.members)) return false;
  if ("munsif" in incomeRaw || "sara" in incomeRaw) return true;
  const accounts = Array.isArray(source.accounts) ? source.accounts : [];
  if (accounts.some((a) => a && typeof a === "object" && ((a as Record<string, unknown>).owner === "munsif" || (a as Record<string, unknown>).owner === "sara"))) {
    return true;
  }
  const categorized = [
    ...(Array.isArray(source.transactions) ? source.transactions : []),
    ...(Array.isArray(source.fixedCosts) ? source.fixedCosts : []),
  ];
  return categorized.some(
    (c) => c && typeof c === "object" && /^(munsif|sara)_personal$/.test(String((c as Record<string, unknown>).category ?? "")),
  );
}

/**
 * Normalize any known stored/backup shape into schema v5.
 * Accepts Mizan v5/v4/v3/v2 data and trackr v1 backups (`splits` map, `card`
 * field, root-level `income`, `fixedNonCard`). Legacy two-person data seeds a
 * Munsif + Sara member list; data with no member list and no couple markers
 * yields an empty list (the app then shows onboarding). Accounts without a
 * registry get one seeded from the distinct labels. Unknown junk degrades to
 * empty data, never throws.
 */
export function migrate(raw: unknown): AppData {
  const base = emptyData();
  if (!raw || typeof raw !== "object") return base;
  const source = raw as Record<string, unknown>;

  const splits = (source.splits && typeof source.splits === "object" ? source.splits : {}) as Record<string, unknown>;
  const transactions = (Array.isArray(source.transactions) ? source.transactions : [])
    .map((txn) => asTransaction(txn, splits))
    .filter((txn): txn is Transaction => txn !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const fixedCosts = (Array.isArray(source.fixedCosts) ? source.fixedCosts : Array.isArray(source.fixedNonCard) ? source.fixedNonCard : [])
    .map(asFixedCost)
    .filter((cost): cost is FixedCost => cost !== null);

  const settingsRaw = (source.settings && typeof source.settings === "object" ? source.settings : {}) as Record<string, unknown>;
  const incomeRaw = ((settingsRaw.income ?? source.income) && typeof (settingsRaw.income ?? source.income) === "object"
    ? (settingsRaw.income ?? source.income)
    : {}) as Record<string, unknown>;

  const legacy = hasLegacyCoupleData(settingsRaw, incomeRaw, source);
  let members: Member[];
  if (Array.isArray(settingsRaw.members)) {
    members = settingsRaw.members.map(asMember).filter((m): m is Member => m !== null);
  } else if (legacy) {
    members = [
      { id: "munsif", name: "Munsif", color: "#5b8cff", income: Number(incomeRaw.munsif) || 0 },
      { id: "sara", name: "Sara", color: "#ff80b5", income: Number(incomeRaw.sara) || 0 },
    ];
  } else {
    members = [];
  }
  const memberIds = new Set(members.map((m) => m.id));

  const accounts = (Array.isArray(source.accounts)
    ? source.accounts.map(asAccount).filter((account): account is Account => account !== null)
    : seedAccounts(transactions, members)
  ).map((account) => (account.owner !== "joint" && !memberIds.has(account.owner) ? { ...account, owner: "joint" } : account));

  const currency = typeof settingsRaw.currency === "string" && settingsRaw.currency ? settingsRaw.currency : legacy ? "LKR" : "";
  const locale = typeof settingsRaw.locale === "string" && settingsRaw.locale ? settingsRaw.locale : legacy ? "en-LK" : "";

  return {
    schemaVersion: SCHEMA_VERSION,
    transactions,
    merchantRules: asRules(source.merchantRules),
    accounts,
    fixedCosts,
    settings: {
      members,
      targetSaveRate: Number(settingsRaw.targetSaveRate) || 25,
      currency,
      locale,
      csvPresets: asCsvPresets(settingsRaw.csvPresets),
    },
  };
}
