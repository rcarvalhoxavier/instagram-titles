import { test } from "node:test";
import assert from "node:assert/strict";
import { fromEnv } from "./config.ts";
import type { Item } from "./omnivore.ts";
import { needsFix } from "./selector.ts";

const BASE = { OMNIVORE_API_URL: "https://keep.example/api/graphql", OMNIVORE_API_KEY: "k" };
const item = (over: Partial<Item> = {}): Item => ({
  id: "1", url: "https://www.instagram.com/p/AAA/", title: "Instagram", labels: [], ...over,
});

test("generic Instagram item is selected", () => {
  assert.equal(needsFix(item(), fromEnv(BASE)), true);
});

test("already fixed item is skipped", () => {
  // Why no attempt counter is needed: a fixed item leaves the queue by
  // construction, because its title no longer matches the pattern.
  assert.equal(needsFix(item({ title: "A true honor to share" }), fromEnv(BASE)), false);
});

test("non-Instagram item is skipped even with a generic title", () => {
  // A news article titled literally "Instagram" must never be touched.
  assert.equal(needsFix(item({ url: "https://news.example/instagram" }), fromEnv(BASE)), false);
});

test("labelled item is skipped by default", () => {
  assert.equal(needsFix(item({ labels: ["instagram-unavailable"] }), fromEnv(BASE)), false);
});

test("labelled item is included when RETRY_LABELED is set", () => {
  const config = fromEnv({ ...BASE, RETRY_LABELED: "true" });
  assert.equal(needsFix(item({ labels: ["instagram-unavailable"] }), config), true);
});

test("url without a shortcode is skipped", () => {
  assert.equal(needsFix(item({ url: "https://www.instagram.com/astronautgio/" }), fromEnv(BASE)), false);
});

test("only an exact title matches, including newline and case variants", () => {
  // The whole safety boundary rests on an unstated ECMAScript detail: without
  // the "m" flag, "$" anchors to end-of-string and NOT to a position before a
  // trailing newline, unlike some other regex flavours. Pin it, because a
  // single stray "m" flag would start overwriting hand-written titles.
  const config = fromEnv(BASE);
  for (const title of ["Instagram ", " Instagram", "instagram", "INSTAGRAM",
                       "Instagram post", "Instagram\n", "Instagram\nfoo",
                       "foo\nInstagram", "Instagram\r"]) {
    assert.equal(needsFix(item({ title }), config), false,
      `title ${JSON.stringify(title)} must be left alone`);
  }
  assert.equal(needsFix(item({ title: "Instagram" }), config), true);
});
