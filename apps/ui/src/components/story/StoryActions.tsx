// Star, share and open-source icon buttons for the top of the story page (30 px outlined squares, 44 px on the phone).
import { ExternalLinkIcon, Share2Icon } from "lucide-react";
import type { StoryView } from "@news/schema";
import { ExternalLink } from "@/components/Chips";
import { StarButton } from "@/components/StarButton";
import { shareStory } from "@/components/StoryRow";
import { safeUrl } from "@/lib/safe-url";

const BTN = "inline-flex size-11 shrink-0 items-center justify-center rounded-none border border-outline bg-raised text-foreground hover:bg-sunken lg:size-[30px]";

export function StoryActions({ s }: { s: StoryView }) {
  const source = s.sources.map((x) => ({ x, url: safeUrl(x.url) })).find((x) => x.url);
  return (
    <div className="flex shrink-0 items-center gap-2">
      <StarButton storyId={s.id} favorite={s.favorite} headline={s.headline} className={`${BTN} size-11 lg:size-[30px]`} />
      <button type="button" aria-label="Share" title="Share" className={BTN} onClick={() => void shareStory(s)}>
        <Share2Icon className="size-3.5" aria-hidden />
      </button>
      {source && (
        <ExternalLink href={source.url!} label={`Open source: ${source.x.outlet}`} className={BTN}>
          <ExternalLinkIcon className="size-3.5" aria-hidden />
        </ExternalLink>
      )}
    </div>
  );
}
