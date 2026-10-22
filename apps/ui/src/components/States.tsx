import { Link } from "react-router";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";

export function StoryListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading stories" className="flex flex-col gap-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex overflow-hidden rounded-lg border border-border bg-card">
          <div className="w-1 bg-muted" />
          <div className="flex flex-1 flex-col gap-3 p-5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-6 w-4/5" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-5 w-full max-w-xl" />
      <div className="mt-4">
        <StoryListSkeleton count={3} />
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong/50 px-6 py-10 text-center">
      <p className="headline text-xl font-semibold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong.";
}

export function ErrorState({ error, onRetry, title = "Couldn't load this" }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="rounded-lg border border-bad/40 bg-danger/40 px-6 py-8 text-center">
      <p className="headline text-xl font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          <RefreshCwIcon aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
}

export function NotFoundState({ what = "page" }: { what?: string }) {
  return (
    <section aria-labelledby="nf-title" className="mx-auto max-w-xl py-16 text-center">
      <p className="kicker text-muted-foreground">404</p>
      <h1 id="nf-title" className="headline mt-2 text-4xl font-semibold">
        No such {what}
      </h1>
      <p className="mt-3 text-muted-foreground">It may have been replaced by a later run, or the link is mistyped.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Button asChild>
          <Link to="/">Today</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/stories">All stories</Link>
        </Button>
      </div>
    </section>
  );
}
