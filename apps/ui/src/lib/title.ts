import { useEffect } from "react";

const SITE = "The Briefing";

export function useTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE}` : SITE;
  }, [title]);
}
