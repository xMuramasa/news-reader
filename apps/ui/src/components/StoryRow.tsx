// The compact story row used by every list: a raised card with a feed strip, a meta line, the headline and up to four
// chips. Tap the row (or Enter/Space on the focused row) to expand the summary, the DO NOW box and the actions. Every
// briefing field is plain text; the one outside link goes through safeUrl().
import { useId, useState } from "react";
import { Link } from "react-router";
import { ArrowRightIcon, ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon, Share2Icon } from "lucide-react";
import type { StoryView } from "@news/schema";
import { ExternalLink, RowTagChips } from "@/components/Chips";
import { StarButton } from "@/components/StarButton";
import { formatDay, formatDayTime } from "@/lib/dates";
import { FEEDS, VERIFICATION_NOTES, sectionTitle } from "@/lib/feeds";
import { displayHeadline } from "@/lib/headline";
import { markRead, useReadState } from "@/lib/read-state";
import { safeUrl } from "@/lib/safe-url";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type Heading = "h2" | "h3" | "h4";

const META = "font-label text-[0.625rem] leading-none font-semibold tracking-[0.8px] uppercase";
// 30 px square outlined icon buttons; 44 px on the phone.
const ICON_BTN =
  "inline-flex size-11 shrink-0 items-center justify-center border border-outline bg-raised text-foreground hover:bg-sunken lg:size-[30px]";

const storyHref = (id: string) => `/s/${encodeURIComponent(id)}`;

function UnreadDiamond({ size = "size-1.5" }: { size?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center" data-testid="unread-dot">
      <span aria-hidden className={cn(size, "rotate-45 bg-unread")} />
      <span className="sr-only">Unread.</span>
    </span>
  );
}

/** Web Share when the browser has it, else copy the story link (and say so). Also used by the story page. */
export async function shareStory(s: StoryView): Promise<void> {
  const url = new URL(storyHref(s.id), location.origin).href;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: displayHeadline(s), url });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied");
  } catch {
    toast("Couldn't copy the link.", "error");
  }
}

/** Headline-only line (the "by feed" boxes): a 4 px diamond, ink when unread, and the linked headline. */
function HeadlineLine({ story: s }: { story: StoryView }) {
  const unread = !useReadState()(s.id);
  return (
    <div data-story-card data-story-id={s.id} data-feed={s.feed} tabIndex={-1} className="flex items-start gap-2 scroll-mt-20">
      {unread ? <UnreadDiamond size="size-1" /> : <span aria-hidden className="size-1 shrink-0 rotate-45 bg-outline" />}
      <Link
        to={storyHref(s.id)}
        className="font-body text-[0.8125rem] leading-[1.35] font-medium hover:underline"
        onClick={() => markRead(s.id)}
      >
        {displayHeadline(s)}
      </Link>
    </div>
  );
}

export interface StoryRowProps {
  story: StoryView;
  heading?: Heading;
  /** Show the feed name in the meta line (mixed lists). */
  showFeed?: boolean;
  /** Show the published day and time in the meta line (lists that span days). */
  showDate?: boolean;
  defaultExpanded?: boolean;
  /** Just the linked headline with a diamond: no card, no chips, nothing to expand. */
  headlineOnly?: boolean;
  className?: string;
}

export function StoryRow({ story: s, heading: H = "h3", showFeed = false, showDate = false, defaultExpanded = false, headlineOnly = false, className }: StoryRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isRead = useReadState();
  const bodyId = useId();
  if (headlineOnly) return <HeadlineLine story={s} />;

  const unread = !isRead(s.id);
  const verification = VERIFICATION_NOTES[s.verification];
  const source = s.sources.map((x) => ({ x, url: safeUrl(x.url) })).find((x) => x.url);
  const toggle = () => setExpanded((v) => !v);

  return (
    <article
      data-story-card
      data-story-id={s.id}
      data-feed={s.feed}
      data-expanded={expanded}
      tabIndex={-1}
      aria-labelledby={`h-${s.id}`}
      onClick={(e) => {
        if (!(e.target as Element).closest("a, button")) toggle();
      }}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          toggle();
        }
      }}
      className={cn("relative flex scroll-mt-20 cursor-pointer overflow-hidden border border-rule bg-raised focus-visible:outline-offset-1", className)}
    >
      <div aria-hidden className="feed-strip w-[3px] shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-2.5 pr-3 pb-3 pl-[15px]">
        <div className="flex items-center gap-1.5">
          {unread && <UnreadDiamond />}
          <p className={cn(META, "flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground")}>
            {showFeed && <span className="text-feed">{FEEDS[s.feed].label} ·</span>}
            <span>{sectionTitle(s.feed, s.section)}</span>
            <span>· {s.sources.length} src</span>
            {verification && <span className="text-alert">· {verification.label}</span>}
            {showDate && (
              <time dateTime={s.run_at} title="Published (Santiago time)" className="font-medium normal-case tracking-normal">
                · {formatDayTime(s.run_at) || formatDay(s.edition_date)}
              </time>
            )}
          </p>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={expanded ? bodyId : undefined}
            aria-label={`Details: ${s.headline}`}
            onClick={toggle}
            className="-my-3 inline-flex size-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground lg:-my-2 lg:size-8"
          >
            {expanded ? <ChevronUpIcon className="size-4" aria-hidden /> : <ChevronDownIcon className="size-4" aria-hidden />}
          </button>
          <StarButton storyId={s.id} favorite={s.favorite} headline={s.headline} className="-my-3 -mr-3 size-11 lg:-my-2 lg:-mr-2 lg:size-8" />
        </div>
        <H id={`h-${s.id}`} className={cn("font-body text-[0.9375rem] leading-[1.3] font-semibold", !expanded && "line-clamp-2")}>
          <Link to={storyHref(s.id)} className="hover:underline" onClick={() => markRead(s.id)}>
            {displayHeadline(s)}
          </Link>
        </H>
        {expanded && (
          <div id={bodyId} className="flex flex-col gap-2.5">
            <p className="font-body text-sm leading-[1.45] whitespace-pre-line">{s.summary}</p>
            {s.action && (
              <aside aria-label="Do now" className="flex border border-rule bg-background">
                <div aria-hidden className="w-[3px] shrink-0 bg-mark" />
                <div className="flex flex-col gap-1 px-2.5 py-2">
                  <p className={cn(META, "text-foreground")}>Do now</p>
                  <p className="font-body text-[0.8125rem] leading-[1.4] font-medium whitespace-pre-line">{s.action}</p>
                </div>
              </aside>
            )}
          </div>
        )}
        <RowTagChips tags={s.tags} feed={s.feed} />
        {expanded && (
          <div className="mt-1 flex items-center gap-2">
            <Link
              to={storyHref(s.id)}
              onClick={() => markRead(s.id)}
              className="inline-flex h-11 items-center gap-1.5 bg-primary px-3 font-label text-[0.6875rem] font-bold tracking-[0.8px] text-on-primary uppercase hover:opacity-85 lg:h-[30px]"
            >
              Read story <ArrowRightIcon className="size-3.5" aria-hidden />
            </Link>
            {source && (
              <ExternalLink href={source.url!} label={`Open source: ${source.x.outlet}`} className={ICON_BTN}>
                <ExternalLinkIcon className="size-3.5" aria-hidden />
              </ExternalLink>
            )}
            <button type="button" aria-label="Share" title="Share" className={ICON_BTN} onClick={() => void shareStory(s)}>
              <Share2Icon className="size-3.5" aria-hidden />
            </button>
            <button type="button" aria-label="Collapse" aria-expanded title="Collapse" className={cn(ICON_BTN, "ml-auto")} onClick={toggle}>
              <ChevronUpIcon className="size-3.5" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

/** A favorite whose story is no longer stored: what the snapshot still knows, in the same shell as a row. */
export function SnapshotRow({
  storyId,
  snapshot,
  heading: H = "h3",
}: {
  storyId: string;
  snapshot: { headline: string; feed: StoryView["feed"]; edition_id: string; edition_date: string };
  heading?: Heading;
}) {
  return (
    <article
      data-story-card
      data-story-id={storyId}
      data-feed={snapshot.feed}
      tabIndex={-1}
      className="relative flex scroll-mt-20 overflow-hidden border border-dashed border-rule bg-raised focus-visible:outline-offset-1"
    >
      <div aria-hidden className="feed-strip w-[3px] shrink-0 opacity-60" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-2.5 pr-3 pb-3 pl-[15px]">
        <div className="flex items-center gap-1.5">
          <p className={cn(META, "flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground")}>
            <span className="text-feed">{FEEDS[snapshot.feed].label}</span>
            <time dateTime={snapshot.edition_date}>· {formatDay(snapshot.edition_date)}</time>
            <span>· no longer in the reader</span>
          </p>
          <StarButton storyId={storyId} favorite headline={snapshot.headline} className="-my-3 -mr-3 size-11 lg:-my-2 lg:-mr-2 lg:size-8" />
        </div>
        <H className="font-body text-[0.9375rem] leading-[1.3] font-semibold text-muted-foreground">{snapshot.headline}</H>
        <Link to={`/e/${encodeURIComponent(snapshot.edition_id)}`} className="self-start font-label text-[0.6875rem] font-bold tracking-[0.8px] uppercase underline underline-offset-2">
          Open the edition
        </Link>
      </div>
    </article>
  );
}
