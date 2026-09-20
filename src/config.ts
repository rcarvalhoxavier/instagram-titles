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

export function parseDuration(raw: string): number {
  const match = DURATION.exec(raw.trim());
  if (match === null) throw new Error(`cannot parse duration "${raw}"; use forms like 30s, 15m, 2h`);
  return Number(match[1]) * (MULTIPLIER[match[2] ?? ""] ?? 1);
}

function flag(env: Env, name: string): boolean {
  const raw = env[name];
  return raw === undefined || raw === "" ? false : TRUTHY.has(raw.trim().toLowerCase());
}

function number(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  return raw === undefined || raw === "" ? fallback : Number(raw);
}

export function fromEnv(env: Env): Config {
  return {
    apiUrl: required(env, "OMNIVORE_API_URL"),
    apiKey: required(env, "OMNIVORE_API_KEY"),
    scanInterval: parseDuration(env["SCAN_INTERVAL"] || "15m"),
    maxPerCycle: number(env, "MAX_PER_CYCLE", 20),
    fetchRetries: number(env, "FETCH_RETRIES", 3),
    titleMaxChars: number(env, "TITLE_MAX_CHARS", 120),
    genericTitlePattern: new RegExp(env["GENERIC_TITLE_PATTERN"] || "^Instagram$"),
    giveUpLabel: env["GIVE_UP_LABEL"] || "instagram-unavailable",
    unknownRatioLimit: number(env, "UNKNOWN_RATIO_LIMIT", 0.5),
    minSampleForBreaker: number(env, "MIN_SAMPLE_FOR_BREAKER", 5),
    retryLabeled: flag(env, "RETRY_LABELED"),
    dryRun: flag(env, "DRY_RUN"),
  };
}
