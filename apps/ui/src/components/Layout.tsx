import { useCallback, useRef, useState } from "react";
import { Link, NavLink, Outlet, ScrollRestoration, useNavigate } from "react-router";
import { BookmarkIcon, CalendarDaysIcon, KeyboardIcon, ListIcon, SearchIcon, SlidersHorizontalIcon, XIcon, type LucideIcon } from "lucide-react";
import { ReadingSettings } from "@/components/ReadingSettings";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FEEDS, FEED_IDS, type FeedId } from "@/lib/feeds";
import { MAX_QUERY } from "@/lib/filters";
import { SHORTCUTS, useShortcuts } from "@/lib/shortcuts";
import { dismissToast, useToasts } from "@/lib/toast";
import { cn } from "@/lib/utils";

// Below 1024 px (Tailwind lg) the phone chrome shows, from it the desktop chrome. Both are in the DOM; CSS picks one.
const TABS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/", label: "Today", icon: CalendarDaysIcon, end: true },
  { to: "/stories", label: "Stories", icon: ListIcon },
  { to: "/favorites", label: "Saved", icon: BookmarkIcon },
  { to: "/search", label: "Search", icon: SearchIcon },
];

const FEED_MARK: Record<FeedId, string> = {
  chile: "bg-chile-mark",
  cyber: "bg-cyber-mark outline outline-1 outline-foreground",
  ai: "bg-ai-mark",
};

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-mark";

const deskTab = ({ isActive }: { isActive: boolean }) =>
  cn(
    "font-label inline-flex items-center gap-2 border-b-[3px] px-3.5 py-[15px] text-xs leading-none font-bold tracking-[1.4px] whitespace-nowrap uppercase",
    isActive ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
  );

const chromeButton = cn("inline-flex size-11 items-center justify-center text-on-chrome-muted hover:text-on-chrome lg:size-10", focusRing);

function Brand({ size }: { size: "sm" | "lg" }) {
  return (
    <Link to="/" aria-label="The Briefing" className={cn("inline-flex items-center gap-2.5 text-on-chrome", focusRing)}>
      <span
        aria-hidden
        className={cn(
          "font-display inline-flex items-center justify-center bg-mark font-extrabold text-on-mark outline outline-1 outline-on-mark",
          size === "sm" ? "size-5 text-xs" : "size-6 text-sm",
        )}
      >
        N
      </span>
      <span className="font-label text-[11px] font-bold tracking-[2px] uppercase">The Briefing</span>
    </Link>
  );
}

function Toaster() {
  const toasts = useToasts();
  return (
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom)+1rem)] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "animate-pop-in pointer-events-auto flex max-w-md items-center gap-3 rounded-lg px-4 py-2.5 text-sm shadow-lg",
            t.tone === "error" ? "bg-danger text-danger-foreground" : "bg-foreground text-background",
          )}
        >
          <span>{t.text}</span>
          <button type="button" className="rounded p-0.5 opacity-80 hover:opacity-100" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <XIcon className="size-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>Shortcuts are off while you type in a field.</DialogDescription>
        <dl className="grid grid-cols-[4rem_1fr] gap-y-2 text-sm">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="contents">
              <dt>
                <kbd className="rounded border border-border-strong/60 bg-muted px-1.5 py-0.5 font-mono text-xs">{s.keys}</kbd>
              </dt>
              <dd>{s.text}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

export function Layout() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const navigate = useNavigate();
  const topSearch = useRef<HTMLInputElement | null>(null);

  // "/": the page's own field (Stories, Search), else the desktop top bar field, else the Search page.
  const onSearch = useCallback(() => {
    const desktop = typeof matchMedia === "function" && matchMedia("(min-width: 1024px)").matches;
    const input = document.querySelector<HTMLInputElement>("#main [data-search-input]") ?? (desktop ? topSearch.current : null);
    if (input) {
      input.focus();
      input.select();
    } else {
      void navigate("/search");
    }
  }, [navigate]);
  const onHelp = useCallback(() => setHelpOpen(true), []);
  useShortcuts({ onSearch, onHelp });

  const submitSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = (topSearch.current?.value ?? "").trim();
    void navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-[70] rounded-md bg-foreground px-3 py-2 text-background focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40">
        <div className="flex h-14 items-center justify-between bg-chrome px-4 lg:hidden">
          <Brand size="sm" />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className={cn(chromeButton, "border border-on-chrome-muted/50")}
            aria-label="Reading settings"
            title="Reading settings"
          >
            <SlidersHorizontalIcon className="size-5" aria-hidden />
          </button>
        </div>
        <div className="hidden h-16 grid-cols-[1fr_minmax(0,560px)_1fr] items-center gap-6 bg-chrome px-8 lg:grid">
          <div className="justify-self-start">
            <Brand size="lg" />
          </div>
          <form role="search" onSubmit={submitSearch} className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-on-chrome-muted" aria-hidden />
            <input
              ref={topSearch}
              type="search"
              enterKeyHint="search"
              aria-label="Search stories, tags, CVEs"
              placeholder="Search stories, tags, CVEs"
              maxLength={MAX_QUERY}
              className={cn(
                "font-body h-10 w-full bg-chrome-field pr-10 pl-10 text-sm text-on-chrome placeholder:text-on-chrome-muted [&::-webkit-search-cancel-button]:hidden",
                focusRing,
              )}
            />
            <kbd
              aria-hidden
              className="font-label absolute top-1/2 right-3 -translate-y-1/2 border border-on-chrome-muted/50 px-1.5 py-0.5 text-[10px] leading-none text-on-chrome-muted"
            >
              /
            </kbd>
          </form>
          <div className="flex items-center justify-self-end">
            <button type="button" onClick={() => setSettingsOpen(true)} className={chromeButton} aria-label="Reading settings" title="Reading settings">
              <SlidersHorizontalIcon className="size-5" aria-hidden />
            </button>
            <button type="button" onClick={onHelp} className={chromeButton} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
              <KeyboardIcon className="size-5" aria-hidden />
            </button>
          </div>
        </div>
        <nav aria-label="Sections" className="hidden border-b border-border bg-raised px-8 lg:block">
          <ul className="flex items-center">
            <li>
              <NavLink to="/" end className={deskTab}>
                Today
              </NavLink>
            </li>
            {FEED_IDS.map((id) => (
              <li key={id} data-feed={id}>
                <NavLink to={`/f/${id}`} className={deskTab}>
                  <span aria-hidden className={cn("size-2", FEED_MARK[id])} />
                  {FEEDS[id].label}
                </NavLink>
              </li>
            ))}
            <li>
              <NavLink to="/stories" className={deskTab}>
                Stories
              </NavLink>
            </li>
            <li>
              <NavLink to="/favorites" className={deskTab}>
                Saved
              </NavLink>
            </li>
          </ul>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8">
        <Outlet />
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-5 pb-[calc(60px+env(safe-area-inset-bottom)+1.25rem)] text-xs text-muted-foreground sm:px-6 lg:pb-5">
          <span>Briefings are AI-written summaries of web sources. Check the sources before relying on them.</span>
          <button type="button" className="hidden underline underline-offset-2 lg:inline" onClick={onHelp}>
            Keyboard shortcuts
          </button>
        </div>
      </footer>
      <nav aria-label="Tabs" className="fixed inset-x-0 bottom-0 z-40 bg-chrome pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="flex h-[60px]">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn("relative flex h-full flex-col items-center justify-center gap-1", focusRing, isActive ? "text-mark" : "text-on-chrome-muted")
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span aria-hidden className="absolute top-0 left-1/2 h-[3px] w-6 -translate-x-1/2 bg-mark" />}
                    <Icon className="size-5" aria-hidden />
                    <span className="font-label text-[10px] leading-none font-bold tracking-[0.8px] uppercase">{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <ReadingSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
      <Toaster />
      <ScrollRestoration />
    </div>
  );
}
