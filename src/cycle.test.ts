import { test } from "node:test";
import assert from "node:assert/strict";
import { fromEnv } from "./config.ts";
import { breakerTripped, runCycle, type CycleStats } from "./cycle.ts";
import type { Item, Library } from "./omnivore.ts";

const BASE = { OMNIVORE_API_URL: "https://keep.example/api/graphql", OMNIVORE_API_KEY: "k" };
const stats = (found: number, gone: number, unknown: number): CycleStats => ({ found, gone, unknown });

test("breaker stays closed on a healthy cycle", () => {
  assert.equal(breakerTripped(stats(9, 1, 0), fromEnv(BASE)), false);
});

test("breaker trips when unknown dominates", () => {
  // Twenty deleted posts in a row is implausible; a block or a changed
  // format is the likely explanation.
  assert.equal(breakerTripped(stats(0, 0, 20), fromEnv(BASE)), true);
});

test("breaker ignores small samples", () => {
  assert.equal(breakerTripped(stats(0, 0, 1), fromEnv(BASE)), false);
});

test("breaker does not trip on many genuine gones", () => {
  // gone is an assertion by Instagram, not our uncertainty: it does not count.
  assert.equal(breakerTripped(stats(0, 20, 0), fromEnv(BASE)), false);
});

test("breaker threshold is configurable", () => {
  assert.equal(breakerTripped(stats(3, 0, 7), fromEnv({ ...BASE, UNKNOWN_RATIO_LIMIT: "0.9" })), false);
});

class FakeLibrary implements Library {
  readonly updates: string[] = [];
  readonly labelCalls: string[] = [];
  readonly #items: Item[];
  // No parameter properties: that is non-erasable TS syntax, which Node's
  // native type stripping rejects and erasableSyntaxOnly forbids.
  constructor(items: Item[]) { this.#items = items; }
  async search(): Promise<Item[]> { return this.#items; }
  async updatePage(id: string): Promise<void> { this.updates.push(id); }
  async setLabels(id: string): Promise<void> { this.labelCalls.push(id); }
}

test("a fully blocked cycle writes nothing", async () => {
  // The case that drove the redesign: HTTP 200 with no author and no
  // broken-media marker is the signature of a block, and must never turn into
  // a labelling spree.
  const items: Item[] = Array.from({ length: 10 }, (_, n) => ({
    id: String(n), url: `https://www.instagram.com/p/AAA${n}/`, title: "Instagram", labels: [],
  }));
  const library = new FakeLibrary(items);
  const blocked = async (): Promise<Response> =>
    new Response("<html><div class='LoginWall'></div></html>", { status: 200 });

  const result = await runCycle(library, fromEnv(BASE), {
    fetchImpl: blocked, sleep: async () => {},
  });

  assert.equal(result.unknown, 10);
  assert.deepEqual(library.updates, []);
  assert.deepEqual(library.labelCalls, []);
});
