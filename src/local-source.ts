import Database from "better-sqlite3";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { AppConfig } from "./config";
import {
  DecodedPass,
  LocalImage,
  LocalPass,
  PassRecord,
} from "./models/decoded-pass";
import { decodedPassesQuery } from "./queries/decoded-passes";

const CONTENT_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".webp": "image/webp",
};

function toPassRecord(pass: DecodedPass): PassRecord {
  return {
    source_id: pass.id,
    azimuth_at_max: pass.azimuth_at_max,
    daylight_pass: Boolean(pass.daylight_pass),
    direction: pass.direction,
    gain: pass.gain,
    has_histogram: Boolean(pass.has_histogram),
    has_polar_az_el: Boolean(pass.has_polar_az_el),
    has_polar_direction: Boolean(pass.has_polar_direction),
    has_pristine: Boolean(pass.has_pristine),
    has_spectrogram: Boolean(pass.has_spectrogram),
    is_meteor: pass.sat_type === 0,
    is_noaa: pass.sat_type === 1,
    max_elevation: pass.max_elev,
    pass_end: new Date(pass.pass_end * 1_000).toISOString(),
    pass_start_azimuth: pass.pass_start_azimuth,
    pass_start: new Date(pass.pass_start * 1_000).toISOString(),
  };
}

function getContentType(fileName: string) {
  return (
    CONTENT_TYPES[extname(fileName).toLowerCase()] ?? "application/octet-stream"
  );
}

export class LocalSource {
  private readonly config: AppConfig;
  private readonly database: Database.Database;
  private readonly passesStatement: Database.Statement<[], DecodedPass>;

  constructor(config: AppConfig) {
    this.config = config;
    this.database = new Database(config.dbPath, {
      fileMustExist: true,
      readonly: true,
    });
    this.passesStatement = this.database.prepare<[], DecodedPass>(
      decodedPassesQuery
    );
  }

  async getPasses(): Promise<LocalPass[]> {
    const entries = await readdir(this.config.imageDir, {
      withFileTypes: true,
    });
    const imageNames = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();

    return this.passesStatement.all().map((pass) => {
      const images: LocalImage[] = imageNames
        .filter(
          (name) =>
            name === pass.file_path || name.startsWith(`${pass.file_path}-`)
        )
        .map((name) => ({
          contentType: getContentType(name),
          filePath: join(this.config.imageDir, name),
          name,
          storagePath: `${this.config.storagePrefix}/${name}`,
        }));

      return {
        images,
        record: toPassRecord(pass),
      };
    });
  }

  close() {
    this.database.close();
  }
}
