// One segment per coverage group of the feed: covered = filled with the group colour, not covered = hollow and
// striped, not checked by the briefing = dashed outline. Hover (mouse), focus + Enter, or tap opens the outlet list.
import { useRef, useState } from "react";
import type { StoryView } from "@news/schema";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FEEDS, groupColor, type FeedId } from "@/lib/feeds";
import { cn } from "@/lib/utils";

type Coverage = StoryView["coverage"];

export interface CoverageRow {
  group: string;
  title: string;
  state: "covered" | "missing" | "unchecked";
  outlets: string[];
}

export function coverageRows(feed: FeedId, coverage: Coverage): CoverageRow[] {
  return FEEDS[feed].coverageGroups.map((g) => {
    const c = coverage.find((x) => x.group === g.id);
    return {
      group: g.id,
      title: g.title,
      state: !c ? "unchecked" : c.covered ? "covered" : "missing",
      outlets: c?.outlets ?? [],
    };
  });
}

export function coverageLabel(rows: CoverageRow[]): string {
  const covered = rows.filter((r) => r.state === "covered");
  const parts = rows.map((r) =>
    r.state === "covered"
      ? `${r.title}: ${r.outlets.length ? r.outlets.join(", ") : "covered"}`
      : r.state === "missing"
        ? `${r.title}: not covered`
        : `${r.title}: not checked`,
  );
  return `Coverage, ${covered.length} of ${rows.length} groups. ${parts.join("; ")}.`;
}

export function CoverageBar({ feed, coverage, className }: { feed: FeedId; coverage: Coverage; className?: string }) {
  const rows = coverageRows(feed, coverage);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!coverage.length) return null;

  const hover = (next: boolean) => (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), next ? 120 : 200);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className={cn("group -my-1 flex w-full max-w-56 items-center gap-1 rounded py-1.5", className)}
        aria-label={coverageLabel(rows)}
        data-testid="coverage-bar"
        onPointerEnter={hover(true)}
        onPointerLeave={hover(false)}
      >
        {rows.map((r) => (
          <span
            key={r.group}
            data-group={r.group}
            data-state={r.state}
            className={cn("seg", r.state === "covered" ? "seg-covered" : r.state === "missing" ? "seg-missing" : "seg-unchecked")}
            style={{ "--g": groupColor(r.group) } as React.CSSProperties}
          />
        ))}
      </PopoverTrigger>
      <PopoverContent onPointerEnter={hover(true)} onPointerLeave={hover(false)} onOpenAutoFocus={(e) => e.preventDefault()}>
        <p className="kicker mb-2 text-muted-foreground">Coverage</p>
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.group} className="flex gap-2">
              <span
                aria-hidden
                className={cn("swatch mt-1", r.state === "covered" ? "seg-covered" : r.state === "missing" ? "seg-missing" : "seg-unchecked")}
                style={{ "--g": groupColor(r.group) } as React.CSSProperties}
              />
              <span className="min-w-0">
                <span className="font-medium">{r.title}</span>{" "}
                <span className="text-muted-foreground">
                  {r.state === "covered"
                    ? r.outlets.length
                      ? r.outlets.join(", ")
                      : "covered"
                    : r.state === "missing"
                      ? "not covered"
                      : "not checked"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
