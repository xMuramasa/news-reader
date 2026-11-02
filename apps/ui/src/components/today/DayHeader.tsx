// The date header (numeral, month and year, weekday, TODAY chip, day steps), the title rule and the readouts.
import { Link } from "react-router";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { TitleRule } from "@/components/today/TitleRule";
import { addDays, isValidDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

const month = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short", year: "numeric" });
const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long" });

export const dayHref = (day: string, today: string) => (day === today ? "/" : `/?date=${day}`);

const STEP =
  "inline-flex size-11 items-center justify-center border border-outline bg-raised text-foreground hover:bg-sunken lg:size-[30px]";

export interface Readouts {
  stories: number;
  unread: number;
  patchNow: number;
  stack: number;
}

export function DayHeader({ day, today, readouts }: { day: string; today: string; readouts?: Readouts }) {
  const d = new Date(`${isValidDate(day) ? day : today}T12:00:00Z`);
  const isToday = day === today;
  const stats: [string, number, boolean?][] = readouts
    ? [
        ["Stories", readouts.stories],
        ["Unread", readouts.unread],
        ["Patch now", readouts.patchNow, true],
        ["Your stack", readouts.stack],
      ]
    : [];
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <p className="font-display text-[2.75rem] leading-none font-extrabold lg:text-[3.5rem]">{d.getUTCDate()}</p>
          <div className="flex flex-col gap-1.5 font-label text-[0.625rem] leading-none tracking-[1.5px] uppercase lg:text-xs">
            <span className="font-bold">
              <time dateTime={day}>{month.format(d)}</time>
            </span>
            <span className="flex items-center gap-2 font-medium text-muted-foreground">
              {weekday.format(d)}
              {isToday && <span className="bg-foreground px-1.5 py-[3px] font-bold tracking-[0.6px] text-mark">Today</span>}
            </span>
          </div>
          <div className="ml-auto flex gap-2 lg:ml-3">
            <Link to={dayHref(addDays(day, -1), today)} aria-label="Previous day" className={STEP}>
              <ChevronLeftIcon className="size-4" aria-hidden />
            </Link>
            {day < today ? (
              <Link to={dayHref(addDays(day, 1), today)} aria-label="Next day" className={STEP}>
                <ChevronRightIcon className="size-4" aria-hidden />
              </Link>
            ) : (
              <button type="button" disabled aria-label="Next day" className={cn(STEP, "opacity-40")}>
                <ChevronRightIcon className="size-4" aria-hidden />
              </button>
            )}
          </div>
        </div>
        <TitleRule />
      </div>
      {stats.length > 0 && (
        <dl className="flex gap-6 lg:gap-8 lg:pt-2">
          {stats.map(([label, n, alert]) => (
            <div key={label} className="flex flex-col-reverse gap-1 lg:items-center">
              <dt className="font-label text-[0.5625rem] leading-none tracking-[1px] text-muted-foreground uppercase lg:text-[0.625rem]">{label}</dt>
              <dd className={cn("font-display text-[1.375rem] leading-none font-bold lg:text-[1.625rem]", alert && n > 0 && "text-alert")}>{n}</dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}
