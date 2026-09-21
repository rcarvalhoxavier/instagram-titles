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

const PAGE_SIZE = 100;
const MAX_PAGES = 20;

export async function findCandidates(library: Library, config: Config): Promise<Item[]> {
  // Items this tool has already fixed keep matching the server-side query, so
  // on a large library the newest page can be entirely work already done. A
  // single page would then return nothing while older, still-generic items sat
  // just out of reach forever. Walk pages until there are enough candidates or
  // the library runs out, with a page cap so one cycle cannot page endlessly.
  const candidates: Item[] = [];
  let after: string | undefined;

  for (let page = 0; page < MAX_PAGES && candidates.length < config.maxPerCycle; page++) {
    const { items, next } = await library.search(SEARCH_QUERY, PAGE_SIZE, after);
    for (const item of items) {
      if (needsFix(item, config)) candidates.push(item);
    }
    if (next === null) break;
    after = next;
  }

  return candidates.slice(0, config.maxPerCycle);
}
