// Headlines as shown in the UI. Updates are marked with a pill and in the thread timeline, so an "Update:" prefix the
// model wrote into the headline itself is dropped (older editions have it; current prompts ask the model not to).

const UPDATE_PREFIX = /^\s*\(?update\)?\s*[:\-–—]\s*/i;
const UPDATE_SUFFIX = /\s*\(update\)\s*$/i;

export function displayHeadline(s: { headline: string; is_update?: boolean | null }): string {
  if (s.is_update !== true) return s.headline;
  const cleaned = s.headline.replace(UPDATE_PREFIX, "").replace(UPDATE_SUFFIX, "").trim();
  return cleaned || s.headline;
}
