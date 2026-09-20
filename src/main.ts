import { fromEnv } from "./config.ts";
import { runCycle } from "./cycle.ts";
import { OmnivoreClient } from "./omnivore.ts";

const stamp = (): string => new Date().toISOString();
const log = (message: string): void => console.log(`${stamp()} INFO  ${message}`);
const errorLog = (message: string): void => console.error(`${stamp()} ERROR ${message}`);
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let config;
  try {
    config = fromEnv(env);
  } catch (error) {
    console.error(`configuration error: ${error instanceof Error ? error.message : error}`);
    return 2;
  }

  log(`starting; interval=${config.scanInterval}s max_per_cycle=${config.maxPerCycle} ` +
      `dry_run=${config.dryRun}`);
  const library = new OmnivoreClient(config.apiUrl, config.apiKey);

  for (;;) {
    try {
      await runCycle(library, config, { log, errorLog });
    } catch (error) {
      // A bad cycle must never kill the container: the next one may well
      // succeed, and nothing is written from a failed pass.
      errorLog(`cycle failed: ${error instanceof Error ? error.stack : String(error)}`);
    }
    await wait(config.scanInterval * 1000);
  }
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = await main();
}
