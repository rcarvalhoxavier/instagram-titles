const WHITESPACE = /\s+/g;
export const ELLIPSIS = "\u2026";
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

// No default for maxChars on purpose: config.ts owns every default, and a
// second copy here would let the two drift apart silently.
export function buildTitle(author: string, caption: string, maxChars: number): string {
  const text = caption.replace(WHITESPACE, " ").trim();
  if (text === "") return `@${author}`;

  // JS strings are UTF-16, so slice() can cut an emoji in half. Segmenting by
  // grapheme also keeps flags and ZWJ sequences whole, which slicing by code
  // point would not.
  const graphemes = [...segmenter.segment(text)].map((entry) => entry.segment);
  if (graphemes.length <= maxChars) return text;

  let head = graphemes.slice(0, maxChars).join("");
  const lastSpace = head.lastIndexOf(" ");
  if (lastSpace > 0) head = head.slice(0, lastSpace);
  return head.trimEnd() + ELLIPSIS;
}
