export type Fetcher = typeof fetch;

const SHORTCODE = /\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/;
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);

export const REQUEST_TIMEOUT_MS = 20_000;
const BACKOFF_STEP_MS = 2_000;

// The embed endpoint refuses a real browser User-Agent and answers a login
// wall instead, so this cannot be "whatever a browser sends". It identifies
// the tool honestly rather than impersonating a search crawler: verified to
// work exactly as well as the Googlebot string it replaced.
const USER_AGENT =
  "instagram-titles/0.1.0 (+https://github.com/rcarvalhoxavier/instagram-titles)";

// A response far larger than a real embed page is either not an embed page or
// not worth parsing; the regexes are linear on real input but not on every
// possible input, so the ceiling bounds the work.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

// Retrying these never helps: the answer will not change on the next attempt.
const TERMINAL_STATUSES = new Set([400, 401, 403, 404, 410]);

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
  /** Total attempts, not retries after the first. config.ts owns the default. */
  readonly retries: number;
  readonly backoffMs?: number;
  readonly fetchImpl?: Fetcher;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: (message: string) => void;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function fetchEmbed(
  shortcode: string,
  options: FetchOptions,
): Promise<string | null> {
  const {
    retries, backoffMs = BACKOFF_STEP_MS, fetchImpl = fetch, sleep = wait, log = () => {},
  } = options;
  const url = embedUrl(shortcode);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Without an explicit signal a hanging peer falls back to undici's 300s
      // default, so one stuck host could stretch a cycle into hours.
      const response = await fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 200) {
        const body = await response.text();
        if (body.length > MAX_BODY_BYTES) {
          log(`embed ${shortcode} returned ${body.length} bytes; refusing to parse it`);
          return null;
        }
        return body;
      }
      if (TERMINAL_STATUSES.has(response.status)) {
        log(`embed ${shortcode} returned HTTP ${response.status}; not retrying`);
        return null;
      }
      log(`embed ${shortcode} returned HTTP ${response.status}`);
      if (response.status === 429) {
        // Honour the server telling us how long to wait, capped so a hostile
        // or mistaken header cannot park the cycle indefinitely.
        const after = Number(response.headers.get("retry-after"));
        if (Number.isFinite(after) && after > 0) {
          await sleep(Math.min(after, 60) * 1000);
          continue;
        }
      }
    } catch (error) {
      log(`embed ${shortcode} failed: ${String(error)}`);
    }
    if (attempt < retries) await sleep(backoffMs * attempt);
  }
  return null;
}
