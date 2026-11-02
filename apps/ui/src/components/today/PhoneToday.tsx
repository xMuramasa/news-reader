// Today on the phone (frame 01c): TOP STORIES (a lead card, then each other feed's top story), then BY FEED boxes.
import { Link } from "react-router";
import { ArrowRightIcon } from "lucide-react";
import type { StoryView } from "@news/schema";
import { RowTagChips } from "@/components/Chips";
import { StarButton } from "@/components/StarButton";
import { StoryRow } from "@/components/StoryRow";
import { storyHref, type DayData } from "@/components/today/data";
import { FEEDS, VERIFICATION_NOTES, sectionTitle } from "@/lib/feeds";
import { displayHeadline } from "@/lib/headline";
import { markRead, useReadState } from "@/lib/read-state";

const LABEL = "font-label text-[0.625rem] leading-none font-semibold tracking-[0.8px] uppercase";

export function SectionLabel({
  children,
  count,
  className = "",
  level: H = "h2",
}: {
  children: React.ReactNode;
  count?: string | number;
  className?: string;
  level?: "h2" | "h3";
}) {
  return (
    <div className="flex items-center gap-2">
      <H className={`font-label text-[0.625rem] leading-none font-bold tracking-[1.2px] uppercase ${className}`}>{children}</H>
      {count !== undefined && <span className={`${LABEL} font-medium text-muted-foreground`}>// {count}</span>}
      <span aria-hidden className="h-px flex-1 bg-rule" />
    </div>
  );
}

function LeadCard({ story: s }: { story: StoryView }) {
  const unread = !useReadState()(s.id);
  const verification = VERIFICATION_NOTES[s.verification];
  return (
    <article
      data-story-card
      data-story-id={s.id}
      data-feed={s.feed}
      tabIndex={-1}
      aria-labelledby={`h-${s.id}`}
      className="relative flex scroll-mt-20 overflow-hidden border border-foreground bg-raised focus-visible:outline-offset-1"
    >
      <div aria-hidden className="w-[5px] shrink-0 bg-mark" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 py-3.5 pr-3.5 pl-4">
        <div className="flex items-center gap-1.5">
          {unread && (
            <span className="inline-flex shrink-0" data-testid="unread-dot">
              <span aria-hidden className="size-1.5 rotate-45 bg-foreground" />
              <span className="sr-only">Unread.</span>
            </span>
          )}
          <p className={`${LABEL} flex min-w-0 flex-1 flex-wrap gap-x-1.5 gap-y-1 text-muted-foreground`}>
            <span className="text-feed">{FEEDS[s.feed].label}</span>
            <span>· {sectionTitle(s.feed, s.section)}</span>
            <span>· {s.sources.length} src</span>
            {verification && <span className="text-alert">· {verification.label}</span>}
          </p>
          <StarButton storyId={s.id} favorite={s.favorite} headline={s.headline} className="-my-3 -mr-3 size-11" />
        </div>
        <h2 id={`h-${s.id}`} className="font-display text-[1.25rem] leading-[1.2] font-bold">
          <Link to={storyHref(s.id)} className="hover:underline" onClick={() => markRead(s.id)}>
            {displayHeadline(s)}
          </Link>
        </h2>
        <p className="font-body text-sm leading-[1.45]">{s.summary}</p>
        <RowTagChips tags={s.tags} feed={s.feed} />
      </div>
    </article>
  );
}

export function PhoneToday({ data }: { data: DayData }) {
  const lead = data.patchNow[0] ?? data.feeds[0]?.stories[0];
  if (!lead) return null;
  const others = data.feeds.filter((f) => f.id !== lead.feed).map((f) => f.stories[0]!);
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Top stories" className="flex flex-col gap-3">
        <SectionLabel>
          Top stories<span className="font-medium text-muted-foreground"> // Across feeds</span>
        </SectionLabel>
        <div className="flex flex-col gap-1.5">
          <LeadCard story={lead} />
          {others.map((s) => (
            <StoryRow key={s.id} story={s} heading="h3" showFeed />
          ))}
        </div>
      </section>
      <section aria-label="By feed" className="flex flex-col gap-3">
        <SectionLabel count={data.all.length}>By feed</SectionLabel>
        {data.feeds.map((f) => (
          <section key={f.id} data-feed={f.id} aria-labelledby={`bf-${f.id}`} className="flex flex-col gap-3 border border-rule bg-raised p-3.5">
            <div className="flex items-center gap-2">
              <span aria-hidden className="feed-strip size-2 shrink-0" />
              <h3 id={`bf-${f.id}`} className="font-label text-xs leading-none font-bold tracking-[1.2px] uppercase">
                {FEEDS[f.id].label}
              </h3>
              <span className={`${LABEL} font-medium text-muted-foreground`}>// {f.stories.length}</span>
              <Link to={`/f/${f.id}`} aria-label={`Open the ${FEEDS[f.id].label} feed`} className="-my-3 -mr-3 ml-auto inline-flex size-11 items-center justify-center hover:bg-sunken">
                <ArrowRightIcon className="size-4" aria-hidden />
              </Link>
            </div>
            <div className="flex flex-col gap-3">
              {f.stories.map((s) => (
                <StoryRow key={s.id} story={s} headlineOnly />
              ))}
            </div>
          </section>
        ))}
      </section>
    </div>
  );
}
