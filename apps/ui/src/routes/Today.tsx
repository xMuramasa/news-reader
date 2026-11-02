// `/`: one day's news (`?date=YYYY-MM-DD`, default today in Santiago): the phone layout below 1024 px, the desktop
// panels with the AT A GLANCE column from there up.
import { useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router";
import { ErrorState, StoryListSkeleton } from "@/components/States";
import { DayHeader, dayHref } from "@/components/today/DayHeader";
import { DesktopToday } from "@/components/today/DesktopToday";
import { PhoneToday } from "@/components/today/PhoneToday";
import { useDayStories } from "@/components/today/data";
import { addDays, formatDay, formatLongDay, isValidDate, santiagoToday } from "@/lib/dates";
import { useReadState } from "@/lib/read-state";
import { useTitle } from "@/lib/title";

const DESKTOP = "(min-width: 1024px)";

function useDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof matchMedia !== "function") return () => {};
      const m = matchMedia(DESKTOP);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => typeof matchMedia === "function" && matchMedia(DESKTOP).matches,
    () => false,
  );
}

export function Today() {
  const today = santiagoToday();
  const [params] = useSearchParams();
  const asked = params.get("date");
  const day = asked && isValidDate(asked) ? asked : today;
  const isToday = day === today;
  useTitle(isToday ? "Today" : formatDay(day));
  const desktop = useDesktop();
  const isRead = useReadState();
  const q = useDayStories(day);
  const data = q.data;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="sr-only">{isToday ? "Today" : formatLongDay(day)}</h1>
      <DayHeader
        day={day}
        today={today}
        readouts={
          data?.all.length
            ? { stories: data.all.length, unread: data.all.filter((s) => !isRead(s.id)).length, patchNow: data.patchNow.length, stack: data.stack.length }
            : undefined
        }
      />
      {q.isPending ? (
        <div role="status" aria-label="Loading the day">
          <StoryListSkeleton count={4} />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Couldn't load the day" />
      ) : !data?.all.length ? (
        <div className="border border-dashed border-rule bg-raised px-6 py-10 text-center">
          <p className="font-body text-sm">No editions for {formatDay(day)} yet. The briefings land around 03:00.</p>
          <Link to={dayHref(addDays(day, -1), today)} className="mt-3 inline-block font-label text-[0.6875rem] font-bold tracking-[0.8px] uppercase underline underline-offset-2">
            Go to {formatDay(addDays(day, -1))}
          </Link>
        </div>
      ) : desktop ? (
        <DesktopToday data={data} />
      ) : (
        <PhoneToday data={data} />
      )}
    </div>
  );
}
