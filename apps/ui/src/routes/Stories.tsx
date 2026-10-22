// `/stories`: every story, with sort, feed, tags, date range, favorites-only and search, all in the URL.
import { useCallback, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { ListFilterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ActiveFilters, DateRange, FavoritesToggle, FeedFilter, SearchBox, SortSelect, TagFilter } from "@/components/Filters";
import { NoStories, StoryList } from "@/components/StoryList";
import { EMPTY_FILTERS, filtersToSearch, hasActiveFilters, parseFilters, toggleTag, type Filters } from "@/lib/filters";
import { useTitle } from "@/lib/title";

/** Filters from the URL, and a setter that writes them back (replace for typing, push for the rest). */
export function useUrlFilters(): [Filters, (f: Filters, opts?: { replace?: boolean }) => void] {
  const [sp, setSp] = useSearchParams();
  const key = sp.toString();
  const filters = useMemo(() => parseFilters(new URLSearchParams(key)), [key]);
  const set = useCallback(
    (f: Filters, opts: { replace?: boolean } = {}) => setSp(filtersToSearch(f), { replace: opts.replace ?? false }),
    [setSp],
  );
  return [filters, set];
}

export function FilterPanel({ filters, set, favoritesToggle = true }: { filters: Filters; set: (f: Filters) => void; favoritesToggle?: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <FeedFilter value={filters.feed} onChange={(feed) => set({ ...filters, feed })} />
      <DateRange from={filters.from} to={filters.to} onChange={(from, to) => set({ ...filters, from, to })} />
      {favoritesToggle && <FavoritesToggle value={filters.favorites} onChange={(favorites) => set({ ...filters, favorites })} />}
      <div>
        <h2 className="kicker mb-3 border-t border-border pt-4 text-muted-foreground">Tags</h2>
        <TagFilter feed={filters.feed} active={filters.tags} onToggle={(t) => set(toggleTag(filters, t))} />
      </div>
    </div>
  );
}

export function Stories() {
  useTitle("Stories");
  const [filters, setFilters] = useUrlFilters();
  const [sheet, setSheet] = useState(false);
  const location = useLocation();
  const focusSearch = Boolean((location.state as { focusSearch?: boolean } | null)?.focusSearch);
  const onSearch = useCallback((q: string) => setFilters({ ...filters, q }, { replace: true }), [filters, setFilters]);
  const count = filters.tags.length + (filters.feed ? 1 : 0) + (filters.from || filters.to ? 1 : 0) + (filters.favorites ? 1 : 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3 border-b-2 border-foreground pb-2">
        <h1 className="headline text-3xl font-semibold sm:text-4xl">Stories</h1>
      </div>
      <div className="flex items-center gap-2">
        <SearchBox value={filters.q} onChange={onSearch} autoFocus={focusSearch} />
        <SortSelect value={filters.sort} onChange={(sort) => setFilters({ ...filters, sort })} />
        <Button variant="outline" className="h-10 lg:hidden" onClick={() => setSheet(true)} aria-label={`Filters${count ? `, ${count} active` : ""}`}>
          <ListFilterIcon aria-hidden />
          <span className="hidden sm:inline">Filters</span>
          {count > 0 && <span className="rounded-full bg-foreground px-1.5 text-xs text-background">{count}</span>}
        </Button>
      </div>
      <ActiveFilters filters={filters} onChange={(f) => setFilters(f)} onClear={() => setFilters(EMPTY_FILTERS)} />
      <div className="lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
        <aside aria-label="Filters" className="hidden lg:block">
          <div className="sticky top-28 max-h-[calc(100dvh-8rem)] overflow-y-auto pr-2 pb-6">
            <FilterPanel filters={filters} set={(f) => setFilters(f)} />
          </div>
        </aside>
        <section aria-label="Results" className="min-w-0">
          <StoryList
            filters={filters}
            empty={
              <NoStories>
                {hasActiveFilters(filters) ? "Nothing matches these filters. Remove one or clear them all." : "No stories have been published yet."}
              </NoStories>
            }
          />
        </section>
      </div>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="right" aria-describedby="filters-desc">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription id="filters-desc">Results update as you choose.</SheetDescription>
          </SheetHeader>
          <div className="px-5 pb-8">
            <FilterPanel filters={filters} set={(f) => setFilters(f)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
