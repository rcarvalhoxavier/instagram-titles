import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTitle } from "./title.ts";

test("short caption is used verbatim", () => {
  assert.equal(buildTitle("nasa", "Hello from orbit"), "Hello from orbit");
});

test("long caption is truncated at a word boundary", () => {
  const result = buildTitle("nasa", "word ".repeat(60), 20);
  assert.ok(result.endsWith("\u2026"));
  assert.ok(!result.slice(0, -1).endsWith(" "));
});

test("empty caption falls back to the author handle", () => {
  assert.equal(buildTitle("nasa", ""), "@nasa");
  assert.equal(buildTitle("nasa", "   "), "@nasa");
});

test("truncation never splits a surrogate pair", () => {
  // Dado escolhido para QUEBRAR um slice() cru: com "a" na frente, o corte cai
  // no meio de um par em metade dos indices possiveis (2,4,6,...). Medido:
  // rockets puros NAO exercitam o bug, porque 10 unidades UTF-16 sao 5 pares
  // inteiros. Este teste falha com slice() e passa com Intl.Segmenter.
  const result = buildTitle("nasa", "a" + "\u{1F680}".repeat(20), 10);
  assert.equal(result.match(/[\uD800-\uDFFF]/g)?.filter((c, i, a) =>
    a.length % 2 !== 0).length ?? 0, 0);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(result), "high surrogate solto");
  assert.ok(!/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(result), "low surrogate solto");
});

test("grapheme clusters survive truncation", () => {
  const result = buildTitle("nasa", "\u{1F1FA}\u{1F1F8}".repeat(20), 5);
  assert.ok(!/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(result));
});

test("whitespace is normalised", () => {
  assert.equal(buildTitle("nasa", "a\n\n  b\tc"), "a b c");
});
