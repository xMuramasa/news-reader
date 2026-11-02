// Today on desktop (frame 02a): a column of feed panels (head, edition lead, labelled sections of rows) and the AT A
// GLANCE column (patch now, your stack, blindspots, markets).
import { useState } from "react";
import { Link } from "react-router";
import { ArrowRightIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import type { EditionView, StoryView } from "@news/schema";
import { StoryRow } from "@/components/StoryRow";
import { SectionLabel } from "@/components/today/PhoneToday";
import { sectionsOf, storyHref, useEditions, type DayData, type FeedDay } from "@/components/today/data";
import { formatDay, formatRunTime } from "@/lib/dates";
import { FEEDS } from "@/lib/feeds";
import { displayHeadline } from "@/lib/headline";
import { rowTags, type RowTagKind } from "@/lib/tags";
import { cn } from "@/lib/utils";

const CAP = 6;

function FeedPanel({ feed, edition, firstPatchId }: { feed: FeedDay; edition?: EditionView; firstPatchId?: string }) {
  const [all, setAll] = useState(false);
  const def = FEEDS[feed.id];
  const patch = feed.stories.filter((s) => s.section === "patch_now").length;
  const cap = Math.max(CAP, patch);
  const shown = all ? feed.stories : feed.stories.slice(0, cap);
  const rest = feed.stories.length - shown.length;
  return (
    <section data-feed={feed.id} aria-labelledby={`panel-${feed.id}`} className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="feed-strip size-3 shrink-0" />
        <h2 id={`panel-${feed.id}`} className="font-display text-xl leading-none font-extrabold tracking-[0.5px] uppercase">
          {def.label}
        </h2>
        <span className="font-label text-xs text-muted-foreground">// {feed.stories.length}</span>
        <Link
          to={`/e/${encodeURIComponent(feed.editionId)}`}
          aria-label={`Open the ${def.label} edition`}
          className="ml-auto inline-flex items-center gap-1.5 font-label text-[0.6875rem] font-bold tracking-[0.8px] uppercase hover:underline"
        >
          Edition {formatRunTime(feed.runAt)} <ArrowRightIcon className="size-3.5" aria-hidden />
        </Link>
      </div>
      {edition?.lead && <p className="font-body text-sm leading-[1.5] text-muted-foreground">{edition.lead}</p>}
      {sectionsOf(feed.id, shown).map((sec) => (
        <div key={sec.id} className="flex flex-col gap-2">
          <SectionLabel level="h3" count={feed.stories.filter((s) => s.section === sec.id).length} className={sec.id === "patch_now" ? "text-alert" : ""}>
            {sec.title}
          </SectionLabel>
          <ol className="flex flex-col gap-1.5" aria-label={sec.title}>
            {sec.stories.map((s) => (
              <li key={s.id}>
                <StoryRow story={s} heading="h4" defaultExpanded={s.id === firstPatchId} />
              </li>
            ))}
          </ol>
        </div>
      ))}
      {feed.stories.length > cap && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          className="inline-flex h-9 items-center justify-center gap-2 border border-outline bg-raised font-label text-[0.625rem] font-bold tracking-[1px] uppercase hover:bg-sunken"
        >
          {all ? "Show fewer" : `More in ${def.label} // ${rest}`}
          {all ? <ChevronUpIcon className="size-3.5" aria-hidden /> : <ChevronDownIcon className="size-3.5" aria-hidden />}
        </button>
      )}
    </section>
  );
}

const CHIP: Partial<Record<RowTagKind, string>> = {
  danger: "bg-chip-danger text-chip-danger-fg",
  stack: "bg-chip-stack text-chip-stack-fg",
  blind: "bg-chip-blind text-chip-blind-fg",
};

/** One card of AT A GLANCE: a label with its count, then a line per story with the chip of its kind. */
function GlanceCard({ title, alert, stories, kind }: { title: string; alert?: boolean; stories: StoryView[]; kind: "danger" | "stack" | "blind" }) {
  if (!stories.length) return null;
  const items = stories.slice(0, 6);
  return (
    <section aria-label={title} className="flex flex-col gap-3 border border-rule bg-raised p-3.5">
      <p className={cn("font-label text-[0.625rem] leading-none font-bold tracking-[1.2px] uppercase", alert && "text-alert")}>
        {title} <span className="font-medium text-muted-foreground">// {stories.length}</span>
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((s) => {
          const chip = rowTags(s.tags, s.feed, 8).find((t) => t.kind === kind);
          // The chip words are shorter than on rows: KEV, and the group without "BLINDSPOT".
          const label = chip?.label.replace(/^KEV .*/, "KEV").replace(/^BLINDSPOT /, "");
          return (
            <li key={s.id} data-feed={s.feed} className="flex items-center gap-2">
              <span aria-hidden className="feed-strip size-1.5 shrink-0" />
              <Link to={storyHref(s.id)} className="min-w-0 flex-1 truncate font-body text-[0.8125rem] hover:underline" title={s.headline}>
                {displayHeadline(s)}
              </Link>
              {chip && (
                <span className={cn("shrink-0 px-1.5 py-[3px] font-label text-[0.625rem] leading-none font-semibold tracking-[0.6px] uppercase", CHIP[kind])}>
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Markets({ markets }: { markets: NonNullable<EditionView["markets"]> }) {
  if (!markets.items.length) return null;
  return (
    <section aria-label="Markets" className="flex flex-col gap-3 bg-chrome p-3.5 text-on-chrome">
      <p className="font-label text-[0.625rem] leading-none font-bold tracking-[1.2px] text-mark uppercase">
        Markets{" "}
        {markets.as_of && <span className="font-medium text-on-chrome-muted normal-case">// {formatDay(markets.as_of).replace(/^\w+ /, "")}</span>}
      </p>
      <dl className="flex flex-col gap-2.5">
        {markets.items.map((m) => (
          <div key={m.name} className="flex items-baseline gap-3 font-data text-xs">
            <dt className="font-label text-[0.625rem] tracking-[0.8px] uppercase">{m.name}</dt>
            <dd className="ml-auto flex gap-3">
              <span>{m.value}</span>
              {m.change && (
                <span className={cn("min-w-14 text-right", /^[-−–]/.test(m.change) ? "text-[#FF6B63]" : /^\+/.test(m.change) ? "text-chip-patched" : "text-on-chrome-muted")}>
                  {m.change}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function DesktopToday({ data }: { data: DayData }) {
  const editions = useEditions(data.feeds);
  const blind = data.all.filter((s) => s.tags.some((t) => t.startsWith("blindspot:")));
  const markets = data.feeds.map((f) => editions[f.id]?.markets).find((m) => m?.items.length);
  return (
    <div className="mt-8 grid grid-cols-[minmax(0,780px)_minmax(0,1fr)] items-start gap-10">
      <div className="flex flex-col gap-9">
        {data.feeds.map((f) => (
          <FeedPanel key={f.id} feed={f} edition={editions[f.id]} firstPatchId={data.patchNow[0]?.id} />
        ))}
      </div>
      <aside aria-label="At a glance" className="flex max-w-[380px] flex-col gap-4">
        <GlanceCard title="Patch now" alert stories={data.patchNow} kind="danger" />
        <GlanceCard title="Your stack" stories={data.stack} kind="stack" />
        <GlanceCard title="Blindspots" stories={blind} kind="blind" />
        {markets && <Markets markets={markets} />}
      </aside>
    </div>
  );
}
