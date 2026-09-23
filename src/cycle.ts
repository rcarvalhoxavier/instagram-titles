import { resolve, type Outcome, type ParseResult } from "instagram-caption";
import type { Config } from "./config.ts";
import type { Fetcher, Item, Library } from "./omnivore.ts";
import { findCandidates } from "./selector.ts";
import { applyFound, applyGone, type Logger } from "./writer.ts";

// Keep in sync with package.json. This is what Instagram sees: the tool doing
// the work, not the library it borrows. Naming the library here would make
// every installation of every tool that uses it look like the same client.
const USER_AGENT = "instagram-titles/0.1.0 (+https://github.com/rcarvalhoxavier/instagram-titles)";

/**
 * Collapses the library's five outcomes back into the three this tool acts on.
 *
 * unavailable and not-instagram become unknown ON PURPOSE: unknownRatioLimit
 * was calibrated against what unknown means here, which has always included
 * transport failures. Giving them their own bucket would change the breaker's
 * sensitivity without anyone changing a setting.
 */
export function toParseResult(outcome: Outcome): ParseResult {
  switch (outcome.kind) {
    case "found":
    case "gone":
    case "unknown":
      return outcome;
    case "unavailable":
      return { kind: "unknown", reason: `could not reach the embed endpoint: ${outcome.reason}` };
    case "not-instagram":
      // findCandidates rejects items without a shortcode, so this is
      // unreachable in practice. It exists so the switch is exhaustive.
      return { kind: "unknown", reason: "not an Instagram post URL" };
  }
}

export const PAUSE_BETWEEN_FETCHES_MS = 1500;

export interface CycleStats {
  readonly found: number;
  readonly gone: number;
  readonly unknown: number;
  /**
   * Seconds the caller should wait beyond its normal interval before trying
   * again. Set when the breaker trips: nothing was written, so the same
   * candidates return next cycle, and retrying them at the usual cadence
   * would hammer a peer that is already refusing us.
   */
  readonly backoffSeconds: number;
}

export const BREAKER_BACKOFF_SECONDS = 60 * 60;

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

  // findCandidates already caps at maxPerCycle; slicing again here would just
  // leave a reader wondering which of the two is authoritative.
  const candidates = await findCandidates(library, config);
  log(`cycle start: ${candidates.length} candidate(s)`);

  const decisions: Array<{ item: Item; result: ParseResult }> = [];
  let found = 0, gone = 0, unknown = 0;

  for (const [index, item] of candidates.entries()) {
    // One item must never be able to end the cycle. Captions are text other
    // people wrote, and anything unexpected in one of them -- or a transport
    // error we did not anticipate -- would otherwise abort the loop, skip every
    // remaining item, and come back to abort the next cycle in the same place,
    // because the item is never retitled and so is selected again.
    let result: ParseResult;
    try {
      const outcome = await resolve(item.url, {
        retries: config.fetchRetries,
        fetchImpl,
        sleep,
        userAgent: USER_AGENT,
      });
      result = toParseResult(outcome);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errorLog(`resolving ${item.id} threw: ${message}`);
      result = { kind: "unknown", reason: `threw while resolving: ${message}` };
    }

    if (result.kind === "found") found++;
    else if (result.kind === "gone") gone++;
    else {
      unknown++;
      // The reason is the only thing that distinguishes a block from a format
      // change from a network failure -- the three hypotheses the breaker's
      // own message asks the operator to tell apart. Computing it and never
      // printing it made every one of them look identical in the log.
      log(`${item.id} unknown: ${result.reason}`);
    }
    decisions.push({ item, result });

    if (index < candidates.length - 1) await sleep(PAUSE_BETWEEN_FETCHES_MS);
  }

  const stats: CycleStats = { found, gone, unknown, backoffSeconds: 0 };

  // Every write happens after the whole cycle is classified, so the breaker can
  // veto the batch. Deciding item-by-item would let damage land before the
  // pattern became visible.
  if (breakerTripped(stats, config)) {
    errorLog(
      `circuit breaker tripped: ${unknown}/${total(stats)} unknown - writing nothing. ` +
      `Likely a block or an Instagram format change. ` +
      `Backing off for ${BREAKER_BACKOFF_SECONDS}s before the next cycle.`,
    );
    return { ...stats, backoffSeconds: BREAKER_BACKOFF_SECONDS };
  }

  // Each write is isolated for the same reason each resolution is: one item
  // failing must not discard the classification work already done for the
  // other nineteen, nor waste the cycle's request budget.
  for (const { item, result } of decisions) {
    try {
      if (result.kind === "found") await applyFound(library, item, result, config, log);
      else if (result.kind === "gone") await applyGone(library, item, config, log);
    } catch (error) {
      errorLog(`writing ${item.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  log(`cycle done: ${found} found, ${gone} gone, ${unknown} unknown`);
  return stats;
}
