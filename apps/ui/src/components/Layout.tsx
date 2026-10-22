import { useCallback, useState } from "react";
import { Link, NavLink, Outlet, ScrollRestoration, useNavigate } from "react-router";
import { KeyboardIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { ReadingSettings } from "@/components/ReadingSettings";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatLongDay, santiagoToday } from "@/lib/dates";
import { FEEDS, FEED_IDS } from "@/lib/feeds";
import { SHORTCUTS, useShortcuts } from "@/lib/shortcuts";
import { dismissToast, useToasts } from "@/lib/toast";
import { cn } from "@/lib/utils";

const navLink = ({ isActive }: { isActive: boolean }) =>
  cn(
    "relative shrink-0 rounded-sm px-1 py-2 text-sm whitespace-nowrap transition-colors",
    isActive ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
  );

function Toaster() {
  const toasts = useToasts();
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
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

  const onSearch = useCallback(() => {
    const input = document.querySelector<HTMLInputElement>("[data-search-input]");
    if (input) {
      input.focus();
      input.select();
    } else {
      void navigate("/stories", { state: { focusSearch: true } });
    }
  }, [navigate]);
  const onHelp = useCallback(() => setHelpOpen(true), []);
  useShortcuts({ onSearch, onHelp });

  const today = santiagoToday();

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-[70] rounded-md bg-foreground px-3 py-2 text-background focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pt-2.5 sm:px-6">
          <Link to="/" className="headline text-[1.45rem] leading-none font-bold tracking-tight sm:text-[1.65rem]">
            The Briefing
          </Link>
          <time dateTime={today} className="hidden text-xs text-muted-foreground md:block">
            {formatLongDay(today)}
          </time>
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              onClick={onSearch}
              className="inline-flex size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Search stories"
              title="Search (/)"
            >
              <SearchIcon className="size-[1.15rem]" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Reading settings"
              title="Reading settings"
            >
              <SlidersHorizontalIcon className="size-[1.15rem]" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onHelp}
              className="hidden size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground sm:inline-flex"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
            >
              <KeyboardIcon className="size-[1.15rem]" aria-hidden />
            </button>
          </div>
        </div>
        <nav aria-label="Sections" className="mx-auto max-w-6xl px-4 sm:px-6">
          <ul className="-mx-1 flex items-center gap-4 overflow-x-auto [scrollbar-width:none]">
            <li>
              <NavLink to="/" end className={navLink}>
                Today
              </NavLink>
            </li>
            <li>
              <NavLink to="/stories" className={navLink}>
                Stories
              </NavLink>
            </li>
            <li>
              <NavLink to="/favorites" className={navLink}>
                Favorites
              </NavLink>
            </li>
            <li aria-hidden className="h-4 w-px shrink-0 bg-border" />
            {FEED_IDS.map((id) => (
              <li key={id} data-feed={id}>
                <NavLink to={`/f/${id}`} className={(p) => cn(navLink(p), p.isActive && "text-feed")}>
                  {FEEDS[id].label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8">
        <Outlet />
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-5 text-xs text-muted-foreground sm:px-6">
          <span>Briefings are AI-written summaries of web sources. Check the sources before relying on them.</span>
          <button type="button" className="underline underline-offset-2" onClick={onHelp}>
            Keyboard shortcuts
          </button>
        </div>
      </footer>
      <ReadingSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
      <Toaster />
      <ScrollRestoration />
    </div>
  );
}
