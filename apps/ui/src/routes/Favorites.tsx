// `/favorites`: saved stories, most recently saved first. The API returns them in saved order with a snapshot for
// stories that are gone; feed, tag and text filters (in the URL, like /stories) apply to the loaded favorites.
import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ListFilterIcon } from "lucide-react";
import type { FavoriteView } from "@news/schema";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ActiveFilters, SearchBox } from "@/components/Filters";
import { EmptyState, ErrorState, StoryListSkeleton } from "@/components/States";
import { SnapshotRow, StoryRow } from "@/components/StoryRow";
import { LoadMore } from "@/components/StoryList";
import { useApi } from "@/lib/api";
import { EMPTY_FILTERS, hasActiveFilters, type Filters } from "@/lib/filters";
import { useTitle } from "@/lib/title";
import { FilterPanel, useUrlFilters } from "./Stories";

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();

/** Client-side filter over loaded favorites. A snapshot (story gone) only knows feed, date and headline. */
export function matchesFavorite(f: FavoriteView, filters: Filters): boolean {
  const s = f.story;
  const feed = s?.feed ?? f.snapshot.feed;
  if (filters.feed && feed !== filters.feed) return false;
  const date = s?.edition_date ?? f.snapshot.edition_date;
  if (filters.from && date < filters.from) return false;
  if (filters.to && date > filters.to) return false;
  if (filters.tags.length && (!s || !filters.tags.every((t) => s.tags.includes(t)))) return false;
  if (filters.q) {
    const hay = fold(s ? [s.headline, s.summary, ...s.details.map((d) => d.text), ...s.tags].join(" ") : f.snapshot.headline);
    if (!fold(filters.q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
  }
  return true;
}

export function Favorites() {
  useTitle("Favorites");
  const api = useApi();
  const [filters, setFilters] = useUrlFilters();
  const [sheet, setSheet] = useState(false);
  const view = useMemo(() => ({ ...filters, favorites: false, sort: "newest" as const }), [filters]);
  const q = useInfiniteQuery({
    queryKey: ["favorites"],
    queryFn: ({ pageParam }) => api.favorites(pageParam, 100),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  });
  const onSearch = useCallback((text: string) => setFilters({ ...view, q: text }, { replace: true }), [view, setFilters]);

  let body: React.ReactNode;
  if (q.isPending) body = <StoryListSkeleton />;
  else if (q.isError && !q.data) body = <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Couldn't load favorites" />;
  else {
    const all = q.data.pages.flatMap((p) => p.favorites);
    const shown = all.filter((f) => matchesFavorite(f, view));
    body = !all.length ? (
      <EmptyState title="No favorites yet">Use the ★ on any story (or press s on a focused story) to save it here.</EmptyState>
    ) : (
      <div className="flex flex-col gap-4">
        {shown.length ? (
          <ol className="flex flex-col gap-1.5" aria-label="Favorites">
            {shown.map((f) => (
              <li key={f.story_id}>{f.story ? <StoryRow story={f.story} showFeed showDate /> : <SnapshotRow storyId={f.story_id} snapshot={f.snapshot} />}</li>
            ))}
          </ol>
        ) : (
          <EmptyState title="No matching favorites">
            {q.hasNextPage ? "None of the loaded favorites match. Load more, or change the filters." : "Change or clear the filters."}
          </EmptyState>
        )}
        <LoadMore
          hasMore={q.hasNextPage}
          loading={q.isFetchingNextPage}
          error={q.isFetchNextPageError ? q.error : undefined}
          onLoad={() => void q.fetchNextPage()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3 border-b-2 border-foreground pb-2">
        <h1 className="headline text-3xl font-semibold sm:text-4xl">Favorites</h1>
        <span className="pb-1 text-sm text-muted-foreground">Most recently saved first</span>
      </div>
      <div className="flex items-center gap-2">
        <SearchBox value={view.q} onChange={onSearch} placeholder="Search your favorites…" />
        <Button variant="outline" className="h-10 lg:hidden" onClick={() => setSheet(true)} aria-label="Filters">
          <ListFilterIcon aria-hidden />
          <span className="hidden sm:inline">Filters</span>
        </Button>
      </div>
      <ActiveFilters filters={view} onChange={(f) => setFilters(f)} onClear={() => setFilters(EMPTY_FILTERS)} />
      <div className="lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
        <aside aria-label="Filters" className="hidden lg:block">
          <div className="sticky top-28 max-h-[calc(100dvh-8rem)] overflow-y-auto pr-2 pb-6">
            <FilterPanel filters={view} set={(f) => setFilters(f)} favoritesToggle={false} />
          </div>
        </aside>
        <section aria-label={hasActiveFilters(view) ? "Filtered favorites" : "All favorites"} className="min-w-0">
          {body}
        </section>
      </div>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="right" aria-describedby="fav-filters-desc">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription id="fav-filters-desc">Applied to your saved stories.</SheetDescription>
          </SheetHeader>
          <div className="px-5 pb-8">
            <FilterPanel filters={view} set={(f) => setFilters(f)} favoritesToggle={false} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
