import { StarIcon } from "lucide-react";
import { useToggleFavorite } from "@/lib/favorites";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export function StarButton({
  storyId,
  favorite,
  headline,
  className,
}: {
  storyId: string;
  favorite: boolean;
  headline: string;
  className?: string;
}) {
  const toggle = useToggleFavorite({
    onError: (_err, vars) => toast(vars.favorite ? "Couldn't save the favorite. Try again." : "Couldn't remove the favorite. Try again.", "error"),
  });
  return (
    <button
      type="button"
      data-star-button
      aria-pressed={favorite}
      aria-label={favorite ? `Remove from favorites: ${headline}` : `Save to favorites: ${headline}`}
      title={favorite ? "Remove from favorites (s)" : "Save to favorites (s)"}
      onClick={() => toggle.mutate({ storyId, favorite: !favorite })}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted",
        favorite ? "text-feed" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <StarIcon className={cn("size-[1.15rem]", favorite && "fill-current")} aria-hidden />
    </button>
  );
}
