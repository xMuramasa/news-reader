// A raised accordion for the story page's DETAILS: label, `// count`, chevron; folded by default, 1 px ink border open.
import { useId, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const SECTION_LABEL = "font-label text-[0.625rem] leading-none font-bold tracking-[1.4px] uppercase";
const COUNT = "font-label text-[0.625rem] leading-none font-medium text-muted-foreground uppercase";

export function Accordion({ title, count, children }: { title: string; count?: string | number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className={cn("border bg-raised", open ? "border-foreground" : "border-rule")}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 w-full items-center gap-2 px-3.5 py-3 text-left hover:bg-sunken/50 lg:px-4"
        >
          <span className={SECTION_LABEL}>{title}</span>
          {count !== undefined && <span className={COUNT}>// {count}</span>}
          {open ? <ChevronUpIcon className="ml-auto size-4 shrink-0" aria-hidden /> : <ChevronDownIcon className="ml-auto size-4 shrink-0" aria-hidden />}
        </button>
      </h3>
      {open && (
        <div id={id} className="flex flex-col gap-3 px-3.5 pb-4 lg:px-4">
          {children}
        </div>
      )}
    </section>
  );
}

/** A fixed card for the desktop side column: the same head, always open. */
export function SideCard({ title, count, children }: { title: string; count?: string | number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border border-rule bg-raised px-3.5 py-3.5">
      <h2 className="flex items-baseline gap-2">
        <span className={SECTION_LABEL}>{title}</span>
        {count !== undefined && <span className={COUNT}>// {count}</span>}
      </h2>
      {children}
    </section>
  );
}
