import { addMilliseconds, format } from "date-fns";
import { loadConfig, validateLocalPaths } from "./config";
import { LocalSource } from "./local-source";
import { SupabaseTarget } from "./supabase-target";
import { SyncService } from "./sync-service";
import { sleep } from "./utils/sleep";

function describeError(error: unknown) {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

function readOptions(args: string[]) {
  const supportedOptions = new Set(["--dry-run", "--once"]);
  const unknownOption = args.find((arg) => !supportedOptions.has(arg));
  if (unknownOption) {
    throw new Error(`Unknown option: ${unknownOption}`);
  }

  return {
    dryRun: args.includes("--dry-run"),
    once: args.includes("--once"),
  };
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  const config = loadConfig();
  validateLocalPaths(config);

  const abortController = new AbortController();
  const stop = () => abortController.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const localSource = new LocalSource(config);
  const target = new SupabaseTarget(config);
  const syncService = new SyncService(config, localSource, target);

  console.log(`${format(new Date(), "HH:mm:ss")}: Starting sync service...`);

  try {
    while (!abortController.signal.aborted) {
      try {
        await syncService.runCycle({ dryRun: options.dryRun });
      } catch (error) {
        console.error(`Sync cycle failed\n${describeError(error)}`);
      }

      if (options.once || abortController.signal.aborted) {
        break;
      }

      console.log(
        `Next sync at ${format(
          addMilliseconds(new Date(), config.syncIntervalMs),
          "HH:mm"
        )}.\n`
      );
      await sleep(config.syncIntervalMs, abortController.signal);
    }
  } finally {
    localSource.close();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

main().catch((error) => {
  console.error(describeError(error));
  process.exitCode = 1;
});
