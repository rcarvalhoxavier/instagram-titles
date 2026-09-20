import type { Config } from "./config.ts";
import { extractShortcode } from "./fetcher.ts";
import type { Item, Library } from "./omnivore.ts";

// Kept deliberately broad: if the instance's search cannot filter by host, we
// filter client-side in needsFix anyway. See design risk #3.
export const SEARCH_QUERY = "in:all instagram.com";

export function needsFix(item: Item, config: Config): boolean {
  if (extractShortcode(item.url) === null) return false;
  if (!config.genericTitlePattern.test(item.title)) return false;
  if (item.labels.includes(config.giveUpLabel) && !config.retryLabeled) return false;
  return true;
}

export async function findCandidates(library: Library, config: Config): Promise<Item[]> {
  // Over-fetch, because the server-side query may match more loosely than
  // needsFix does; the cap is applied after filtering, by the caller.
  const found = await library.search(SEARCH_QUERY, config.maxPerCycle * 5);
  return found.filter((item) => needsFix(item, config));
}
