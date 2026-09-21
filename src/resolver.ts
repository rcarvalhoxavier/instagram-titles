export type Result =
  | { readonly kind: "found"; readonly author: string; readonly caption: string }
  | { readonly kind: "gone" }
  | { readonly kind: "unknown"; readonly reason: string };

const BROKEN_MEDIA = /class="EmbedBrokenMedia"/;
const USERNAME_TEXT = /class="UsernameText">([^<]+)</;
const USERNAME_ANY = /class="Username"[^>]*>([^<]+)</;
const JSON_CAPTION =
  /edge_media_to_caption\\":\{\\"edges\\":\[\{\\"node\\":\{\\"text\\":\\"(.*?)\\"\}\}\]/s;
const HTML_CAPTION = /class="Caption">(.*?)<\/div>/s;
const CAPTION_USERNAME_LINK = /<a[^>]*class="CaptionUsername"[^>]*>.*?<\/a>/s;
const TAGS = /<[^>]+>/g;
const WHITESPACE = /\s+/g;

// Instagram handles: letters, digits, dots and underscores, at most 30 chars.
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
};

export function unescapeHtml(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = Number.parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10);
      // String.fromCodePoint throws RangeError above 0x10FFFF, and a caption is
      // attacker-controlled text. Leaving the entity as written is the safe
      // reading of something that is not a valid code point anyway.
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[entity] ?? whole;
  });
}

function captionFromJson(document: string): string | null {
  const match = JSON_CAPTION.exec(document);
  if (match === null) return null;
  try {
    const once = JSON.parse(`"${match[1]}"`) as string;
    return JSON.parse(`"${once}"`) as string;
  } catch {
    return null;
  }
}

function captionFromHtml(document: string): string | null {
  // Cheap guard before the non-greedy scan: if the opening marker is absent
  // there is nothing to find, and the regex would walk the whole document to
  // discover that.
  if (!document.includes('class="Caption"')) return null;
  const match = HTML_CAPTION.exec(document);
  if (match === null) return null;
  return unescapeHtml(match[1]!.replace(CAPTION_USERNAME_LINK, "").replace(TAGS, ""));
}

export function classify(document: string): Result {
  if (BROKEN_MEDIA.test(document)) return { kind: "gone" };

  const authorMatch = USERNAME_TEXT.exec(document) ?? USERNAME_ANY.exec(document);
  if (authorMatch === null) {
    return { kind: "unknown", reason: "no author marker and no broken-media marker" };
  }

  // An author that trims to nothing is not a usable result. Letting it through
  // would produce the title "@", which is worse than doing nothing: it destroys
  // the "Instagram" title that at least names the source, and it stops matching
  // the selector's pattern, so the item never returns to the queue to be fixed.
  const author = authorMatch[1]!.trim();
  if (author === "") {
    return { kind: "unknown", reason: "author marker present but empty" };
  }
  // The capture is "anything that is not a tag", so it will happily match a
  // paragraph of markup if the page shape changes. Requiring it to look like
  // an Instagram handle turns that into unknown -- which writes nothing --
  // instead of a byline full of junk.
  if (!HANDLE.test(author)) {
    // Sliced by grapheme, not by UTF-16 unit: this string goes into a log
    // line, and cutting a surrogate pair in half there is the same defect
    // title.ts uses Intl.Segmenter to avoid.
    const shown = [...GRAPHEMES.segment(author)].slice(0, 40).map((g) => g.segment).join("");
    return { kind: "unknown", reason: `author does not look like a handle: "${shown}"` };
  }

  const caption = captionFromJson(document) ?? captionFromHtml(document) ?? "";
  return {
    kind: "found",
    author,
    caption: caption.replace(WHITESPACE, " ").trim(),
  };
}
