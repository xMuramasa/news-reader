// /search: the phone's SEARCH tab and the target of the desktop top bar field. The query lives in the URL (?q=).
import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { SearchBox } from "@/components/Filters";
import { NoStories, StoryList } from "@/components/StoryList";
import { EMPTY_FILTERS, MAX_QUERY } from "@/lib/filters";
import { useTitle } from "@/lib/title";

export function Search() {
  useTitle("Search");
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").trim().slice(0, MAX_QUERY);
  const onChange = useCallback((next: string) => setParams(next ? { q: next } : {}, { replace: true }), [setParams]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="headline border-b-2 border-foreground pb-2 text-3xl font-semibold sm:text-4xl">Search</h1>
      <div className="flex [&_input]:h-14 [&_input]:pl-11 [&_input]:text-lg [&_svg]:left-4 [&_svg]:size-5">
        <SearchBox value={q} onChange={onChange} autoFocus />
      </div>
      {q ? (
        <section aria-label="Results">
          <StoryList filters={{ ...EMPTY_FILTERS, q }} empty={<NoStories>Nothing matches “{q}”. Try fewer words or a CVE id.</NoStories>} />
        </section>
      ) : (
        <p className="text-muted-foreground">Search headlines, summaries, tags and CVEs</p>
      )}
    </div>
  );
}
