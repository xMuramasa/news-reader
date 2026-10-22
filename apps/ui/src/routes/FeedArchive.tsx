// `/f/:feed`: the feed's editions by month, newest first.
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import type { EditionSummary } from "@news/schema";
import { EmptyState, ErrorState, NotFoundState, StoryListSkeleton } from "@/components/States";
import { LoadMore } from "@/components/StoryList";
import { useApi } from "@/lib/api";
import { formatDay, formatMonth, formatRunTime } from "@/lib/dates";
import { FEEDS, isFeedId } from "@/lib/feeds";
import { useTitle } from "@/lib/title";

export function byMonth(editions: readonly EditionSummary[]): { month: string; editions: EditionSummary[] }[] {
  const out: { month: string; editions: EditionSummary[] }[] = [];
  for (const e of editions) {
    const m = e.edition_date.slice(0, 7);
    const last = out[out.length - 1];
    if (last && last.month === m) last.editions.push(e);
    else out.push({ month: m, editions: [e] });
  }
  return out;
}

function Archive({ feed }: { feed: keyof typeof FEEDS }) {
  const api = useApi();
  const def = FEEDS[feed];
  useTitle(`${def.label} archive`);
  const q = useInfiniteQuery({
    queryKey: ["editions", feed],
    queryFn: ({ pageParam }) => api.editions({ feed, before: pageParam, limit: 60 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  });

  let body: React.ReactNode;
  if (q.isPending) body = <StoryListSkeleton count={3} />;
  else if (q.isError && !q.data) body = <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Couldn't load the archive" />;
  else {
    const months = byMonth(q.data.pages.flatMap((p) => p.editions));
    body = !months.length ? (
      <EmptyState title="No editions yet">The first {def.label} edition shows up here once it's published.</EmptyState>
    ) : (
      <div className="flex flex-col gap-10">
        {months.map((m) => (
          <section key={m.month} aria-labelledby={`m-${m.month}`}>
            <h2 id={`m-${m.month}`} className="mb-3 border-b-2 border-foreground pb-1.5 headline text-2xl font-semibold">
              {formatMonth(m.month)}
            </h2>
            <ol className="flex flex-col divide-y divide-border">
              {m.editions.map((e) => (
                <li key={e.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 py-4 sm:grid-cols-[6rem_minmax(0,1fr)]">
                  <div className="text-sm">
                    <time dateTime={e.edition_date} className="font-semibold">
                      {formatDay(e.edition_date)}
                    </time>
                    <p className="text-xs text-muted-foreground">{formatRunTime(e.run_at)}</p>
                  </div>
                  <div className="min-w-0">
                    <h3 className="headline text-lg leading-snug font-semibold">
                      <Link to={`/e/${encodeURIComponent(e.id)}`} className="hover:underline">
                        {e.title}
                      </Link>
                    </h3>
                    <p className="reading mt-1 line-clamp-3 text-[0.95rem] text-foreground/90">{e.lead}</p>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {e.story_count} stories
                      {(e.section_counts.patch_now ?? 0) > 0 && <span className="font-semibold text-bad"> · {e.section_counts.patch_now} patch now</span>}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
        <LoadMore hasMore={q.hasNextPage} loading={q.isFetchingNextPage} error={q.isFetchNextPageError ? q.error : undefined} onLoad={() => void q.fetchNextPage()} />
      </div>
    );
  }

  return (
    <div data-feed={feed} className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div aria-hidden className="feed-rule h-1.5 w-24 rounded-full" />
        <p className="kicker text-feed">{def.cadence === "weekly" ? "Weekly" : "Daily"} briefing</p>
        <h1 className="headline text-3xl font-semibold sm:text-4xl">{def.label} archive</h1>
        <p className="text-sm">
          <Link to={`/stories?feed=${feed}`} className="underline underline-offset-2">
            Browse every {def.label} story
          </Link>
        </p>
      </header>
      {body}
    </div>
  );
}

export function FeedArchive() {
  const { feed = "" } = useParams();
  if (!isFeedId(feed)) return <NotFoundState what="feed" />;
  return <Archive key={feed} feed={feed} />;
}
