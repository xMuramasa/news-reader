// Dates in briefings are calendar dates (YYYY-MM-DD, Santiago). Format them in UTC so the browser's time zone can't
// shift the day; run times are instants and are shown in Santiago time.

export const TZ = "America/Santiago";
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.toISOString().slice(0, 10) === s;
}

function utc(date: string): Date | null {
  return isValidDate(date) ? new Date(`${date}T12:00:00Z`) : null;
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts });
const shortDay = fmt({ weekday: "short", day: "numeric", month: "short" });
const longDay = fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dayMonthYear = fmt({ day: "numeric", month: "short", year: "numeric" });
const monthYear = fmt({ month: "long", year: "numeric" });

/** "Wed 21 Oct" */
export function formatDay(date: string): string {
  const d = utc(date);
  return d ? shortDay.format(d).replace(",", "") : date;
}

/** "Wednesday 21 October 2026" */
export function formatLongDay(date: string): string {
  const d = utc(date);
  return d ? longDay.format(d).replace(",", "") : date;
}

/** "21 Oct 2026" */
export function formatDate(date: string): string {
  const d = utc(date);
  return d ? dayMonthYear.format(d) : date;
}

/** "October 2026" from "2026-10" */
export function formatMonth(month: string): string {
  const d = utc(`${month}-01`);
  return d ? monthYear.format(d) : month;
}

const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

/** "08:04" (Santiago) */
export function formatRunTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : time.format(d);
}

const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Today's date in Santiago, YYYY-MM-DD. */
export function santiagoToday(now: Date = new Date()): string {
  return ymd.format(now);
}

export function addDays(date: string, days: number): string {
  const d = utc(date);
  if (!d) return date;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
