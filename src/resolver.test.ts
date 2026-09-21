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
  // The blob is escaped TWICE: once by the JSON, once by the JS string that
  // embeds it. A single decode leaves "\ud83d\ude80" literal in the title,
  // instead of the decoded rocket this test requires.
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
  // Central invariant: a block must NEVER become gone, because gone writes a
  // permanent label into the user's library.
  assert.equal(classify(load("embed_blocked_synthetic")).kind, "unknown");
});

for (const junk of ["", "<html></html>", "garbage"]) {
  test(`junk input ${JSON.stringify(junk)} is unknown, never gone`, () => {
    assert.equal(classify(junk).kind, "unknown");
  });
}

test("unescapeHtml maps each entity to the right character", () => {
  // unescapeHtml is exported, so its contract stands on its own: classify
  // happens to fold whitespace afterwards, which masked a wrong &nbsp; once.
  assert.equal(unescapeHtml("a&nbsp;b").charCodeAt(1), 0xa0, "&nbsp; must be U+00A0, not a plain space");
  assert.equal(unescapeHtml("&amp;&lt;&gt;&quot;&apos;"), "&<>\"'");
  assert.equal(unescapeHtml("&#65;&#x42;"), "AB");
  assert.equal(unescapeHtml("&notanentity;"), "&notanentity;");
});

test("an author marker that trims to nothing is unknown, not found", () => {
  // Reachable: the author regex accepts any non-tag characters, including
  // whitespace only. Letting it through yields the title "@", which is worse
  // than doing nothing -- it destroys the "Instagram" title that at least names
  // the source, and it stops matching the selector, so the item can never be
  // picked up and fixed again.
  for (const html of [`<span class="UsernameText"> </span>`,
                      `<span class="UsernameText">\t</span>`,
                      `<a class="Username" href="x">  </a>`]) {
    assert.equal(classify(html).kind, "unknown", `${JSON.stringify(html)} must not be found`);
  }
});

test("an out-of-range numeric entity is left alone, never thrown on", () => {
  // String.fromCodePoint throws RangeError above 0x10FFFF. A caption is text
  // someone else wrote, so a throw here would abort the whole cycle and, since
  // the item is never retitled, it would come back and abort the next one too.
  const poisoned = `<span class="UsernameText">x</span>` +
    `<div class="Caption">hi &#1114112; there</div>`;
  const result = classify(poisoned);
  assert.equal(result.kind, "found");
  assert.equal(unescapeHtml("&#1114112;"), "&#1114112;");
  assert.equal(unescapeHtml("&#x110000;"), "&#x110000;");
  assert.equal(unescapeHtml("&#-1;"), "&#-1;");
  assert.equal(unescapeHtml("&#128640;"), "\u{1F680}");
});
