const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function validISODate(year: string, month: string, day: string): string {
  const yyyy = year.padStart(4, "0");
  const mm = month.padStart(2, "0");
  const dd = day.padStart(2, "0");
  const yearNumber = Number(yyyy);
  const monthNumber = Number(mm);
  const dayNumber = Number(dd);
  if (!Number.isInteger(yearNumber) || yearNumber < 1 || yearNumber > 9999) return "";
  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return "";
  if (!Number.isInteger(dayNumber) || dayNumber < 1) return "";
  if (new Date(Date.UTC(yearNumber, monthNumber, 0)).getUTCDate() < dayNumber) return "";
  return `${yyyy}-${mm}-${dd}`;
}

/** "2026-07-14" -> "2026-07" */
export function monthOf(date: string | undefined): string {
  return String(date ?? "").slice(0, 7);
}

/**
 * The newest valid month represented by a transaction list. Row order is not a
 * signal because statements can be printed in posting-date order.
 */
export function latestMonth(transactions: { date: string }[]): string {
  return transactions.reduce((latest, txn) => {
    const month = monthOf(txn.date);
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month > latest ? month : latest;
  }, "");
}

/** "2026-07" -> "Jul 2026" */
export function monthLabel(month: string): string {
  if (!month) return "";
  const [year, rawMonth] = month.split("-");
  return `${MONTH_NAMES[Number(rawMonth) - 1] ?? rawMonth} ${year}`;
}

/** Accepts "14/07/2026", "14-07-26", "2026-07-14"; returns ISO date or "". */
export function toISODate(value: unknown): string {
  const text = String(value ?? "").trim();
  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slash) {
    const day = slash[1]!.padStart(2, "0");
    const month = slash[2]!.padStart(2, "0");
    const year = slash[3]!.length === 2 ? `20${slash[3]}` : slash[3]!;
    return validISODate(year, month, day);
  }
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return validISODate(iso[1]!, iso[2]!, iso[3]!);
  return "";
}

/**
 * Parse a date with an explicit component order (for CSV imports where the
 * column order is chosen by the user). A YYYY-MM-DD-looking value is always
 * read as ISO regardless of `order`. Returns "" if it can't be parsed.
 */
export function toISODateOrdered(value: unknown, order: "dmy" | "mdy" | "ymd"): string {
  const text = String(value ?? "").trim();
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return validISODate(iso[1]!, iso[2]!, iso[3]!);
  const parts = text.match(/^(\d{1,4})[-/.](\d{1,4})[-/.](\d{1,4})$/);
  if (!parts) return "";
  const [a, b, c] = [parts[1]!, parts[2]!, parts[3]!];
  let year: string;
  let month: string;
  let day: string;
  if (order === "ymd") [year, month, day] = [a, b, c];
  else if (order === "mdy") [month, day, year] = [a, b, c];
  else [day, month, year] = [a, b, c];
  year = year.length <= 2 ? `20${year.padStart(2, "0")}` : year.padStart(4, "0");
  return validISODate(year, month, day);
}

export function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return 30;
  return new Date(year, monthNumber, 0).getDate();
}

/** "2026-07" + 2 -> "2026-09" */
export function addMonths(month: string, count: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  const total = year * 12 + (monthNumber - 1) + count;
  const newYear = Math.floor(total / 12);
  const newMonth = (total % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, "0")}`;
}

export function isoDateOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
