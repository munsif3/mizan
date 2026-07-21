import { daysInMonth } from "./dates";
import type { Account, Member, MemberAwayPeriod, MemberLifecycle } from "./types";

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export type MemberStatus = "active" | "away" | "left" | "deceased" | "not_started";

export function validLifecycleDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return Boolean(year && month && day && day <= daysInMonth(`${year}-${String(month).padStart(2, "0")}`));
}

function normalizedAwayPeriods(value: unknown): MemberAwayPeriod[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index): MemberAwayPeriod[] => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const from = validLifecycleDate(raw.from) ? raw.from : "";
    const resumeOn = validLifecycleDate(raw.resumeOn) && raw.resumeOn > from ? raw.resumeOn : "";
    if (!from) return [];
    return [{
      id: String(raw.id ?? "").trim() || `away_${index}_${from}`,
      from,
      ...(resumeOn ? { resumeOn } : {}),
    }];
  }).sort((left, right) => left.from.localeCompare(right.from) || left.id.localeCompare(right.id));
}

export function normalizedMemberLifecycle(value: unknown): MemberLifecycle | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const activeFrom = validLifecycleDate(raw.activeFrom) ? raw.activeFrom : "";
  const candidateInactiveFrom = validLifecycleDate(raw.inactiveFrom) ? raw.inactiveFrom : "";
  const inactiveFrom = candidateInactiveFrom && (!activeFrom || candidateInactiveFrom > activeFrom)
    ? candidateInactiveFrom
    : "";
  const inactiveReason = inactiveFrom && (raw.inactiveReason === "left" || raw.inactiveReason === "deceased")
    ? raw.inactiveReason
    : undefined;
  const awayPeriods = normalizedAwayPeriods(raw.awayPeriods);
  if (!activeFrom && !inactiveFrom && !awayPeriods.length) return undefined;
  return {
    ...(activeFrom ? { activeFrom } : {}),
    ...(inactiveFrom ? { inactiveFrom } : {}),
    ...(inactiveFrom && inactiveReason ? { inactiveReason } : {}),
    awayPeriods,
  };
}

export function memberStatusOn(member: Member, date: string): MemberStatus {
  const lifecycle = member.lifecycle;
  if (lifecycle?.activeFrom && date < lifecycle.activeFrom) return "not_started";
  if (lifecycle?.inactiveFrom && date >= lifecycle.inactiveFrom) {
    return lifecycle.inactiveReason === "deceased" ? "deceased" : "left";
  }
  if (lifecycle?.awayPeriods.some((period) => date >= period.from && (!period.resumeOn || date < period.resumeOn))) {
    return "away";
  }
  return "active";
}

export function memberParticipatesOn(member: Member, date: string): boolean {
  return memberStatusOn(member, date) === "active";
}

export function participatingMembersOn(members: Member[], date: string): Member[] {
  return members.filter((member) => memberParticipatesOn(member, date));
}

export function memberParticipatesInMonth(member: Member, month: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return false;
  const count = daysInMonth(month);
  for (let day = 1; day <= count; day += 1) {
    if (memberParticipatesOn(member, `${month}-${String(day).padStart(2, "0")}`)) return true;
  }
  return false;
}

export function accountActiveOn(account: Account, date: string): boolean {
  return (!account.activeFrom || date >= account.activeFrom)
    && (!account.inactiveFrom || date < account.inactiveFrom);
}

export function memberLifecycleLabel(member: Member, today: string): string {
  const status = memberStatusOn(member, today);
  if (status === "deceased") return "Deceased";
  if (status === "left") return "Former member";
  if (status === "away") return "Away";
  if (status === "not_started") return "Starts later";
  return "Active";
}
