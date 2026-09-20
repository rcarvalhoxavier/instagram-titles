export type Fetcher = typeof fetch;

const SHORTCODE = /\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/;
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);

export const USER_AGENT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

export function extractShortcode(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!INSTAGRAM_HOSTS.has(parsed.hostname)) return null;
  const match = SHORTCODE.exec(parsed.pathname);
  return match?.[1] ?? null;
}

export function embedUrl(shortcode: string): string {
  return `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
}

export interface FetchOptions {
  readonly retries?: number;
  readonly backoffMs?: number;
  readonly fetchImpl?: Fetcher;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: (message: string) => void;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function fetchEmbed(
  shortcode: string,
  options: FetchOptions = {},
): Promise<string | null> {
  const {
    retries = 3, backoffMs = 2000, fetchImpl = fetch, sleep = wait, log = () => {},
  } = options;
  const url = embedUrl(shortcode);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });
      if (response.status === 200) return await response.text();
      log(`embed ${shortcode} returned HTTP ${response.status}`);
    } catch (error) {
      log(`embed ${shortcode} failed: ${String(error)}`);
    }
    if (attempt < retries) await sleep(backoffMs * attempt);
  }
  return null;
}
