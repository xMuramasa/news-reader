// Reading settings sheet: text size (4 steps), serif/sans, line width, theme. Saved in localStorage (lib/settings).
import { useId } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FONTS, SIZES, THEMES, WIDTHS, resolvedTheme, setSettings, useSettings, type Settings } from "@/lib/settings";
import { cn } from "@/lib/utils";

function Choice<T extends string>({
  legend,
  options,
  value,
  onChange,
  render,
}: {
  legend: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  render: (v: T) => React.ReactNode;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="kicker mb-2 text-muted-foreground">{legend}</legend>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <label
            key={o}
            className={cn(
              "flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
              value === o ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted",
            )}
          >
            <input type="radio" className="sr-only" name={name} value={o} checked={value === o} onChange={() => onChange(o)} />
            {render(o)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const SIZE_LABEL: Record<Settings["size"], string> = { s: "Small", m: "Medium", l: "Large", xl: "Extra large" };
const SIZE_SCALE: Record<Settings["size"], string> = { s: "0.8rem", m: "0.95rem", l: "1.1rem", xl: "1.25rem" };

export function ReadingSettings({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const s = useSettings();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" aria-describedby="settings-desc">
        <SheetHeader>
          <SheetTitle>Reading settings</SheetTitle>
          <SheetDescription id="settings-desc">Saved in this browser.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-5 pb-8">
          <Choice
            legend="Text size"
            options={SIZES}
            value={s.size}
            onChange={(size) => setSettings({ size })}
            render={(v) => (
              <span aria-label={SIZE_LABEL[v]} className="headline font-semibold" style={{ fontSize: SIZE_SCALE[v] }}>
                Aa
              </span>
            )}
          />
          <Choice
            legend="Font"
            options={FONTS}
            value={s.font}
            onChange={(font) => setSettings({ font })}
            render={(v) => <span className={v === "serif" ? "font-serif" : "font-sans"}>{v === "serif" ? "Serif" : "Sans"}</span>}
          />
          <Choice
            legend="Line width"
            options={WIDTHS}
            value={s.width}
            onChange={(width) => setSettings({ width })}
            render={(v) => <span className="capitalize">{v}</span>}
          />
          <Choice
            legend="Theme"
            options={THEMES}
            value={resolvedTheme(s)}
            onChange={(theme) => setSettings({ theme })}
            render={(v) => <span className="capitalize">{v}</span>}
          />
          {s.theme !== null && (
            <button type="button" className="self-start text-sm underline underline-offset-2" onClick={() => setSettings({ theme: null })}>
              Follow the system theme
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
