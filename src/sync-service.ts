import { format } from "date-fns";
import { AppConfig } from "./config";
import {
  LocalImage,
  LocalPass,
  PassRecord,
  RemotePass,
} from "./models/decoded-pass";
import { RaspberryStatCollection } from "./models/raspberry-stat";
import { UpcomingPassRecord } from "./models/upcoming-pass";
import { RemoteSnapshot } from "./supabase-target";
import { formatDuration } from "./utils/format-duration";

interface SyncOptions {
  dryRun: boolean;
}

interface LocalPassSource {
  getPasses(): Promise<LocalPass[]>;
  getUpcomingPasses(): UpcomingPassRecord[];
}

interface SystemStatsSource {
  collect(): Promise<RaspberryStatCollection>;
}

interface SyncTarget {
  getSnapshot(): Promise<RemoteSnapshot>;
  insertImageRows(passId: number, paths: string[]): Promise<void>;
  replaceUpcomingPasses(passes: UpcomingPassRecord[]): Promise<void>;
  syncRaspberryStats(
    record: RaspberryStatCollection["record"],
    retentionCutoff: string
  ): Promise<void>;
  uploadImage(image: LocalImage): Promise<void>;
  upsertPass(pass: PassRecord): Promise<RemotePass>;
}

interface CycleSummary {
  failed: number;
  imageRowsInserted: number;
  passesChanged: number;
  passesSkippedWithoutImages: number;
  passesUnchanged: number;
  storageUploads: number;
  raspberryStatsSaved: boolean;
  raspberryStatsSyncFailed: boolean;
  upcomingPassesSynced: number;
  upcomingSyncFailed: boolean;
}

function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    return [error.message, ...error.errors.map(describeError)].join("\n");
  }

  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === "object" && error !== null) {
    return JSON.stringify(error, null, 2);
  }

  return String(error);
}

function passRecordsEqual(left: PassRecord, right: PassRecord) {
  return (
    left.source_id === right.source_id &&
    left.azimuth_at_max === right.azimuth_at_max &&
    left.daylight_pass === right.daylight_pass &&
    left.direction === right.direction &&
    left.gain === right.gain &&
    left.has_histogram === right.has_histogram &&
    left.has_polar_az_el === right.has_polar_az_el &&
    left.has_polar_direction === right.has_polar_direction &&
    left.has_pristine === right.has_pristine &&
    left.has_spectrogram === right.has_spectrogram &&
    left.is_meteor === right.is_meteor &&
    left.is_noaa === right.is_noaa &&
    left.max_elevation === right.max_elevation &&
    left.pass_end === right.pass_end &&
    left.pass_start_azimuth === right.pass_start_azimuth &&
    left.pass_start === right.pass_start
  );
}

async function runWithConcurrency<T>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<void>
) {
  let nextIndex = 0;
  const errors: unknown[] = [];

  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const value = values[nextIndex++];
        try {
          await operation(value);
        } catch (error) {
          errors.push(error);
        }
      }
    }
  );

  await Promise.all(workers);

  if (errors.length > 0) {
    throw new AggregateError(errors, `${errors.length} upload(s) failed`);
  }
}

export class SyncService {
  private readonly config: AppConfig;
  private readonly localSource: LocalPassSource;
  private readonly statsSource: SystemStatsSource;
  private readonly target: SyncTarget;
  private lastRemoteRefresh = 0;
  private remoteSnapshot: RemoteSnapshot | undefined;

  constructor(
    config: AppConfig,
    localSource: LocalPassSource,
    target: SyncTarget,
    statsSource: SystemStatsSource
  ) {
    this.config = config;
    this.localSource = localSource;
    this.statsSource = statsSource;
    this.target = target;
  }

  private async getRemoteSnapshot() {
    const now = Date.now();
    if (
      !this.remoteSnapshot ||
      now - this.lastRemoteRefresh >= this.config.remoteRefreshMs
    ) {
      console.log("    Refreshing remote manifest...");
      this.remoteSnapshot = await this.target.getSnapshot();
      this.lastRemoteRefresh = now;
    }
    return this.remoteSnapshot;
  }

  private async syncPass(
    pass: LocalPass,
    snapshot: RemoteSnapshot,
    options: SyncOptions,
    summary: CycleSummary
  ) {
    const sourceId = pass.record.source_id;
    let remotePass = snapshot.passesBySourceId.get(sourceId);
    const remoteImagePaths =
      (remotePass && snapshot.imagePathsByPass.get(remotePass.id)) ??
      new Set<string>();
    const missingStorageImages = pass.images.filter(
      (image) => !snapshot.storagePaths.has(image.storagePath)
    );
    const missingImageRows = pass.images.filter(
      (image) => !remoteImagePaths.has(image.name)
    );
    const passNeedsUpsert =
      !remotePass || !passRecordsEqual(pass.record, remotePass);

    if (pass.images.length === 0) {
      summary.passesSkippedWithoutImages++;
      console.warn(
        `    Source pass ${sourceId}: skipped because no local images exist`
      );
      return;
    }

    if (
      !passNeedsUpsert &&
      missingStorageImages.length === 0 &&
      missingImageRows.length === 0
    ) {
      summary.passesUnchanged++;
      return;
    }

    console.log(
      `    Source pass ${sourceId}: ${missingStorageImages.length} storage upload(s), ${
        passNeedsUpsert ? 1 : 0
      } pass upsert(s), ${missingImageRows.length} image row(s)`
    );

    if (options.dryRun) {
      summary.storageUploads += missingStorageImages.length;
      summary.imageRowsInserted += missingImageRows.length;
      summary.passesChanged++;
      return;
    }

    await runWithConcurrency<LocalImage>(
      missingStorageImages,
      this.config.uploadConcurrency,
      async (image) => {
        await this.target.uploadImage(image);
        snapshot.storagePaths.add(image.storagePath);
        summary.storageUploads++;
        console.log(`      Uploaded ${image.name}`);
      }
    );

    if (passNeedsUpsert) {
      remotePass = await this.target.upsertPass(pass.record);
      snapshot.passesBySourceId.set(sourceId, remotePass);
    }

    if (!remotePass) {
      throw new Error(`Source pass ${sourceId} has no Supabase ID after upsert`);
    }

    if (missingImageRows.length > 0) {
      await this.target.insertImageRows(
        remotePass.id,
        missingImageRows.map((image) => image.name)
      );
      const imagePaths =
        snapshot.imagePathsByPass.get(remotePass.id) ?? new Set<string>();
      for (const image of missingImageRows) {
        imagePaths.add(image.name);
      }
      snapshot.imagePathsByPass.set(remotePass.id, imagePaths);
      summary.imageRowsInserted += missingImageRows.length;
    }

    summary.passesChanged++;
  }

  async runCycle(options: SyncOptions) {
    const startedAt = Date.now();
    const mode = options.dryRun ? " (dry run)" : "";
    console.log(`${format(new Date(), "HH:mm:ss")}: Syncing${mode}...`);

    const [passes, upcomingPasses, snapshot, stats] = await Promise.all([
      this.localSource.getPasses(),
      this.localSource.getUpcomingPasses(),
      this.getRemoteSnapshot(),
      this.statsSource.collect(),
    ]);
    const summary: CycleSummary = {
      failed: 0,
      imageRowsInserted: 0,
      passesChanged: 0,
      passesSkippedWithoutImages: 0,
      passesUnchanged: 0,
      storageUploads: 0,
      raspberryStatsSaved: false,
      raspberryStatsSyncFailed: false,
      upcomingPassesSynced: 0,
      upcomingSyncFailed: false,
    };

    for (const pass of passes) {
      try {
        await this.syncPass(pass, snapshot, options, summary);
      } catch (error) {
        summary.failed++;
        this.lastRemoteRefresh = 0;
        console.error(
          `    Source pass ${pass.record.source_id}: sync failed\n${describeError(
            error
          )}`
        );
      }
    }

    if (options.dryRun) {
      summary.upcomingPassesSynced = upcomingPasses.length;
    } else {
      try {
        await this.target.replaceUpcomingPasses(upcomingPasses);
        summary.upcomingPassesSynced = upcomingPasses.length;
      } catch (error) {
        summary.upcomingSyncFailed = true;
        console.error(
          `    Upcoming passes: sync failed\n${describeError(error)}`
        );
      }
    }

    for (const error of stats.errors) {
      console.warn(`    Raspberry stats: ${error}`);
    }

    if (options.dryRun) {
      summary.raspberryStatsSaved = stats.record !== null;
    } else {
      try {
        await this.target.syncRaspberryStats(
          stats.record,
          new Date(Date.now() - this.config.statsRetentionMs).toISOString()
        );
        summary.raspberryStatsSaved = stats.record !== null;
      } catch (error) {
        summary.raspberryStatsSyncFailed = true;
        console.error(
          `    Raspberry stats: sync failed\n${describeError(error)}`
        );
      }
    }

    const changedLabel = options.dryRun ? "would change" : "changed";
    const uploadedLabel = options.dryRun ? "would upload" : "uploaded";
    const insertedLabel = options.dryRun ? "would insert" : "inserted";
    console.log(
      `${format(new Date(), "HH:mm:ss")}: Completed in ${formatDuration(
        Date.now() - startedAt
      )}. ${summary.passesChanged} ${changedLabel}, ${
        summary.passesUnchanged
      } unchanged, ${summary.passesSkippedWithoutImages} without images, ${
        summary.failed
      } failed, ${summary.storageUploads} ${uploadedLabel}, ${
        summary.imageRowsInserted
      } image row(s) ${insertedLabel}, ${
        summary.upcomingPassesSynced
      } upcoming pass(es) ${options.dryRun ? "would sync" : "synced"}${
        summary.upcomingSyncFailed ? ", upcoming sync failed" : ""
      }, Raspberry stats ${
        summary.raspberryStatsSaved
          ? options.dryRun
            ? "would save"
            : "saved"
          : "not saved"
      }${summary.raspberryStatsSyncFailed ? ", stats sync failed" : ""}.`
    );

    return summary;
  }
}
