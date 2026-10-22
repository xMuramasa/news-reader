// A cursor-paged list of story cards: skeletons, empty and error states, "Load more" (also triggered when the end of
// the list scrolls into view).
import { useEffect, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, StoryListSkeleton } from "@/components/States";
import { StoryCard } from "@/components/StoryCard";
import { useApi } from "@/lib/api";
import type { Filters } from "@/lib/filters";

export function useAutoLoad(enabled: boolean, load: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && load(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, load]);
  return ref;
}

export function LoadMore({
  hasMore,
  loading,
  onLoad,
  error,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoad: () => void;
  error?: unknown;
}) {
  const ref = useAutoLoad(hasMore && !loading && !error, onLoad);
  if (!hasMore) return null;
  return (
    <div ref={ref} className="flex flex-col items-center gap-2 py-4">
      {Boolean(error) && <p className="text-sm text-bad">Couldn't load more stories.</p>}
      <Button variant="outline" onClick={onLoad} disabled={loading}>
        {loading ? "Loading…" : error ? "Try again" : "Load more"}
      </Button>
    </div>
  );
}

export function StoryList({
  filters,
  empty,
  showFeed = true,
  pageSize = 20,
}: {
  filters: Filters;
  empty: React.ReactNode;
  showFeed?: boolean;
  pageSize?: number;
}) {
  const api = useApi();
  const q = useInfiniteQuery({
    queryKey: ["stories", filters, pageSize],
    queryFn: ({ pageParam }) => api.stories(filters, pageParam, pageSize),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  });

  if (q.isPending) return <StoryListSkeleton />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Couldn't load stories" />;
  const stories = q.data.pages.flatMap((p) => p.stories);
  if (!stories.length) return <>{empty}</>;
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-4" aria-label="Stories">
        {stories.map((s) => (
          <li key={s.id}>
            <StoryCard story={s} showFeed={showFeed} />
          </li>
        ))}
      </ol>
      <LoadMore
        hasMore={q.hasNextPage}
        loading={q.isFetchingNextPage}
        error={q.isFetchNextPageError ? q.error : undefined}
        onLoad={() => void q.fetchNextPage()}
      />
    </div>
  );
}

export function NoStories({ children }: { children?: React.ReactNode }) {
  return <EmptyState title="No stories">{children}</EmptyState>;
}
