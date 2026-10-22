// Source chips (outlet + domain, new tab), CVE chips (NVD) and tag chips (link to /stories?tag=...).
import { useState } from "react";
import { Link } from "react-router";
import { ExternalLinkIcon } from "lucide-react";
import type { EnrichedSource } from "@news/schema";
import { tagHref } from "@/lib/filters";
import { displayDomain, nvdUrl, safeUrl } from "@/lib/safe-url";
import { tagLabel, tagPrefix, tagTitle } from "@/lib/tags";
import { cn } from "@/lib/utils";

const chip =
  "inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-[0.8125rem] leading-6";

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
        const label = <span className="font-mono text-[0.78rem] tracking-tight">{c.toUpperCase()}</span>;
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
          <Link to={tagHref("kev:yes")} className={cn(chip, "border-bad font-semibold text-bad")} title="In CISA's Known Exploited Vulnerabilities catalog">
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
                "inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs leading-5",
                on ? "bg-feed text-on-accent" : "bg-muted text-muted-foreground hover:text-foreground",
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
