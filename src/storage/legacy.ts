import type { Member, MemberId } from "../domain/types";

type LegacyPersonalCategoryKey = `personal:${string}`;

function legacyPersonalId(value: unknown): MemberId | null {
  const match = typeof value === "string" ? value.match(/^(.+)_personal$/) : null;
  return match?.[1] ?? null;
}

export function legacyCategory(value: string): LegacyPersonalCategoryKey | null {
  const id = legacyPersonalId(value);
  return id ? `personal:${id}` : null;
}

export function legacyMemberIds(
  settingsRaw: Record<string, unknown>,
  incomeRaw: Record<string, unknown>,
  source: Record<string, unknown>,
): MemberId[] {
  if (Array.isArray(settingsRaw.members)) return [];
  const ids = new Set<string>();
  for (const key of Object.keys(incomeRaw)) {
    if (key.trim()) ids.add(key.trim());
  }
  if (ids.size) return [...ids].sort();
  for (const account of Array.isArray(source.accounts) ? source.accounts : []) {
    if (account && typeof account === "object") {
      const owner = String((account as Record<string, unknown>).owner ?? "").trim();
      if (owner && owner !== "joint") ids.add(owner);
    }
  }
  for (const item of [
    ...(Array.isArray(source.transactions) ? source.transactions : []),
    ...(Array.isArray(source.fixedCosts) ? source.fixedCosts : []),
    ...(Array.isArray(source.fixedNonCard) ? source.fixedNonCard : []),
  ]) {
    if (item && typeof item === "object") {
      const id = legacyPersonalId((item as Record<string, unknown>).category);
      if (id) ids.add(id);
    }
  }
  return [...ids].sort();
}

export function legacyMembers(ids: MemberId[], incomeRaw: Record<string, unknown>): Member[] {
  const colors = ["#5b8cff", "#ff80b5", "#f2b84b", "#78d9b2", "#b28cff"];
  return ids.map((id, index) => {
    const amount = Number(incomeRaw[id]) || 0;
    return {
      id,
      name: `Member ${index + 1}`,
      color: colors[index % colors.length]!,
      portions: amount > 0 ? [{
        id: `por_${id}`,
        label: "Monthly income",
        amount,
        currency: "",
        taxRate: 0,
        taxWithheld: true,
        window: null,
        schedule: { frequency: "monthly" },
        budgetTreatment: "ordinary",
      }] : [],
    };
  });
}
