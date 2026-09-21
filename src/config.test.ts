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
  assert.ok(!config.genericTitlePattern.test("Instagram is down"));
});

test("whitespace-only falls back to the default, never to zero", () => {
  // "   " does not equal "", so it slipped past the empty check and
  // Number("   ") is 0 - the same silent no-op the guard exists to stop.
  assert.equal(fromEnv({ ...MINIMAL, MAX_PER_CYCLE: "   " }).maxPerCycle, 20);
});

test("out-of-range values are refused, not just non-numeric ones", () => {
  // Measured: maxPerCycle 0 processes nothing; -5 makes slice(0,-5) drop the
  // LAST five candidates; a ratio above 1 means the breaker never trips.
  for (const [name, value] of [["MAX_PER_CYCLE", "0"], ["MAX_PER_CYCLE", "-5"],
                               ["MAX_PER_CYCLE", "20.7"], ["FETCH_RETRIES", "0"],
                               ["UNKNOWN_RATIO_LIMIT", "2"], ["UNKNOWN_RATIO_LIMIT", "-1"]] as const) {
    assert.throws(() => fromEnv({ ...MINIMAL, [name]: value }),
      new RegExp(name), `${name}=${value} must be refused`);
  }
});

test("a non-numeric value is refused at startup, never silently NaN", () => {
  // NaN here fails silently rather than loudly: slice(0, NaN) yields nothing,
  // so the tool would process zero items forever, and "ratio > NaN" is always
  // false, so the circuit breaker would never trip.
  for (const name of ["MAX_PER_CYCLE", "FETCH_RETRIES", "TITLE_MAX_CHARS",
                      "UNKNOWN_RATIO_LIMIT", "MIN_SAMPLE_FOR_BREAKER"]) {
    assert.throws(() => fromEnv({ ...MINIMAL, [name]: "abc" }),
      new RegExp(name), `${name} must be refused`);
  }
});

test("an invalid regex names the variable it came from", () => {
  assert.throws(() => fromEnv({ ...MINIMAL, GENERIC_TITLE_PATTERN: "[" }),
    /GENERIC_TITLE_PATTERN/);
});

test("missing required values throw with a useful message", () => {
  assert.throws(() => fromEnv({ OMNIVORE_API_KEY: "k" }), /OMNIVORE_API_URL/);
  assert.throws(() => fromEnv({ OMNIVORE_API_URL: MINIMAL.OMNIVORE_API_URL }), /OMNIVORE_API_KEY/);
});

for (const [value, seconds] of [["90s", 90], ["15m", 900], ["2h", 7200], ["600", 600]] as const) {
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

test("SCAN_INTERVAL is bounded, not just parseable", () => {
  // The floor is what makes the README's "being a good citizen" section true:
  // below a minute this stops being a periodic janitor and becomes load on
  // both Omnivore and Instagram. The ceiling keeps the value inside what
  // setTimeout can represent -- a huge one wraps and fires immediately.
  for (const bad of ["0", "0s", "1s", "59s", "25h", "2000000h"]) {
    assert.throws(() => fromEnv({ ...MINIMAL, SCAN_INTERVAL: bad }),
      /SCAN_INTERVAL/, `SCAN_INTERVAL=${bad} must be refused`);
  }
  assert.equal(fromEnv({ ...MINIMAL, SCAN_INTERVAL: "60s" }).scanInterval, 60);
  assert.equal(fromEnv({ ...MINIMAL, SCAN_INTERVAL: "24h" }).scanInterval, 86400);
});

test("an unrecognised boolean is refused, never read as false", () => {
  // DRY_RUN is the one setting whose purpose is "do not touch my library
  // yet". Reading a typo as false would turn the safety switch into a write.
  for (const bad of ["ture", "y", "sim", "verdadeiro", "2", "nao"]) {
    assert.throws(() => fromEnv({ ...MINIMAL, DRY_RUN: bad }), /DRY_RUN/,
      `DRY_RUN=${bad} must be refused`);
  }
  assert.equal(fromEnv({ ...MINIMAL, DRY_RUN: "false" }).dryRun, false);
  assert.equal(fromEnv({ ...MINIMAL, DRY_RUN: "OFF" }).dryRun, false);
  assert.equal(fromEnv({ ...MINIMAL, DRY_RUN: "yes" }).dryRun, true);
});

test("the endpoint must be an absolute http or https URL", () => {
  // "api:8080/api/graphql" is the compose example with the scheme dropped.
  // Accepting it only defers the failure to an opaque TypeError, once per
  // cycle, forever.
  for (const bad of ["api:8080/api/graphql", "not a url", "ftp://host/path", "/api/graphql"]) {
    assert.throws(() => fromEnv({ ...MINIMAL, OMNIVORE_API_URL: bad }), /OMNIVORE_API_URL/,
      `${bad} must be refused`);
  }
  assert.equal(fromEnv({ ...MINIMAL, OMNIVORE_API_URL: "http://api:8080/api/graphql" }).apiUrl,
    "http://api:8080/api/graphql");
});

test("a blank give-up label is refused", () => {
  assert.throws(() => fromEnv({ ...MINIMAL, GIVE_UP_LABEL: "   " }), /GIVE_UP_LABEL/);
  assert.equal(fromEnv({ ...MINIMAL, GIVE_UP_LABEL: " keep " }).giveUpLabel, "keep");
});

test("MAX_PER_CYCLE has a ceiling", () => {
  assert.throws(() => fromEnv({ ...MINIMAL, MAX_PER_CYCLE: "1e9" }), /MAX_PER_CYCLE/);
  assert.equal(fromEnv({ ...MINIMAL, MAX_PER_CYCLE: "1000" }).maxPerCycle, 1000);
});

test("an unparseable duration names the variable", () => {
  assert.throws(() => fromEnv({ ...MINIMAL, SCAN_INTERVAL: "15M" }), /SCAN_INTERVAL/);
});
