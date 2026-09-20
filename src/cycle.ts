import type { Config } from "./config.ts";
import { extractShortcode, fetchEmbed, type Fetcher } from "./fetcher.ts";
import type { Item, Library } from "./omnivore.ts";
import { classify, type Result } from "./resolver.ts";
import { findCandidates } from "./selector.ts";
import { applyFound, applyGone, type Logger } from "./writer.ts";

export const PAUSE_BETWEEN_FETCHES_MS = 1500;

export interface CycleStats {
  readonly found: number;
  readonly gone: number;
  readonly unknown: number;
}

export const total = (stats: CycleStats): number => stats.found + stats.gone + stats.unknown;

/**
 * True when too much of the cycle was Unknown to trust any of it.
 *
 * Gone does not count: it is an assertion by Instagram, not our uncertainty.
 */
export function breakerTripped(stats: CycleStats, config: Config): boolean {
  const seen = total(stats);
  if (seen < config.minSampleForBreaker) return false;
  return stats.unknown / seen > config.unknownRatioLimit;
}

export interface CycleDeps {
  readonly fetchImpl?: Fetcher;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: Logger;
  readonly errorLog?: Logger;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function runCycle(
  library: Library, config: Config, deps: CycleDeps = {},
): Promise<CycleStats> {
  const { fetchImpl = fetch, sleep = wait, log = () => {}, errorLog = () => {} } = deps;

  const candidates = (await findCandidates(library, config)).slice(0, config.maxPerCycle);
  log(`cycle start: ${candidates.length} candidate(s)`);

  const decisions: Array<{ item: Item; result: Result }> = [];
  let found = 0, gone = 0, unknown = 0;

  for (const [index, item] of candidates.entries()) {
    const shortcode = extractShortcode(item.url);
    // findCandidates already rejected items without a shortcode.
    const document = shortcode === null ? null
      : await fetchEmbed(shortcode, { retries: config.fetchRetries, fetchImpl, sleep, log });

    // A transport failure is indefinite, so it is Unknown by construction.
    const result: Result = document === null
      ? { kind: "unknown", reason: "could not reach the embed endpoint" }
      : classify(document);

    if (result.kind === "found") found++;
    else if (result.kind === "gone") gone++;
    else unknown++;
    decisions.push({ item, result });

    if (index < candidates.length - 1) await sleep(PAUSE_BETWEEN_FETCHES_MS);
  }

  const stats: CycleStats = { found, gone, unknown };

  // Every write happens after the whole cycle is classified, so the breaker can
  // veto the batch. Deciding item-by-item would let damage land before the
  // pattern became visible.
  if (breakerTripped(stats, config)) {
    errorLog(
      `circuit breaker tripped: ${unknown}/${total(stats)} unknown - writing nothing. ` +
      `Likely a block or an Instagram format change.`,
    );
    return stats;
  }

  for (const { item, result } of decisions) {
    if (result.kind === "found") await applyFound(library, item, result, config, log);
    else if (result.kind === "gone") await applyGone(library, item, config, log);
  }

  log(`cycle done: ${found} found, ${gone} gone, ${unknown} unknown`);
  return stats;
}
