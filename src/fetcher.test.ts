import { test } from "node:test";
import assert from "node:assert/strict";
import { embedUrl, extractShortcode, fetchEmbed } from "./fetcher.ts";

const CASES: ReadonlyArray<readonly [string, string | null]> = [
  ["https://www.instagram.com/p/DTyxjPyAa18/", "DTyxjPyAa18"],
  ["https://www.instagram.com/p/DTyxjPyAa18/?igsh=abc123", "DTyxjPyAa18"],
  ["https://instagram.com/reel/DTyxjPyAa18/", "DTyxjPyAa18"],
  ["https://www.instagram.com/reels/DTyxjPyAa18", "DTyxjPyAa18"],
  ["https://www.instagram.com/astronautgio/p/DTyxjPyAa18/", "DTyxjPyAa18"],
  ["https://example.com/p/DTyxjPyAa18/", null],
  ["https://www.instagram.com/astronautgio/", null],
  ["not a url", null],
];

for (const [url, expected] of CASES) {
  test(`extractShortcode(${url})`, () => assert.equal(extractShortcode(url), expected));
}

test("embedUrl always uses the /p/ form", () => {
  assert.equal(embedUrl("ABC123"), "https://www.instagram.com/p/ABC123/embed/captioned/");
});

const noSleep = async (): Promise<void> => {};

test("returns the body on success", async () => {
  const fetchImpl = async (): Promise<Response> => new Response("<html>ok</html>", { status: 200 });
  assert.equal(await fetchEmbed("ABC", { retries: 3, fetchImpl, sleep: noSleep }), "<html>ok</html>");
});

test("retries then succeeds", async () => {
  let calls = 0;
  const fetchImpl = async (): Promise<Response> => {
    calls++;
    if (calls < 3) throw new Error("boom");
    return new Response("<html>ok</html>", { status: 200 });
  };
  assert.equal(await fetchEmbed("ABC", { retries: 3, fetchImpl, sleep: noSleep }), "<html>ok</html>");
  assert.equal(calls, 3);
});

test("returns null after exhausting retries", async () => {
  const fetchImpl = async (): Promise<Response> => { throw new Error("boom"); };
  assert.equal(await fetchEmbed("ABC", { retries: 2, fetchImpl, sleep: noSleep }), null);
});

for (const status of [429, 503]) {
  test(`HTTP ${status} is never mistaken for content`, async () => {
    const fetchImpl = async (): Promise<Response> => new Response("", { status });
    assert.equal(await fetchEmbed("ABC", { retries: 2, fetchImpl, sleep: noSleep }), null);
  });
}
