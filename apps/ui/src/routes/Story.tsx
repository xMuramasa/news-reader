// `/s/:storyId`: the story as a quick read (summary, DO NOW, NEXT) with folded DETAILS, plus its thread. On a wide screen
// the thread, sources and coverage sit in a side column; on the phone they are accordions.
import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ChevronLeftIcon } from "lucide-react";
import type { StoryView } from "@news/schema";
import { RowTagChips } from "@/components/Chips";
import { ErrorState, NotFoundState, PageSkeleton } from "@/components/States";
import { Accordion, SECTION_LABEL, SideCard } from "@/components/story/Accordion";
import { CoverageSummary, Framing, SourceList, ThreadList, coverageCount, threadTimeline } from "@/components/story/Panels";
import { StoryActions } from "@/components/story/StoryActions";
import { TitleRule } from "@/components/TitleRule";
import { ApiError, useApi } from "@/lib/api";
import { formatDay, formatRunTime } from "@/lib/dates";
import { FEEDS, VERIFICATION_NOTES, sectionTitle } from "@/lib/feeds";
import { displayHeadline } from "@/lib/headline";
import { markRead } from "@/lib/read-state";
import { useTitle } from "@/lib/title";
import { cn } from "@/lib/utils";

export { threadTimeline };

const WIDE = "(min-width: 1024px)";
const META = "font-label text-[0.625rem] leading-none font-semibold tracking-[0.8px] uppercase";

function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof matchMedia !== "function") return () => {};
      const m = matchMedia(WIDE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => typeof matchMedia === "function" && matchMedia(WIDE).matches,
    () => false,
  );
}

/** Detail entries grouped by label, in first-seen order; NUMBERS and CONTEXT first, NEXT split out for the quick read. */
export function groupDetails(details: StoryView["details"]) {
  const by = new Map<string, { title: string; texts: string[] }>();
  for (const d of details) {
    const key = d.label.trim().toLowerCase();
    const g = by.get(key) ?? { title: d.label.trim(), texts: [] };
    g.texts.push(d.text);
    by.set(key, g);
  }
  const next = by.get("next")?.texts ?? [];
  by.delete("next");
  const rank = (k: string) => (k === "numbers" ? 0 : k === "context" ? 1 : 2);
  const groups = [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([, g]) => g);
  return { next, groups };
}

function Box({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <aside aria-label={label} className={cn("flex border border-rule bg-raised", className)}>
      <div aria-hidden className="w-[3px] shrink-0 bg-mark" />
      <div className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5 lg:px-4">
        <p className={cn(META, "tracking-[1.2px] text-muted-foreground")}>{label}</p>
        {children}
      </div>
    </aside>
  );
}

export function Story() {
  const { storyId = "" } = useParams();
  const api = useApi();
  const wide = useWide();
  const q = useQuery({ queryKey: ["story", storyId], queryFn: () => api.story(storyId) });
  useTitle((q.data ? displayHeadline(q.data.story) : null) ?? (q.isError ? "Story not found" : "Story"));
  useEffect(() => {
    if (q.data) markRead(q.data.story.id);
  }, [q.data]);

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.notFound) return <NotFoundState what="story" />;
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Couldn't load this story" />;
  }
  const s = q.data.story;
  const items = threadTimeline(q.data);
  const { next, groups } = groupDetails(s.details);
  const verification = VERIFICATION_NOTES[s.verification];
  const cov = coverageCount(s);
  const hasCoverage = s.coverage.length > 0;
  const hasFraming = s.framing.length > 0 || Boolean(s.blindspot);
  const showThread = items.length > 1;

  return (
    <div data-feed={s.feed} className="mx-auto grid max-w-[1200px] gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4 lg:gap-5">
        <div className="flex items-center gap-2.5">
          <Link
            to={`/e/${encodeURIComponent(s.edition_id)}#story-${s.slug}`}
            aria-label={`Back to the ${FEEDS[s.feed].label} edition of ${formatDay(s.edition_date)}`}
            className="-ml-2 inline-flex min-h-11 min-w-0 items-center gap-1.5 px-2 hover:underline lg:min-h-8"
          >
            <ChevronLeftIcon className="size-4 shrink-0" aria-hidden />
            <span aria-hidden className="feed-strip size-2 shrink-0" />
            <span className={cn(META, "truncate text-muted-foreground")}>
              {FEEDS[s.feed].label} // {sectionTitle(s.feed, s.section)}
            </span>
          </Link>
          <div className="ml-auto">
            <StoryActions s={s} />
          </div>
        </div>

        <p className={cn(META, "flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground")}>
          <time dateTime={s.edition_date}>{formatDay(s.edition_date)}</time>
          <span>· Edition {formatRunTime(s.run_at)}</span>
          {s.event_date && s.event_date !== s.edition_date && (
            <span>
              · Event <time dateTime={s.event_date}>{formatDay(s.event_date)}</time>
            </span>
          )}
          {verification && <span className="text-alert">· {verification.label}</span>}
        </p>

        <h1 className="font-display text-2xl leading-[1.15] font-bold lg:text-[2.125rem] lg:leading-[1.15]">{displayHeadline(s)}</h1>
        <RowTagChips tags={s.tags} feed={s.feed} max={99} />
        <TitleRule />

        <section aria-labelledby="quick-read" className="flex flex-col gap-4">
          <h2 id="quick-read" className={cn(META, "tracking-[1.2px] text-muted-foreground")}>
            Quick read
          </h2>
          <p className="reading text-base leading-[1.55] whitespace-pre-line lg:text-lg lg:leading-[1.6]">{s.summary}</p>
          {s.action && (
            <Box label="Do now">
              <p className="font-body text-[0.9375rem] leading-[1.45] font-medium whitespace-pre-line">{s.action}</p>
            </Box>
          )}
          {next.length > 0 && (
            <Box label="Next">
              {next.map((t, i) => (
                <p key={i} className="font-body text-[0.9375rem] leading-[1.45] font-medium whitespace-pre-line">
                  {t}
                </p>
              ))}
            </Box>
          )}
        </section>

        <section aria-labelledby="details" className="flex flex-col gap-2">
          <h2 id="details" className={cn(SECTION_LABEL, "mb-1 tracking-[1.2px] text-muted-foreground")}>
            Details
          </h2>
          {groups.map((g) => (
            <Accordion key={g.title.toLowerCase()} title={g.title} count={g.texts.length}>
              {g.texts.map((t, i) => (
                <p key={i} className={cn("font-body text-[0.9375rem] leading-[1.5] whitespace-pre-line", i > 0 && "border-t border-rule pt-3")}>
                  {t}
                </p>
              ))}
            </Accordion>
          ))}
          {(hasCoverage || hasFraming) && (
            <Accordion title="Coverage & framing" count={cov.groups}>
              {!wide && hasCoverage && <CoverageSummary s={s} />}
              <Framing s={s} />
            </Accordion>
          )}
          {!wide && s.sources.length > 0 && (
            <Accordion title="Sources" count={s.sources.length}>
              <SourceList s={s} />
            </Accordion>
          )}
          {!wide && showThread && (
            <Accordion title="Thread" count={`${items.length} days`}>
              <ThreadList items={items} currentId={s.id} />
            </Accordion>
          )}
        </section>
      </div>

      {wide && (
        <div className="flex flex-col gap-4">
          {showThread && (
            <SideCard title="Thread" count={`${items.length} days`}>
              <ThreadList items={items} currentId={s.id} />
            </SideCard>
          )}
          {s.sources.length > 0 && (
            <SideCard title="Sources" count={s.sources.length}>
              <SourceList s={s} />
            </SideCard>
          )}
          {hasCoverage && (
            <SideCard title="Coverage" count={`${cov.outlets} outlets`}>
              <CoverageSummary s={s} />
            </SideCard>
          )}
        </div>
      )}
    </div>
  );
}
