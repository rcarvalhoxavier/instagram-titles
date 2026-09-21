import { test } from "node:test";
import assert from "node:assert/strict";
import { fromEnv } from "./config.ts";
import type { Item, Library, SearchPage } from "./omnivore.ts";
import { applyFound, applyGone } from "./writer.ts";

const BASE = { OMNIVORE_API_URL: "https://keep.example/api/graphql", OMNIVORE_API_KEY: "k" };

class FakeLibrary implements Library {
  readonly updates: Array<[string, string, string]> = [];
  readonly labelCalls: Array<[string, string[]]> = [];
  async search(): Promise<SearchPage> { return { items: [], next: null }; }
  async updatePage(id: string, title: string, byline: string): Promise<void> {
    this.updates.push([id, title, byline]);
  }
  async setLabels(id: string, labels: readonly string[]): Promise<void> {
    this.labelCalls.push([id, [...labels]]);
  }
}

const item = (labels: string[] = []): Item => ({
  id: "1", url: "https://www.instagram.com/p/AAA/", title: "Instagram", labels,
});

test("found writes title and byline", async () => {
  const library = new FakeLibrary();
  await applyFound(library, item(), { author: "nasa", caption: "Hello from orbit" }, fromEnv(BASE));
  assert.deepEqual(library.updates, [["1", "Hello from orbit", "nasa"]]);
});

test("found with an empty caption falls back to the handle", async () => {
  const library = new FakeLibrary();
  await applyFound(library, item(), { author: "nasa", caption: "" }, fromEnv(BASE));
  assert.deepEqual(library.updates, [["1", "@nasa", "nasa"]]);
});

test("gone preserves existing labels", async () => {
  // Spec risk #1: setLabels REPLACES the set. Writing only our own label
  // would delete the labels the user had already put on the item.
  const library = new FakeLibrary();
  await applyGone(library, item(["keep", "reading"]), fromEnv(BASE));
  assert.deepEqual(new Set(library.labelCalls[0]?.[1]),
    new Set(["keep", "reading", "instagram-unavailable"]));
});

test("gone is idempotent", async () => {
  const library = new FakeLibrary();
  await applyGone(library, item(["instagram-unavailable"]), fromEnv(BASE));
  assert.deepEqual(library.labelCalls, []);
});

test("dry run writes nothing", async () => {
  const library = new FakeLibrary();
  const config = fromEnv({ ...BASE, DRY_RUN: "true" });
  await applyFound(library, item(), { author: "nasa", caption: "Hello" }, config);
  await applyGone(library, item(), config);
  assert.deepEqual(library.updates, []);
  assert.deepEqual(library.labelCalls, []);
});
