const DURATION = /^(\d+)([smh]?)$/;
const MULTIPLIER: Readonly<Record<string, number>> = { "": 1, s: 1, m: 60, h: 3600 };
const TRUTHY = new Set(["1", "true", "yes", "on"]);

export interface Config {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly scanInterval: number;
  readonly maxPerCycle: number;
  readonly fetchRetries: number;
  readonly titleMaxChars: number;
  readonly genericTitlePattern: RegExp;
  readonly giveUpLabel: string;
  readonly unknownRatioLimit: number;
  readonly minSampleForBreaker: number;
  readonly retryLabeled: boolean;
  readonly dryRun: boolean;
}

export type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required and was not set`);
  return value;
}

// A floor of a minute is not arbitrary: below it the tool stops being a
// periodic janitor and becomes a source of load on both Omnivore and
// Instagram, which is exactly what the README promises it is not. The ceiling
// keeps the value inside what setTimeout can actually represent.
const MIN_INTERVAL_SECONDS = 60;
const MAX_INTERVAL_SECONDS = 24 * 60 * 60;

export function parseDuration(raw: string): number {
  const match = DURATION.exec(raw.trim());
  if (match === null) throw new Error(`cannot parse duration "${raw}"; use forms like 30s, 15m, 2h`);
  const seconds = Number(match[1]) * (MULTIPLIER[match[2] ?? ""] ?? 1);
  if (seconds < MIN_INTERVAL_SECONDS) {
    throw new Error(`SCAN_INTERVAL must be at least ${MIN_INTERVAL_SECONDS}s, got "${raw}"`);
  }
  if (seconds > MAX_INTERVAL_SECONDS) {
    throw new Error(`SCAN_INTERVAL must be at most 24h, got "${raw}"`);
  }
  return seconds;
}

function flag(env: Env, name: string): boolean {
  const raw = env[name];
  return raw === undefined || raw === "" ? false : TRUTHY.has(raw.trim().toLowerCase());
}

interface Bounds {
  readonly min: number;
  readonly max?: number;
  readonly integer?: boolean;
}

// Every numeric setting here is a count or a ratio, so "is it a number" is not
// enough: the value also has to be in a range that means something downstream.
// Measured consequences of accepting an out-of-range value, all silent:
//   maxPerCycle = 0    -> slice(0, 0) processes nothing, forever
//   maxPerCycle = -5   -> slice(0, -5) drops the LAST five candidates
//   unknownRatioLimit  -> above 1 the circuit breaker never trips; below 0 it
//                         always trips. Either way the safety net is gone.
// Refusing to start is better than any of those.
function number(env: Env, name: string, fallback: number, bounds: Bounds): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number, got "${raw}"`);
  }
  if (bounds.integer === true && !Number.isInteger(value)) {
    throw new Error(`${name} must be a whole number, got "${raw}"`);
  }
  if (value < bounds.min) {
    throw new Error(`${name} must be at least ${bounds.min}, got "${raw}"`);
  }
  if (bounds.max !== undefined && value > bounds.max) {
    throw new Error(`${name} must be at most ${bounds.max}, got "${raw}"`);
  }
  return value;
}

function pattern(env: Env, name: string, fallback: string): RegExp {
  const raw = env[name] || fallback;
  try {
    return new RegExp(raw);
  } catch {
    throw new Error(`${name} is not a valid regular expression: ${raw}`);
  }
}

export function fromEnv(env: Env): Config {
  return {
    apiUrl: required(env, "OMNIVORE_API_URL"),
    apiKey: required(env, "OMNIVORE_API_KEY"),
    scanInterval: parseDuration(env["SCAN_INTERVAL"] || "15m"),
    maxPerCycle: number(env, "MAX_PER_CYCLE", 20, { min: 1, integer: true }),
    fetchRetries: number(env, "FETCH_RETRIES", 3, { min: 1, integer: true }),
    titleMaxChars: number(env, "TITLE_MAX_CHARS", 120, { min: 1, integer: true }),
    genericTitlePattern: pattern(env, "GENERIC_TITLE_PATTERN", "^Instagram$"),
    giveUpLabel: env["GIVE_UP_LABEL"] || "instagram-unavailable",
    unknownRatioLimit: number(env, "UNKNOWN_RATIO_LIMIT", 0.5, { min: 0, max: 1 }),
    minSampleForBreaker: number(env, "MIN_SAMPLE_FOR_BREAKER", 5, { min: 1, integer: true }),
    retryLabeled: flag(env, "RETRY_LABELED"),
    dryRun: flag(env, "DRY_RUN"),
  };
}
