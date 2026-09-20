import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "./main.ts";

test("missing configuration exits with a clear message", async () => {
  const original = console.error;
  const lines: string[] = [];
  console.error = (message: unknown): void => { lines.push(String(message)); };
  try {
    assert.equal(await main({}), 2);
  } finally {
    console.error = original;
  }
  assert.ok(lines.some((line) => line.includes("OMNIVORE_API_URL")));
});
