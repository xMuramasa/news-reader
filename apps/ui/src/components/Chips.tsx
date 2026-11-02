// Source chips (outlet + domain, new tab), CVE chips (NVD) and tag chips (link to /stories?tag=...).
import { useState } from "react";
import { Link } from "react-router";
import { ExternalLinkIcon } from "lucide-react";
import type { EnrichedSource } from "@news/schema";
import { tagHref } from "@/lib/filters";
import { displayDomain, nvdUrl, safeUrl } from "@/lib/safe-url";
import { rowTags, tagLabel, tagPrefix, tagTitle, type RowTagKind } from "@/lib/tags";
import { cn } from "@/lib/utils";

const chip =
  "inline-flex max-w-full items-center gap-1 rounded-full border border-rule bg-raised px-2.5 py-0.5 font-label text-[0.8125rem] leading-6";

// Row chips (Endfield "Chips"): padding 3/6, label font 10px with 0.6px tracking, filled from the chip-* tokens.
const ROW_CHIP: Record<RowTagKind, string> = {
  danger: "bg-chip-danger text-chip-danger-fg",
  stack: "bg-chip-stack text-chip-stack-fg",
  warn: "bg-chip-warn text-chip-warn-fg",
  cve: "bg-chip-cve text-chip-cve-fg font-data font-medium",
  blind: "bg-chip-blind text-chip-blind-fg",
  update: "border border-chip-update text-chip-update",
  patched: "bg-chip-patched text-chip-patched-fg",
  plain: "bg-chip-plain text-chip-plain-fg",
};

/** The few chips a story row shows, in the agreed order (see rowTags). Each links to the stories filtered by that tag. */
export function RowTagChips({ tags, feed, max = 4 }: { tags: readonly string[]; feed: string; max?: number }) {
  const list = rowTags(tags, feed, max);
  if (!list.length) return null;
  return (
    <ul className="flex flex-wrap items-center gap-1" aria-label="Tags">
      {list.map((t) => (
        <li key={t.tag} className="max-w-full">
          <Link
            to={tagHref(t.tag)}
            title={tagTitle(t.tag)}
            className={cn(
              "inline-flex max-w-full items-center rounded-sm px-1.5 py-[3px] font-label text-[0.625rem] leading-none font-semibold tracking-[0.6px] uppercase hover:opacity-80",
              ROW_CHIP[t.kind],
            )}
          >
            <span className="truncate">{t.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ExternalLink({
  href,
  children,
  className,
  label,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const url = safeUrl(href);
  if (!url) return <span className={className}>{children}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={label ? `${label} (opens in a new tab)` : undefined}
    >
      {children}
    </a>
  );
}

export function SourceChips({ sources }: { sources: readonly Pick<EnrichedSource, "outlet" | "url">[] }) {
  if (!sources.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Sources">
      {sources.map((s, i) => {
        const url = safeUrl(s.url);
        const domain = url ? displayDomain(url) : "";
        return (
          <li key={`${s.url}-${i}`} className="max-w-full">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(chip, "hover:border-feed hover:bg-muted")}
                aria-label={`${s.outlet}, ${domain} (opens in a new tab)`}
              >
                <span className="truncate font-medium">{s.outlet}</span>
                <span className="truncate text-muted-foreground">{domain}</span>
                <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              </a>
            ) : (
              <span className={cn(chip, "text-muted-foreground")} title="Link not shown: not an http(s) address">
                <span className="truncate font-medium">{s.outlet}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function CveChips({ cves, kev }: { cves: readonly string[]; kev?: boolean }) {
  if (!cves.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="CVEs">
      {cves.map((c) => {
        const url = nvdUrl(c);
        const label = <span className="font-data text-[0.78rem] font-medium tracking-tight">{c.toUpperCase()}</span>;
        return (
          <li key={c}>
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(chip, "hover:border-feed hover:bg-muted")}
                aria-label={`${c.toUpperCase()} on NVD (opens in a new tab)`}
              >
                {label}
                <ExternalLinkIcon className="size-3 text-muted-foreground" aria-hidden />
              </a>
            ) : (
              <span className={chip}>{label}</span>
            )}
          </li>
        );
      })}
      {kev && (
        <li>
          <Link to={tagHref("kev:yes")} className={cn(chip, "border-chip-danger bg-chip-danger font-semibold text-chip-danger-fg")} title="In CISA's Known Exploited Vulnerabilities catalog">
            CISA KEV
          </Link>
        </li>
      )}
    </ul>
  );
}

export function TagChips({ tags, limit, active = [] }: { tags: readonly string[]; limit?: number; active?: readonly string[] }) {
  const [expanded, setExpanded] = useState(false);
  // cve: and kev: have their own chips (CveChips).
  const shown = tags.filter((t) => !["cve", "kev"].includes(tagPrefix(t)));
  if (!shown.length) return null;
  const visible = limit && !expanded ? shown.slice(0, limit) : shown;
  const hidden = shown.length - visible.length;
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Tags">
      {visible.map((t) => {
        const on = active.includes(t);
        return (
          <li key={t}>
            <Link
              to={tagHref(t)}
              aria-label={tagTitle(t)}
              className={cn(
                "inline-flex items-center rounded-sm px-1.5 py-0.5 font-label text-xs leading-5",
                on ? "bg-feed text-on-accent" : "bg-chip-plain text-chip-plain-fg hover:text-foreground",
              )}
            >
              <span aria-hidden className="mr-0.5 opacity-70">
                {tagPrefix(t) === "update" ? "↻" : "#"}
              </span>
              {tagLabel(t)}
            </Link>
          </li>
        );
      })}
      {hidden > 0 && (
        <li>
          <button
            type="button"
            className="rounded-sm px-1.5 py-0.5 text-xs leading-5 text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setExpanded(true)}
            aria-label={`Show ${hidden} more tags`}
          >
            +{hidden} more
          </button>
        </li>
      )}
    </ul>
  );
}
