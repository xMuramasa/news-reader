// `/s/:storyId`: one story in full plus its thread timeline (the same story on earlier and later days).
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ChevronLeftIcon } from "lucide-react";
import type { StoryResponse, StoryView } from "@news/schema";
import { ErrorState, NotFoundState, PageSkeleton } from "@/components/States";
import { StoryCard } from "@/components/StoryCard";
import { ApiError, useApi } from "@/lib/api";
import { formatDay, formatRunTime } from "@/lib/dates";
import { FEEDS, sectionTitle } from "@/lib/feeds";
import { markRead } from "@/lib/read-state";
import { useTitle } from "@/lib/title";
import { cn } from "@/lib/utils";
import { displayHeadline } from "@/lib/headline";

/** Oldest first, the current story included. */
export function threadTimeline(r: StoryResponse): StoryView[] {
  return [...r.thread.earlier, r.story, ...r.thread.later].sort((a, b) => a.run_at.localeCompare(b.run_at) || a.id.localeCompare(b.id));
}

function Timeline({ items, currentId }: { items: StoryView[]; currentId: string }) {
  return (
    <section aria-labelledby="thread-h" className="measure">
      <h2 id="thread-h" className="mb-4 border-b-2 border-foreground pb-1.5 headline text-2xl font-semibold">
        Thread
      </h2>
      <ol className="relative flex flex-col gap-0 border-l-2 border-border pl-5">
        {items.map((s) => {
          const current = s.id === currentId;
          return (
            <li key={s.id} className="relative pb-5 last:pb-0">
              <span
                aria-hidden
                className={cn("absolute top-1.5 -left-[1.6rem] size-3 rounded-full border-2 border-card", current ? "bg-feed" : "bg-border-strong")}
              />
              <p className="text-xs text-muted-foreground">
                <time dateTime={s.edition_date}>{formatDay(s.edition_date)}</time> · {sectionTitle(s.feed, s.section)}
                {s.is_update && " · update"}
              </p>
              {current ? (
                <p aria-current="true" className="headline text-[1.05rem] leading-snug font-semibold">
                  {displayHeadline(s)} <span className="text-xs font-normal text-muted-foreground">(this story)</span>
                </p>
              ) : (
                <Link to={`/s/${encodeURIComponent(s.id)}`} className="headline text-[1.05rem] leading-snug hover:underline">
                  {displayHeadline(s)}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function Story() {
  const { storyId = "" } = useParams();
  const api = useApi();
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
  return (
    <div data-feed={s.feed} className="mx-auto flex max-w-3xl flex-col gap-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link to={`/e/${encodeURIComponent(s.edition_id)}#story-${s.slug}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline">
          <ChevronLeftIcon className="size-4" aria-hidden />
          {FEEDS[s.feed].label} · {formatDay(s.edition_date)} edition, {formatRunTime(s.run_at)}
        </Link>
      </nav>
      <StoryCard story={s} variant="full" heading="h1" linkHeadline={false} />
      {items.length > 1 && <Timeline items={items} currentId={s.id} />}
    </div>
  );
}
