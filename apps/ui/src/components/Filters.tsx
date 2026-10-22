// Filter controls shared by /stories and /favorites. State lives in the URL (lib/filters); these only render it.
import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useApi } from "@/lib/api";
import { FEEDS, FEED_IDS, type FeedId } from "@/lib/feeds";
import { MAX_QUERY, MAX_TAGS, toggleTag, type Filters } from "@/lib/filters";
import { groupTags, tagLabel, tagTitle } from "@/lib/tags";
import { cn } from "@/lib/utils";

export const SEARCH_DEBOUNCE_MS = 300;

/** Search box: types freely, reports the trimmed value after a pause. Follows outside changes (back button). */
export function SearchBox({
  value,
  onChange,
  autoFocus,
  placeholder = "Search stories…",
}: {
  value: string;
  onChange: (q: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const last = useRef(value);
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    const t = setTimeout(() => {
      const q = text.trim();
      if (q !== last.current) {
        last.current = q;
        onChange(q);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, onChange]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <div role="search" className="relative min-w-0 flex-1">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        ref={ref}
        data-search-input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        aria-label="Search stories"
        placeholder={placeholder}
        maxLength={MAX_QUERY}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const q = text.trim();
            last.current = q;
            onChange(q);
          } else if (e.key === "Escape" && text) {
            e.preventDefault();
            setText("");
          }
        }}
        className="h-10 pr-3 pl-9"
      />
    </div>
  );
}

function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
  feedOf,
}: {
  legend: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  feedOf?: (v: T) => FeedId | undefined;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="kicker mb-2 text-muted-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <label
              key={o.value}
              data-feed={feedOf?.(o.value)}
              className={cn(
                "inline-flex min-h-9 cursor-pointer items-center rounded-full border px-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                on ? "border-feed bg-feed font-medium text-on-accent" : "border-border bg-card hover:bg-muted",
              )}
            >
              <input type="radio" className="sr-only" checked={on} onChange={() => onChange(o.value)} name={name} />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function FeedFilter({ value, onChange }: { value: FeedId | null; onChange: (f: FeedId | null) => void }) {
  return (
    <Segmented
      legend="Feed"
      value={value ?? "all"}
      onChange={(v) => onChange(v === "all" ? null : (v as FeedId))}
      feedOf={(v) => (v === "all" ? undefined : (v as FeedId))}
      options={[{ value: "all", label: "All" }, ...FEED_IDS.map((id) => ({ value: id, label: FEEDS[id].label }))]}
    />
  );
}

export function SortSelect({ value, onChange }: { value: Filters["sort"]; onChange: (s: Filters["sort"]) => void }) {
  return (
    <label className="flex shrink-0 items-center gap-2 text-sm">
      <span className="sr-only sm:not-sr-only sm:text-muted-foreground">Sort</span>
      <select
        aria-label="Sort order"
        value={value}
        onChange={(e) => onChange(e.target.value === "oldest" ? "oldest" : "newest")}
        className="h-10 rounded-md border border-border-strong/60 bg-card px-2 text-sm text-foreground"
      >
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
      </select>
    </label>
  );
}

export function DateRange({ from, to, onChange }: { from: string | null; to: string | null; onChange: (from: string | null, to: string | null) => void }) {
  return (
    <fieldset>
      <legend className="kicker mb-2 text-muted-foreground">Date</legend>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <Input type="date" value={from ?? ""} max={to ?? undefined} onChange={(e) => onChange(e.target.value || null, to)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <Input type="date" value={to ?? ""} min={from ?? undefined} onChange={(e) => onChange(from, e.target.value || null)} />
        </label>
      </div>
    </fieldset>
  );
}

export function FavoritesToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--fg)]" />
      Favorites only
    </label>
  );
}

const GROUP_PREVIEW = 8;

function TagGroupChips({
  label,
  tags,
  active,
  onToggle,
}: {
  label: string;
  tags: { tag: string; count: number }[];
  active: readonly string[];
  onToggle: (t: string) => void;
}) {
  const [all, setAll] = useState(false);
  const visible = all ? tags : tags.slice(0, GROUP_PREVIEW);
  const atMax = active.length >= MAX_TAGS;
  return (
    <div>
      <h3 className="kicker mb-1.5 text-muted-foreground">{label}</h3>
      <ul className="flex flex-wrap gap-1.5">
        {visible.map((t) => {
          const on = active.includes(t.tag);
          return (
            <li key={t.tag}>
              <button
                type="button"
                aria-pressed={on}
                disabled={!on && atMax}
                aria-label={`${tagTitle(t.tag)}, ${t.count} ${t.count === 1 ? "story" : "stories"}`}
                onClick={() => onToggle(t.tag)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.8125rem] leading-6 disabled:opacity-50",
                  on ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted",
                )}
              >
                {tagLabel(t.tag)}
                <span className={cn("text-xs tabular-nums", on ? "opacity-80" : "text-muted-foreground")}>{t.count}</span>
              </button>
            </li>
          );
        })}
        {tags.length > GROUP_PREVIEW && (
          <li>
            <button type="button" className="px-1.5 text-[0.8125rem] leading-7 underline underline-offset-2" onClick={() => setAll((x) => !x)}>
              {all ? "Show fewer" : `All ${tags.length}`}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

export function TagFilter({ feed, active, onToggle }: { feed: FeedId | null; active: readonly string[]; onToggle: (t: string) => void }) {
  const api = useApi();
  const q = useQuery({ queryKey: ["tags", feed], queryFn: () => api.tags({ feed }), staleTime: 5 * 60_000 });
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading tags…</p>;
  if (q.isError)
    return (
      <p className="text-sm">
        Couldn't load tags.{" "}
        <button type="button" className="underline" onClick={() => void q.refetch()}>
          Retry
        </button>
      </p>
    );
  const groups = groupTags(q.data.tags);
  if (!groups.length) return <p className="text-sm text-muted-foreground">No tags yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <TagGroupChips key={g.prefix} label={g.label} tags={g.tags} active={active} onToggle={onToggle} />
      ))}
    </div>
  );
}

export function ActiveFilters({ filters, onChange, onClear }: { filters: Filters; onChange: (f: Filters) => void; onClear: () => void }) {
  const items: { key: string; label: string; remove: () => void }[] = [];
  if (filters.feed) items.push({ key: "feed", label: FEEDS[filters.feed].label, remove: () => onChange({ ...filters, feed: null }) });
  for (const t of filters.tags) items.push({ key: t, label: tagTitle(t), remove: () => onChange(toggleTag(filters, t)) });
  if (filters.q) items.push({ key: "q", label: `“${filters.q}”`, remove: () => onChange({ ...filters, q: "" }) });
  if (filters.from || filters.to)
    items.push({
      key: "date",
      label: `${filters.from ?? "…"} – ${filters.to ?? "…"}`,
      remove: () => onChange({ ...filters, from: null, to: null }),
    });
  if (filters.favorites) items.push({ key: "fav", label: "Favorites only", remove: () => onChange({ ...filters, favorites: false }) });
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters" role="group">
      {items.map((i) => (
        <button
          key={i.key}
          type="button"
          onClick={i.remove}
          aria-label={`Remove filter ${i.label}`}
          className="inline-flex items-center gap-1 rounded-full bg-foreground py-0.5 pr-1.5 pl-2.5 text-[0.8125rem] leading-6 text-background hover:opacity-90"
        >
          {i.label}
          <XIcon className="size-3.5" aria-hidden />
        </button>
      ))}
      <button type="button" onClick={onClear} className="px-1.5 text-[0.8125rem] underline underline-offset-2">
        Clear all
      </button>
    </div>
  );
}
