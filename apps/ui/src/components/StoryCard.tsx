// A story as a card (lists) or in full (edition and story pages). Every briefing field is plain text: React escapes it,
// and nothing here parses Markdown or HTML. Links go through safeUrl().
import { Link } from "react-router";
import { AlertTriangleIcon, EyeOffIcon, InfoIcon, ServerIcon, ShieldAlertIcon } from "lucide-react";
import type { StoryView } from "@news/schema";
import { CoverageBar } from "@/components/CoverageBar";
import { CveChips, SourceChips, TagChips } from "@/components/Chips";
import { StarButton } from "@/components/StarButton";
import { formatDay } from "@/lib/dates";
import { FEEDS, VERIFICATION_NOTES, groupColor, groupTitle, sectionTitle } from "@/lib/feeds";
import { markRead, useReadState } from "@/lib/read-state";
import { tagLabel, tagPrefix } from "@/lib/tags";
import { cn } from "@/lib/utils";

type Heading = "h1" | "h2" | "h3";

export function storyFlags(s: StoryView) {
  const stack = s.tags.filter((t) => tagPrefix(t) === "stack").map(tagLabel);
  return {
    patchNow: s.section === "patch_now",
    yourStack: s.section === "your_stack" || stack.length > 0,
    stack,
    kev: s.tags.includes("kev:yes"),
    blindspot: Boolean(s.blindspot),
    verification: VERIFICATION_NOTES[s.verification] ?? null,
  };
}

function Pill({ tone, children }: { tone: "danger" | "warn" | "info" | "plain"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1.5 text-[0.7rem] font-semibold tracking-wide uppercase leading-5",
        tone === "danger" && "bg-danger text-danger-foreground",
        tone === "warn" && "bg-warn text-warn-foreground",
        tone === "info" && "bg-info text-info-foreground",
        tone === "plain" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function Kicker({ s, showFeed, showSection }: { s: StoryView; showFeed: boolean; showSection: boolean }) {
  const isRead = useReadState();
  const unread = !isRead(s.id);
  const date = s.event_date && s.event_date <= s.edition_date ? s.event_date : s.edition_date;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {unread && (
        <span className="inline-flex items-center" data-testid="unread-dot">
          <span aria-hidden className="size-2 rounded-full bg-feed" />
          <span className="sr-only">Unread.</span>
        </span>
      )}
      {showFeed && <span className="kicker text-feed">{FEEDS[s.feed].label}</span>}
      {showSection && <span className="kicker">{sectionTitle(s.feed, s.section)}</span>}
      <time dateTime={date}>{formatDay(date)}</time>
      {s.is_update && <Pill tone="plain">Update</Pill>}
    </div>
  );
}

function CardPills({ s }: { s: StoryView }) {
  const f = storyFlags(s);
  if (!f.patchNow && !f.yourStack && !f.kev && !f.blindspot && !f.verification) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {f.patchNow && <Pill tone="danger">Patch now</Pill>}
      {f.kev && !f.patchNow && <Pill tone="danger">Exploited (KEV)</Pill>}
      {f.yourStack && <Pill tone="info">Your stack</Pill>}
      {f.blindspot && <Pill tone="warn">Blindspot</Pill>}
      {f.verification && <Pill tone="plain">{f.verification.label}</Pill>}
    </div>
  );
}

function Callout({
  tone,
  icon,
  title,
  children,
}: {
  tone: "danger" | "warn" | "info" | "plain";
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <aside
      aria-label={title}
      className={cn(
        "flex gap-2.5 rounded-md px-3 py-2.5 text-[0.9375rem] leading-relaxed",
        tone === "danger" && "bg-danger text-danger-foreground",
        tone === "warn" && "bg-warn text-warn-foreground",
        tone === "info" && "bg-info text-info-foreground",
        tone === "plain" && "border border-border bg-muted text-foreground",
      )}
    >
      <span className="mt-0.5 shrink-0" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="kicker">{title}</p>
        <div className="whitespace-pre-line">{children}</div>
      </div>
    </aside>
  );
}

export function Callouts({ s }: { s: StoryView }) {
  const f = storyFlags(s);
  const actionShown = f.patchNow || f.yourStack;
  return (
    <>
      {f.patchNow && (
        <Callout tone="danger" icon={<ShieldAlertIcon className="size-4" />} title={f.kev ? "Patch now · in CISA KEV" : "Patch now"}>
          {s.action ?? "Actively exploited. Patch or mitigate as soon as possible."}
        </Callout>
      )}
      {f.yourStack && (
        <Callout tone="info" icon={<ServerIcon className="size-4" />} title={f.stack.length ? `Your stack · ${f.stack.join(", ")}` : "Your stack"}>
          {f.patchNow ? "This affects software you run." : (s.action ?? "This affects software you run.")}
        </Callout>
      )}
      {s.action && !actionShown && (
        <Callout tone="plain" icon={<InfoIcon className="size-4" />} title="What to do">
          {s.action}
        </Callout>
      )}
      {s.blindspot && (
        <Callout tone="warn" icon={<EyeOffIcon className="size-4" />} title="Blindspot">
          {s.blindspot}
        </Callout>
      )}
      {f.verification && (
        <Callout tone="plain" icon={<AlertTriangleIcon className="size-4" />} title={f.verification.label}>
          {f.verification.text}
        </Callout>
      )}
    </>
  );
}

export function FramingRows({ s }: { s: StoryView }) {
  if (!s.framing.length) return null;
  return (
    <div>
      <p className="kicker mb-1.5 text-muted-foreground">How it's framed</p>
      <ul className="space-y-1.5">
        {s.framing.map((fr, i) => (
          <li key={`${fr.group}-${i}`} className="grid grid-cols-[6.5rem_1fr] gap-3 text-[0.9375rem] leading-relaxed sm:grid-cols-[7.5rem_1fr]">
            <span className="flex items-start gap-1.5 pt-0.5 text-xs font-semibold">
              <span aria-hidden className="swatch mt-0.5 seg-covered" style={{ "--g": groupColor(fr.group) } as React.CSSProperties} />
              {groupTitle(s.feed, fr.group)}
            </span>
            <span className="reading text-[0.9375rem] whitespace-pre-line">{fr.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Details({ s }: { s: StoryView }) {
  if (!s.details.length) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[0.9375rem] sm:grid-cols-[minmax(6rem,max-content)_1fr]">
      {s.details.map((d, i) => (
        <div key={`${d.label}-${i}`} className="contents">
          <dt className="pt-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{d.label}</dt>
          <dd className="reading text-[0.9375rem] leading-relaxed whitespace-pre-line">{d.text}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface StoryCardProps {
  story: StoryView;
  variant?: "card" | "full";
  heading?: Heading;
  /** Show the feed name (mixed lists). */
  showFeed?: boolean;
  /** Show the section name (lists; the edition view has section headings instead). */
  showSection?: boolean;
  /** Headline links to the story page (off on the story page itself). */
  linkHeadline?: boolean;
  className?: string;
}

export function StoryCard({
  story: s,
  variant = "card",
  heading: H = "h2",
  showFeed = true,
  showSection = true,
  linkHeadline = true,
  className,
}: StoryCardProps) {
  const full = variant === "full";
  const headline = linkHeadline ? (
    <Link to={`/s/${encodeURIComponent(s.id)}`} className="hover:underline" onClick={() => markRead(s.id)}>
      {s.headline}
    </Link>
  ) : (
    s.headline
  );
  return (
    <article
      data-story-card
      data-story-id={s.id}
      data-feed={s.feed}
      tabIndex={-1}
      aria-labelledby={`h-${s.id}`}
      className={cn(
        "relative flex scroll-mt-20 overflow-hidden rounded-lg border border-border bg-card focus-visible:outline-offset-1",
        className,
      )}
    >
      <div aria-hidden className="feed-strip w-1 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-4 sm:p-5">
        <Kicker s={s} showFeed={showFeed} showSection={showSection} />
        <H id={`h-${s.id}`} className={cn("headline font-semibold", full ? "text-[1.45rem] leading-tight sm:text-[1.6rem]" : "text-[1.25rem] leading-snug")}>
          {headline}
        </H>
        {!full && <CardPills s={s} />}
        <p className={cn("reading measure whitespace-pre-line", !full && "text-[1rem]")}>{s.summary}</p>
        {full && (
          <div className="measure flex flex-col gap-3">
            <Details s={s} />
            <Callouts s={s} />
            <FramingRows s={s} />
            <CveChips cves={s.cves} kev={s.tags.includes("kev:yes")} />
            <SourceChips sources={s.sources} />
          </div>
        )}
        <TagChips tags={s.tags} limit={full ? undefined : 4} />
        <div className="mt-0.5 flex items-center justify-between gap-3">
          <CoverageBar feed={s.feed} coverage={s.coverage} />
          {!s.coverage.length && <span />}
          <StarButton storyId={s.id} favorite={s.favorite} headline={s.headline} className="-mr-2" />
        </div>
      </div>
    </article>
  );
}

/** A favorite whose story is no longer stored: what the snapshot still knows. */
export function SnapshotCard({
  storyId,
  snapshot,
  heading: H = "h2",
}: {
  storyId: string;
  snapshot: { headline: string; feed: StoryView["feed"]; edition_id: string; edition_date: string };
  heading?: Heading;
}) {
  return (
    <article data-story-card data-story-id={storyId} data-feed={snapshot.feed} tabIndex={-1} className="relative flex overflow-hidden rounded-lg border border-dashed border-border bg-card">
      <div aria-hidden className="feed-strip w-1 shrink-0 opacity-60" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="kicker text-feed">{FEEDS[snapshot.feed].label}</span>
          <time dateTime={snapshot.edition_date}>{formatDay(snapshot.edition_date)}</time>
          <span>· no longer in the reader</span>
        </div>
        <H className="headline text-[1.2rem] leading-snug font-semibold text-muted-foreground">{snapshot.headline}</H>
        <div className="flex items-center justify-between">
          <Link to={`/e/${encodeURIComponent(snapshot.edition_id)}`} className="text-sm underline">
            Open the edition
          </Link>
          <StarButton storyId={storyId} favorite headline={snapshot.headline} className="-mr-2" />
        </div>
      </div>
    </article>
  );
}
