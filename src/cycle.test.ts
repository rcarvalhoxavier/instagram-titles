import { test } from "node:test";
import assert from "node:assert/strict";
import { fromEnv } from "./config.ts";
import { breakerTripped, runCycle, toParseResult, type CycleStats } from "./cycle.ts";
import type { Item, Library, SearchPage } from "./omnivore.ts";

const BASE = { OMNIVORE_API_URL: "https://keep.example/api/graphql", OMNIVORE_API_KEY: "k" };
const stats = (found: number, gone: number, unknown: number): CycleStats =>
  ({ found, gone, unknown, backoffSeconds: 0 });

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
  async search(): Promise<SearchPage> { return { items: this.#items, next: null }; }
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

// A page that classifies as found: an author marker plus a caption block.
const RESOLVES = `<span class="UsernameText">someone</span>` +
  `<div class="Caption">a real caption</div>`;

function mixedTransport(): (url: string | URL | Request) => Promise<Response> {
  // Items whose shortcode starts with OK resolve; the rest look like a block.
  return async (url) => new Response(
    String(url).includes("/p/OK") ? RESOLVES : "<html><div class='LoginWall'></div></html>",
    { status: 200 },
  );
}

test("the breaker vetoes the whole batch, including items that did resolve", async () => {
  // This is the test the previous one only pretended to be. A batch of pure
  // unknowns writes nothing even with no breaker at all, because the write loop
  // skips unknowns anyway -- so it could not detect the breaker being deleted.
  // Here 3 items resolve and 7 do not: 0.7 unknown, over the 0.5 limit. Without
  // the breaker the 3 resolved items WOULD be written, which is exactly the
  // damage a soft block must not be allowed to cause.
  const items: Item[] = [
    ...Array.from({ length: 3 }, (_, n) => ({
      id: `ok${n}`, url: `https://www.instagram.com/p/OK${n}/`, title: "Instagram", labels: [],
    })),
    ...Array.from({ length: 7 }, (_, n) => ({
      id: `no${n}`, url: `https://www.instagram.com/p/NO${n}/`, title: "Instagram", labels: [],
    })),
  ];
  const library = new FakeLibrary(items);
  const stats = await runCycle(library, fromEnv(BASE), {
    fetchImpl: mixedTransport(), sleep: async () => {},
  });

  assert.equal(stats.found, 3, "three items must have resolved");
  assert.equal(stats.unknown, 7, "seven items must be unknown");
  assert.deepEqual(library.updates, [], "the breaker must veto the resolved items too");
  assert.deepEqual(library.labelCalls, []);
});

test("an item whose fetch throws becomes unknown without ending the cycle", async () => {
  // Captions are text other people wrote. One surprise in one item must not
  // skip the other nineteen and then repeat that every cycle forever.
  const items: Item[] = [
    { id: "boom", url: "https://www.instagram.com/p/BOOM/", title: "Instagram", labels: [] },
    { id: "fine", url: "https://www.instagram.com/p/FINE/", title: "Instagram", labels: [] },
  ];
  const library = new FakeLibrary(items);
  const errors: string[] = [];
  const stats = await runCycle(library, fromEnv(BASE), {
    fetchImpl: async (url) => {
      if (String(url).includes("BOOM")) throw new Error("kaboom");
      return new Response(RESOLVES, { status: 200 });
    },
    sleep: async () => {},
    errorLog: (m) => errors.push(m),
  });

  assert.equal(stats.found, 1, "the healthy item must still be processed");
  assert.equal(stats.unknown, 1, "the throwing item becomes unknown, not gone");
  assert.deepEqual(library.updates, ["fine"]);
});

test("a gone item is labelled end to end through runCycle", async () => {
  const items: Item[] = [
    { id: "vanished", url: "https://www.instagram.com/p/GONE/", title: "Instagram", labels: ["keep"] },
  ];
  const library = new FakeLibrary(items);
  const stats = await runCycle(library, fromEnv(BASE), {
    fetchImpl: async () => new Response(`<div class="EmbedBrokenMedia"></div>`, { status: 200 }),
    sleep: async () => {},
  });

  assert.equal(stats.gone, 1);
  assert.deepEqual(library.updates, [], "a gone item must never be retitled");
  assert.deepEqual(library.labelCalls, ["vanished"]);
});

test("a fetch failure still counts as unknown, so the breaker keeps its sensitivity", () => {
  // unknownRatioLimit was calibrated against what unknown means today, which
  // includes transport failures. Letting unavailable become its own bucket
  // would quietly make the breaker less sensitive than the operator configured.
  const result = toParseResult({ kind: "unavailable", reason: "HTTP 503", retryable: true, status: 503 });
  assert.equal(result.kind, "unknown");
  assert.match(result.reason, /503/, "the reason must survive, or the log lies about why");
});

test("a non-Instagram url counts as unknown too, and says so", () => {
  const result = toParseResult({ kind: "not-instagram" });
  assert.equal(result.kind, "unknown");
});

for (const outcome of [
  { kind: "found", author: "a", caption: "c" },
  { kind: "gone" },
  { kind: "unknown", reason: "why" },
] as const) {
  test(`${outcome.kind} passes through unchanged`, () => {
    assert.deepEqual(toParseResult(outcome), outcome);
  });
}
