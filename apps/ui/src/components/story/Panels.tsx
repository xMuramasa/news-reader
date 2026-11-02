// The panels of the story page: coverage bar, framing, sources and the thread timeline. Plain text only; links go through safeUrl().
import { Link } from "react-router";
import { ExternalLinkIcon } from "lucide-react";
import type { StoryResponse, StoryView } from "@news/schema";
import { ExternalLink } from "@/components/Chips";
import { coverageRows } from "@/components/CoverageBar";
import { formatDay } from "@/lib/dates";
import { groupTitle, sectionTitle } from "@/lib/feeds";
import { displayHeadline } from "@/lib/headline";
import { safeUrl } from "@/lib/safe-url";
import { cn } from "@/lib/utils";

/** Oldest first, the current story included. */
export function threadTimeline(r: StoryResponse): StoryView[] {
  return [...r.thread.earlier, r.story, ...r.thread.later].sort((a, b) => a.run_at.localeCompare(b.run_at) || a.id.localeCompare(b.id));
}

// One colour pair per group (chip tokens, so every theme has a legible pair).
const GROUP_CHIP: Record<string, string> = {
  right: "bg-chip-update text-background",
  center: "bg-chip-warn text-chip-warn-fg",
  left: "bg-chip-danger text-chip-danger-fg",
  independent: "bg-chip-patched text-chip-patched-fg",
  foreign: "bg-chip-blind text-chip-blind-fg",
  gov_vendor: "bg-chip-stack text-chip-stack-fg",
  press: "bg-chip-update text-background",
  research: "bg-chip-blind text-chip-blind-fg",
  lab: "bg-chip-patched text-chip-patched-fg",
};
const groupBar = (g: string) => (GROUP_CHIP[g] ?? "bg-chip-plain").split(" ")[0]!;

const CHIP = "inline-flex items-center px-1.5 py-[3px] font-label text-[0.625rem] leading-none font-semibold tracking-[0.6px] uppercase";

export function GroupChip({ feed, group }: { feed: StoryView["feed"]; group: string }) {
  return <span className={cn(CHIP, GROUP_CHIP[group] ?? "bg-chip-plain text-chip-plain-fg")}>{groupTitle(feed, group)}</span>;
}

const short = (t: string) => (t.length > 6 ? `${t.slice(0, 3)}.` : t);

export function coverageCount(s: StoryView): { groups: string; outlets: number } {
  const rows = coverageRows(s.feed, s.coverage);
  return {
    groups: `${rows.filter((r) => r.state === "covered").length} of ${rows.length} groups`,
    outlets: rows.reduce((n, r) => n + r.outlets.length, 0),
  };
}

/** Labelled segments (`RIGHT 4`): width follows the outlet count; not covered is hollow with `0`, not checked dashed with `–`. */
export function CoverageSummary({ s }: { s: StoryView }) {
  const rows = coverageRows(s.feed, s.coverage);
  return (
    <ul aria-label="Coverage by group" className="flex gap-px">
      {rows.map((r) => (
        <li key={r.group} data-group={r.group} data-state={r.state} className="flex min-w-0 flex-col gap-1" style={{ flex: `${Math.max(r.outlets.length, 1)} 1 0` }}>
          <span
            aria-hidden
            className={cn(
              "h-1.5",
              r.state === "covered" ? groupBar(r.group) : r.state === "missing" ? "border border-dashed border-foreground" : "border border-dashed border-border-strong",
            )}
          />
          <span className="truncate font-label text-[0.5625rem] leading-none font-semibold tracking-[0.6px] uppercase" title={r.title}>
            {short(r.title)} {r.state === "covered" ? r.outlets.length : r.state === "missing" ? "0" : "–"}
            <span className="sr-only">{r.state === "covered" ? ` outlets, ${r.title}` : r.state === "missing" ? `, ${r.title} not covered` : `, ${r.title} not checked`}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Framing per group, then the blindspot note. */
export function Framing({ s }: { s: StoryView }) {
  return (
    <>
      {s.framing.length > 0 && (
        <ul className="flex flex-col gap-3.5">
          {s.framing.map((f, i) => (
            <li key={`${f.group}-${i}`} className="flex flex-col items-start gap-1.5">
              <GroupChip feed={s.feed} group={f.group} />
              <p className="font-body text-[0.9375rem] leading-[1.45] whitespace-pre-line">{f.text}</p>
            </li>
          ))}
        </ul>
      )}
      {s.blindspot && (
        <aside aria-label="Blindspot" className="flex border border-rule bg-background">
          <div aria-hidden className="w-[3px] shrink-0 bg-chip-blind" />
          <div className="flex flex-col gap-1 px-2.5 py-2">
            <p className="font-label text-[0.625rem] leading-none font-semibold tracking-[0.8px] uppercase">Blindspot</p>
            <p className="font-body text-[0.8125rem] leading-[1.4] whitespace-pre-line">{s.blindspot}</p>
          </div>
        </aside>
      )}
    </>
  );
}

export function SourceList({ s }: { s: StoryView }) {
  return (
    <ul aria-label="Sources" className="flex flex-col">
      {s.sources.map((x, i) => {
        const url = safeUrl(x.url);
        const body = (
          <>
            <span className="font-body text-[0.9375rem] font-medium">{x.outlet}</span>
            {x.group && <GroupChip feed={s.feed} group={x.group} />}
            {url && <ExternalLinkIcon className="ml-auto size-3.5 shrink-0" aria-hidden />}
          </>
        );
        return (
          <li key={`${x.url}-${i}`} className="border-b border-rule last:border-b-0">
            {url ? (
              <ExternalLink href={url} label={x.outlet} className="flex min-h-11 items-center gap-2 py-2 hover:underline lg:min-h-9">
                {body}
              </ExternalLink>
            ) : (
              <span className="flex min-h-9 items-center gap-2 py-2 text-muted-foreground" title="Link not shown: not an http(s) address">
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Newest first; this story is marked with a yellow diamond. */
export function ThreadList({ items, currentId }: { items: StoryView[]; currentId: string }) {
  return (
    <ol aria-label="Thread" className="flex flex-col gap-3.5">
      {[...items].reverse().map((t) => {
        const current = t.id === currentId;
        return (
          <li key={t.id} className="flex gap-2.5" aria-current={current ? "true" : undefined}>
            <span aria-hidden className={cn("mt-0.5 size-2.5 shrink-0 rotate-45 border border-foreground", current ? "bg-mark" : "bg-raised")} />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="font-label text-[0.625rem] leading-none font-semibold tracking-[0.8px] text-muted-foreground uppercase">
                <time dateTime={t.edition_date}>{formatDay(t.edition_date)}</time>
                {current && <span className="text-foreground"> · This story</span>}
                {!current && t.is_update && " · update"}
                <span className="sr-only"> · {sectionTitle(t.feed, t.section)}</span>
              </p>
              {current ? (
                <p className="font-body text-[0.8125rem] leading-[1.35] font-medium">{displayHeadline(t)}</p>
              ) : (
                <Link to={`/s/${encodeURIComponent(t.id)}`} className="font-body text-[0.8125rem] leading-[1.35] font-medium hover:underline">
                  {displayHeadline(t)}
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
