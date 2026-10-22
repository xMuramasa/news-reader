// `/e/:editionId`: the reading view. Table of contents (sticky sidebar from lg, a sheet below), sections in feed
// order, markets strip (Chile), gaps note, prev/next and the same-day run switcher.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router";
import { CheckCheckIcon, ChevronLeftIcon, ChevronRightIcon, ListIcon } from "lucide-react";
import type { EditionView, Markets, StoryView } from "@news/schema";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ErrorState, NotFoundState, PageSkeleton } from "@/components/States";
import { StoryCard } from "@/components/StoryCard";
import { ApiError, useApi } from "@/lib/api";
import { formatDate, formatDay, formatLongDay, formatRunTime } from "@/lib/dates";
import { FEEDS } from "@/lib/feeds";
import { markRead, useReadState } from "@/lib/read-state";
import { useTitle } from "@/lib/title";
import { cn } from "@/lib/utils";

export interface EditionSection {
  id: string;
  title: string;
  stories: StoryView[];
}

/** Sections in the feed's order, empty ones dropped; unknown sections (shouldn't happen) go last. */
export function editionSections(e: Pick<EditionView, "feed" | "stories">): EditionSection[] {
  const defs = FEEDS[e.feed].sections;
  const out: EditionSection[] = defs.map((d) => ({ id: d.id, title: d.title, stories: e.stories.filter((s) => s.section === d.id) }));
  const known = new Set(defs.map((d) => d.id));
  for (const s of e.stories) {
    if (known.has(s.section)) continue;
    let sec = out.find((x) => x.id === s.section);
    if (!sec) out.push((sec = { id: s.section, title: s.section.replace(/_/g, " "), stories: [] }));
    sec.stories.push(s);
  }
  return out.filter((x) => x.stories.length);
}

const anchor = (kind: "sec" | "story", id: string) => `${kind}-${id}`;

function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  const target = el.matches("[tabindex]") ? el : el.querySelector<HTMLElement>("[data-story-card]") ?? el;
  target.focus({ preventScroll: true });
  history.replaceState(history.state, "", `#${id}`);
}

function Toc({ sections, onPick }: { sections: EditionSection[]; onPick?: () => void }) {
  const isRead = useReadState();
  return (
    <nav aria-label="Contents">
      <ol className="flex flex-col gap-4">
        {sections.map((sec) => (
          <li key={sec.id}>
            <a
              href={`#${anchor("sec", sec.id)}`}
              className="kicker text-feed hover:underline"
              onClick={(e) => {
                e.preventDefault();
                onPick?.();
                setTimeout(() => jumpTo(anchor("sec", sec.id)), onPick ? 50 : 0);
              }}
            >
              {sec.title}
            </a>
            <ol className="mt-1.5 flex flex-col gap-1.5 border-l border-border pl-3">
              {sec.stories.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${anchor("story", s.slug)}`}
                    className={cn("block text-[0.8125rem] leading-snug hover:text-foreground hover:underline", isRead(s.id) ? "text-muted-foreground" : "text-foreground")}
                    onClick={(e) => {
                      e.preventDefault();
                      onPick?.();
                      setTimeout(() => jumpTo(anchor("story", s.slug)), onPick ? 50 : 0);
                    }}
                  >
                    {s.headline}
                  </a>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function MarketsStrip({ markets }: { markets: Markets }) {
  if (!markets.items.length) return null;
  return (
    <section aria-labelledby="markets-h" className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 id="markets-h" className="kicker text-muted-foreground">
          Markets
        </h2>
        {markets.as_of && <span className="text-xs text-muted-foreground">Close of {formatDate(markets.as_of)}</span>}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 md:grid-cols-4">
        {markets.items.map((m, i) => {
          const ch = m.change?.trim() ?? "";
          const dir = /^[-−–]/.test(ch) ? "down" : /^\+?0*[.,]?0*%?$/.test(ch) ? "flat" : ch ? "up" : "flat";
          return (
            <div key={`${m.name}-${i}`} className="min-w-0">
              <dt className="truncate text-xs text-muted-foreground">{m.name}</dt>
              <dd className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold tabular-nums">{m.value}</span>
                {ch && (
                  <span className={cn("text-xs font-medium tabular-nums", dir === "down" && "text-bad", dir === "up" && "text-ok")}>
                    <span aria-hidden>{dir === "down" ? "▼ " : dir === "up" ? "▲ " : ""}</span>
                    {ch}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function EditionNav({ e, label }: { e: EditionView; label: string }) {
  return (
    <nav aria-label={label} className="flex items-center justify-between gap-3 text-sm">
      {e.prev ? (
        <Link to={`/e/${encodeURIComponent(e.prev)}`} className="inline-flex items-center gap-1 hover:underline" rel="prev">
          <ChevronLeftIcon className="size-4" aria-hidden /> Previous edition
        </Link>
      ) : (
        <span />
      )}
      <Link to={`/f/${e.feed}`} className="text-muted-foreground hover:text-foreground hover:underline">
        {FEEDS[e.feed].label} archive
      </Link>
      {e.next ? (
        <Link to={`/e/${encodeURIComponent(e.next)}`} className="inline-flex items-center gap-1 hover:underline" rel="next">
          Next edition <ChevronRightIcon className="size-4" aria-hidden />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

function SameDaySwitcher({ e }: { e: EditionView }) {
  if (e.same_day.length < 2) return null;
  return (
    <nav aria-label="Runs on this day" className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="text-muted-foreground">Runs on {formatDay(e.edition_date)}:</span>
      {e.same_day.map((r) => {
        const current = r.id === e.id;
        return (
          <Link
            key={r.id}
            to={`/e/${encodeURIComponent(r.id)}`}
            aria-current={current ? "page" : undefined}
            className={cn(
              "rounded-full border px-2.5 py-0.5 tabular-nums",
              current ? "border-feed bg-feed text-on-accent" : "border-border bg-card hover:bg-muted",
            )}
          >
            {formatRunTime(r.run_at)}
            {r.latest && <span className="sr-only"> (latest)</span>}
            {r.latest && !current && <span aria-hidden> · latest</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function Edition() {
  const { editionId = "" } = useParams();
  const api = useApi();
  const q = useQuery({ queryKey: ["edition", editionId], queryFn: () => api.edition(editionId) });
  const [tocOpen, setTocOpen] = useState(false);
  const isRead = useReadState();
  const e = q.data?.edition;
  useTitle(e ? e.title : q.isError ? "Edition not found" : "Edition");
  const { hash } = useLocation();
  const loaded = Boolean(e);
  useEffect(() => {
    // Deep links such as /e/<id>#story-<slug>: the target exists only once the edition has loaded.
    if (loaded && /^#(sec|story)-[a-z0-9_-]+$/.test(hash)) jumpTo(hash.slice(1));
  }, [loaded, hash]);

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.notFound) return <NotFoundState what="edition" />;
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Couldn't load this edition" />;
  }
  const ed = q.data.edition;
  const sections = editionSections(ed);
  const unread = ed.stories.filter((s) => !isRead(s.id)).length;

  return (
    <article data-feed={ed.feed} aria-labelledby="edition-title" className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div aria-hidden className="feed-rule h-1.5 w-24 rounded-full" />
        <p className="kicker text-feed">
          {FEEDS[ed.feed].label} · <time dateTime={ed.edition_date}>{formatLongDay(ed.edition_date)}</time>
        </p>
        <h1 id="edition-title" className="headline text-[2rem] leading-[1.1] font-semibold sm:text-[2.6rem]">
          {ed.title}
        </h1>
        <p className="reading measure text-[1.15rem] leading-relaxed">{ed.lead}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span>
            {ed.story_count} stories · published {formatRunTime(ed.run_at)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2.5"
            disabled={unread === 0}
            onClick={() => markRead(ed.stories.map((s) => s.id))}
          >
            <CheckCheckIcon aria-hidden /> {unread === 0 ? "All read" : `Mark edition read (${unread})`}
          </Button>
          <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setTocOpen(true)}>
            <ListIcon aria-hidden /> Contents
          </Button>
        </div>
        <SameDaySwitcher e={ed} />
        {(ed.prev || ed.next) && <EditionNav e={ed} label="Previous and next edition" />}
      </header>

      {ed.markets && <MarketsStrip markets={ed.markets} />}

      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        <aside className="hidden lg:block" aria-label="Table of contents">
          <div className="sticky top-28 max-h-[calc(100dvh-8rem)] overflow-y-auto pr-2 pb-6">
            <Toc sections={sections} />
          </div>
        </aside>
        <div className="flex min-w-0 flex-col gap-10">
          {sections.map((sec) => (
            <section key={sec.id} id={anchor("sec", sec.id)} tabIndex={-1} aria-labelledby={`${anchor("sec", sec.id)}-h`} className="scroll-mt-28 outline-none">
              <h2 id={`${anchor("sec", sec.id)}-h`} className="mb-4 flex items-baseline gap-3 border-b-2 border-foreground pb-1.5">
                <span className="headline text-2xl font-semibold">{sec.title}</span>
                <span className="text-sm text-muted-foreground">{sec.stories.length}</span>
              </h2>
              <ol className="flex flex-col gap-5">
                {sec.stories.map((s) => (
                  <li key={s.id} id={anchor("story", s.slug)} className="scroll-mt-28">
                    <StoryCard story={s} variant="full" heading="h3" showFeed={false} showSection={false} />
                  </li>
                ))}
              </ol>
            </section>
          ))}

          {ed.gaps.length > 0 && (
            <aside aria-labelledby="gaps-h" className="rounded-lg border border-dashed border-border-strong/50 px-4 py-3 text-sm">
              <h2 id="gaps-h" className="kicker mb-1.5 text-muted-foreground">
                Gaps in this edition
              </h2>
              <ul className="list-disc space-y-1 pl-5">
                {ed.gaps.map((g, i) => (
                  <li key={i} className="whitespace-pre-line">
                    {g}
                  </li>
                ))}
              </ul>
            </aside>
          )}
          <div className="border-t border-border pt-4">
            <EditionNav e={ed} label="Other editions" />
          </div>
        </div>
      </div>

      <Sheet open={tocOpen} onOpenChange={setTocOpen}>
        <SheetContent side="left" aria-describedby={undefined} onCloseAutoFocus={(ev) => ev.preventDefault()}>
          <SheetHeader>
            <SheetTitle>Contents</SheetTitle>
          </SheetHeader>
          <div className="px-5 pb-8" data-feed={ed.feed}>
            <Toc sections={sections} onPick={() => setTocOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </article>
  );
}
