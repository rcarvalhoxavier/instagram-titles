import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, unescapeHtml } from "./resolver.ts";

const load = (name: string): string =>
  readFileSync(new URL(`../fixtures/${name}.html`, import.meta.url), "utf8");

test("JSON variant returns author and caption", () => {
  const result = classify(load("embed_json"));
  assert.equal(result.kind, "found");
  if (result.kind !== "found") return;
  assert.equal(result.author, "astronautgio");
  assert.ok(result.caption.startsWith("A true honor to share with Jared Isaacman"));
});

test("JSON variant decodes double-escaped unicode", () => {
  // O blob vem escapado DUAS vezes: uma pelo JSON, outra pela string JS que o
  // embute. Um decode simples deixa "\ud83d\ude80" literal no titulo, em vez
  // do foguete decodificado que o teste abaixo exige.
  const result = classify(load("embed_json"));
  if (result.kind !== "found") return assert.fail("expected found");
  assert.ok(result.caption.includes("\u{1F680}"), "rocket must be decoded");
  assert.ok(!result.caption.includes("ud83d"), "no surviving escape");
  assert.ok(result.caption.includes("@nasaadmin"), "\\u0040 must decode to @");
});

test("HTML variant returns author and caption", () => {
  const result = classify(load("embed_html"));
  if (result.kind !== "found") return assert.fail("expected found");
  assert.equal(result.author, "planetarioba");
  assert.ok(result.caption.startsWith("\u{1F680} Nace la NASA"));
});

test("HTML variant strips the username prefix from the caption", () => {
  const result = classify(load("embed_html"));
  if (result.kind !== "found") return assert.fail("expected found");
  assert.ok(!result.caption.startsWith("planetarioba"));
});

test("broken-media marker means gone", () => {
  assert.equal(classify(load("embed_gone")).kind, "gone");
});

test("no author and no broken marker means unknown", () => {
  // Invariante central: um bloqueio NAO pode virar Gone, porque Gone escreve
  // um rotulo permanente na biblioteca do usuario.
  assert.equal(classify(load("embed_blocked_synthetic")).kind, "unknown");
});

for (const junk of ["", "<html></html>", "garbage"]) {
  test(`junk input ${JSON.stringify(junk)} is unknown, never gone`, () => {
    assert.equal(classify(junk).kind, "unknown");
  });
}

test("unescapeHtml maps each entity to the right character", () => {
  // unescapeHtml is exported, so its contract stands on its own — classify
  // happens to fold whitespace afterwards, which masked a wrong &nbsp; once.
  assert.equal(unescapeHtml("a&nbsp;b").charCodeAt(1), 0xa0, "&nbsp; must be U+00A0, not a plain space");
  assert.equal(unescapeHtml("&amp;&lt;&gt;&quot;&apos;"), "&<>\"'");
  assert.equal(unescapeHtml("&#65;&#x42;"), "AB");
  assert.equal(unescapeHtml("&notanentity;"), "&notanentity;");
});
