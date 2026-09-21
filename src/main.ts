import { fromEnv } from "./config.ts";
import { runCycle } from "./cycle.ts";
import { OmnivoreClient } from "./omnivore.ts";

const stamp = (): string => new Date().toISOString();
const log = (message: string): void => console.log(`${stamp()} INFO  ${message}`);
const errorLog = (message: string): void => console.error(`${stamp()} ERROR ${message}`);
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// A rejected promise outside the cycle's own try/catch would otherwise end
// the process without a word about why.
process.on("unhandledRejection", (reason) => {
  errorLog(`unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
});

// Without these, a container stopped by an orchestrator waits out the full
// timeout and is then killed. The reason is specific and worth stating,
// because the obvious explanations are both wrong: Node does install a
// SIGTERM handler, and the pending timer is not what keeps the process
// alive. With no JS listener, Node's handler restores the default
// disposition and re-raises the signal at itself -- and *that* is what the
// kernel discards for PID 1, which never receives a default-disposition
// signal. Registering a listener means the re-raise never happens.
// Measured on this image: 11s to stop without these lines, 1s with them.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log(`received ${signal}; stopping`);
    process.exit(0);
  });
}

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
    let extraWait = 0;
    try {
      const stats = await runCycle(library, config, { log, errorLog });
      extraWait = stats.backoffSeconds;
    } catch (error) {
      // A bad cycle must never kill the container: the next one may well
      // succeed, and nothing is written from a failed pass.
      errorLog(`cycle failed: ${error instanceof Error ? error.stack : String(error)}`);
    }
    await wait((config.scanInterval + extraWait) * 1000);
  }
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = await main();
}
