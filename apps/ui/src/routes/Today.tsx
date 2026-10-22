// `/`: the latest edition of each feed, then every story from the last 7 days.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ArrowRightIcon } from "lucide-react";
import type { FeedInfo } from "@news/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/States";
import { NoStories, StoryList } from "@/components/StoryList";
import { useApi } from "@/lib/api";
import { addDays, formatDay, formatRunTime, santiagoToday } from "@/lib/dates";
import { EMPTY_FILTERS } from "@/lib/filters";
import { useTitle } from "@/lib/title";

function EditionCard({ feed }: { feed: FeedInfo }) {
  const e = feed.latest;
  const patch = e?.section_counts.patch_now ?? 0;
  const stack = e?.section_counts.your_stack ?? 0;
  return (
    <article data-feed={feed.id} className="relative flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div aria-hidden className="feed-rule h-1.5" />
      <div className="flex flex-1 flex-col gap-2 p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="kicker text-feed">
            <Link to={`/f/${feed.id}`} className="hover:underline">
              {feed.label}
            </Link>
          </h2>
          <span className="text-xs text-muted-foreground">{feed.cadence === "weekly" ? "Weekly" : "Daily"}</span>
        </div>
        {e ? (
          <>
            <p className="text-xs text-muted-foreground">
              <time dateTime={e.edition_date}>{formatDay(e.edition_date)}</time> · {formatRunTime(e.run_at)}
            </p>
            <h3 className="headline text-xl leading-snug font-semibold">
              <Link to={`/e/${encodeURIComponent(e.id)}`} className="hover:underline">
                {e.title}
              </Link>
            </h3>
            <p className="reading text-[0.975rem] text-foreground/90">{e.lead}</p>
            <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-sm">
              <span className="text-muted-foreground">{e.story_count} stories</span>
              {feed.id === "cyber" && patch > 0 && <span className="font-semibold text-bad">{patch} patch now</span>}
              {feed.id === "cyber" && stack > 0 && <span className="font-semibold text-feed">{stack} your stack</span>}
              <Link to={`/e/${encodeURIComponent(e.id)}`} className="ml-auto inline-flex items-center gap-1 font-medium text-feed hover:underline" aria-label={`Read the ${feed.label} edition`}>
                Read <ArrowRightIcon className="size-4" aria-hidden />
              </Link>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No edition yet.</p>
        )}
      </div>
    </article>
  );
}

export function Today() {
  useTitle("Today");
  const api = useApi();
  const feeds = useQuery({ queryKey: ["today", "feeds"], queryFn: () => api.feeds() });
  const from = addDays(santiagoToday(), -6);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="latest-h">
        <h1 id="latest-h" className="sr-only">
          Today
        </h1>
        <p className="kicker mb-3 text-muted-foreground">Latest editions</p>
        {feeds.isPending ? (
          <div className="grid gap-4 md:grid-cols-3" role="status" aria-label="Loading editions">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-6 w-5/6" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ))}
          </div>
        ) : feeds.isError ? (
          <ErrorState error={feeds.error} onRetry={() => void feeds.refetch()} title="Couldn't load the editions" />
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {feeds.data.feeds.map((f) => (
              <EditionCard key={f.id} feed={f} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="week-h" className="mx-auto w-full max-w-3xl">
        <div className="mb-4 flex items-baseline justify-between gap-3 border-b-2 border-foreground pb-2">
          <h2 id="week-h" className="headline text-2xl font-semibold">
            The last 7 days
          </h2>
          <Link to={`/stories?from=${from}`} className="text-sm underline-offset-2 hover:underline">
            Filter these
          </Link>
        </div>
        <StoryList
          filters={{ ...EMPTY_FILTERS, from }}
          empty={<NoStories>Nothing in the last 7 days yet. New editions show up here once they're published.</NoStories>}
        />
      </section>
    </div>
  );
}
