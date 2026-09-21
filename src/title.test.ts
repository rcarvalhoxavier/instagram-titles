import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTitle } from "./title.ts";

test("short caption is used verbatim", () => {
  assert.equal(buildTitle("nasa", "Hello from orbit", 120), "Hello from orbit");
});

test("long caption is truncated at a word boundary", () => {
  const result = buildTitle("nasa", "word ".repeat(60), 20);
  assert.ok(result.endsWith("\u2026"));
  assert.ok(!result.slice(0, -1).endsWith(" "));
});

test("empty caption falls back to the author handle", () => {
  assert.equal(buildTitle("nasa", "", 120), "@nasa");
  assert.equal(buildTitle("nasa", "   ", 120), "@nasa");
});

test("truncation never splits a surrogate pair", () => {
  // Data chosen to BREAK a naive slice(): with "a" in front, the cut lands
  // mid-pair at half the possible indices (2,4,6,...). Measured: pure rockets
  // do NOT exercise the bug, because 10 UTF-16 units are exactly 5 whole
  // pairs. This test fails with slice() and passes with Intl.Segmenter.
  const result = buildTitle("nasa", "a" + "\u{1F680}".repeat(20), 10);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(result), "lone high surrogate");
  assert.ok(!/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(result), "lone low surrogate");
});

test("grapheme clusters survive truncation", () => {
  const result = buildTitle("nasa", "\u{1F1FA}\u{1F1F8}".repeat(20), 5);
  assert.ok(!/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(result));
});

test("whitespace is normalised", () => {
  assert.equal(buildTitle("nasa", "a\n\n  b\tc", 120), "a b c");
});
