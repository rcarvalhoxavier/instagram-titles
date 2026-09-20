import { test } from "node:test";
import assert from "node:assert/strict";
import { fromEnv } from "./config.ts";

const MINIMAL = { OMNIVORE_API_URL: "https://keep.example/api/graphql", OMNIVORE_API_KEY: "k" };

test("defaults match the spec", () => {
  const config = fromEnv(MINIMAL);
  assert.equal(config.scanInterval, 900);
  assert.equal(config.maxPerCycle, 20);
  assert.equal(config.fetchRetries, 3);
  assert.equal(config.titleMaxChars, 120);
  assert.equal(config.giveUpLabel, "instagram-unavailable");
  assert.equal(config.unknownRatioLimit, 0.5);
  assert.equal(config.minSampleForBreaker, 5);
  assert.equal(config.retryLabeled, false);
  assert.equal(config.dryRun, false);
  assert.ok(config.genericTitlePattern.test("Instagram"));
});

test("missing required values throw with a useful message", () => {
  assert.throws(() => fromEnv({ OMNIVORE_API_KEY: "k" }), /OMNIVORE_API_URL/);
  assert.throws(() => fromEnv({ OMNIVORE_API_URL: "x" }), /OMNIVORE_API_KEY/);
});

for (const [value, seconds] of [["30s", 30], ["15m", 900], ["2h", 7200], ["600", 600]] as const) {
  test(`duration ${value}`, () => {
    assert.equal(fromEnv({ ...MINIMAL, SCAN_INTERVAL: value }).scanInterval, seconds);
  });
}

for (const [value, expected] of [["true", true], ["1", true], ["false", false], ["", false]] as const) {
  test(`boolean ${JSON.stringify(value)}`, () => {
    assert.equal(fromEnv({ ...MINIMAL, DRY_RUN: value }).dryRun, expected);
  });
}

test("generic title pattern is compiled", () => {
  const { genericTitlePattern } = fromEnv({ ...MINIMAL, GENERIC_TITLE_PATTERN: "^Instagram$" });
  assert.ok(genericTitlePattern.test("Instagram"));
  assert.ok(!genericTitlePattern.test("Instagram is down"));
});

test("numeric env vars with invalid values throw with the variable name", () => {
  assert.throws(() => fromEnv({ ...MINIMAL, MAX_PER_CYCLE: "abc" }), /MAX_PER_CYCLE/);
  assert.throws(() => fromEnv({ ...MINIMAL, UNKNOWN_RATIO_LIMIT: "meio" }), /UNKNOWN_RATIO_LIMIT/);
});

test("invalid regex patterns throw with the variable name", () => {
  assert.throws(() => fromEnv({ ...MINIMAL, GENERIC_TITLE_PATTERN: "[" }), /GENERIC_TITLE_PATTERN/);
});
