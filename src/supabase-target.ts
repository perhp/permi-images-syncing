import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AppConfig } from "./config";
import { LocalImage, PassRecord, RemotePass } from "./models/decoded-pass";
import { UpcomingPassRecord } from "./models/upcoming-pass";
import { sleep } from "./utils/sleep";

const TABLE_PAGE_SIZE = 1_000;
const STORAGE_PAGE_SIZE = 100;

interface RemoteImageRow {
  fk_passes_id: number;
  path: string;
}

export interface RemoteSnapshot {
  imagePathsByPass: Map<number, Set<string>>;
  passesBySourceId: Map<number, RemotePass>;
  storagePaths: Set<string>;
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    return JSON.stringify(error);
  }

  return String(error);
}

function normalizePass(pass: RemotePass): RemotePass {
  return {
    ...pass,
    id: Number(pass.id),
    source_id: Number(pass.source_id),
    azimuth_at_max: Number(pass.azimuth_at_max),
    gain: Number(pass.gain),
    max_elevation: Number(pass.max_elevation),
    pass_end: new Date(pass.pass_end).toISOString(),
    pass_start_azimuth: Number(pass.pass_start_azimuth),
    pass_start: new Date(pass.pass_start).toISOString(),
  };
}

export class SupabaseTarget {
  private readonly client: SupabaseClient;
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
  }

  private async execute<T>(
    label: string,
    operation: () => Promise<{ data: T | null; error: unknown }>
  ): Promise<T | null> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const { data, error } = await operation();
        if (error) {
          throw error;
        }
        return data;
      } catch (error) {
        lastError = error;
        if (attempt < this.config.retryAttempts) {
          await sleep(this.config.retryBaseDelayMs * 2 ** (attempt - 1));
        }
      }
    }

    throw new Error(`${label} failed: ${describeError(lastError)}`);
  }

  private async getPasses() {
    const passes: RemotePass[] = [];

    for (let offset = 0; ; offset += TABLE_PAGE_SIZE) {
      const data = await this.execute<RemotePass[]>(
        "Fetching remote passes",
        async () =>
          this.client
            .from("passes")
            .select(
              "id,source_id,azimuth_at_max,daylight_pass,direction,gain,has_histogram,has_polar_az_el,has_polar_direction,has_pristine,has_spectrogram,is_meteor,is_noaa,max_elevation,pass_end,pass_start_azimuth,pass_start"
            )
            .order("id", { ascending: true })
            .range(offset, offset + TABLE_PAGE_SIZE - 1)
      );
      const page = data ?? [];
      passes.push(...page.map(normalizePass));
      if (page.length < TABLE_PAGE_SIZE) {
        break;
      }
    }

    return passes;
  }

  private async getImageRows() {
    const images: RemoteImageRow[] = [];

    for (let offset = 0; ; offset += TABLE_PAGE_SIZE) {
      const data = await this.execute<RemoteImageRow[]>(
        "Fetching remote image rows",
        async () =>
          this.client
            .from("passes_images")
            .select("fk_passes_id,path")
            .order("id", { ascending: true })
            .range(offset, offset + TABLE_PAGE_SIZE - 1)
      );
      const page = data ?? [];
      images.push(
        ...page.map((image) => ({
          fk_passes_id: Number(image.fk_passes_id),
          path: image.path,
        }))
      );
      if (page.length < TABLE_PAGE_SIZE) {
        break;
      }
    }

    return images;
  }

  private async getStoragePaths() {
    const paths = new Set<string>();

    for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
      const data = await this.execute<
        { id: string | null; name: string }[]
      >("Fetching storage objects", async () =>
        this.client.storage.from(this.config.storageBucket).list(
          this.config.storagePrefix,
          {
            limit: STORAGE_PAGE_SIZE,
            offset,
            sortBy: { column: "name", order: "asc" },
          }
        )
      );
      const page = data ?? [];
      for (const item of page) {
        if (item.id !== null) {
          paths.add(`${this.config.storagePrefix}/${item.name}`);
        }
      }
      if (page.length < STORAGE_PAGE_SIZE) {
        break;
      }
    }

    return paths;
  }

  async getSnapshot(): Promise<RemoteSnapshot> {
    const [passes, imageRows, storagePaths] = await Promise.all([
      this.getPasses(),
      this.getImageRows(),
      this.getStoragePaths(),
    ]);
    const imagePathsByPass = new Map<number, Set<string>>();

    for (const image of imageRows) {
      const paths = imagePathsByPass.get(image.fk_passes_id) ?? new Set<string>();
      paths.add(image.path);
      imagePathsByPass.set(image.fk_passes_id, paths);
    }

    return {
      imagePathsByPass,
      passesBySourceId: new Map(passes.map((pass) => [pass.source_id, pass])),
      storagePaths,
    };
  }

  async uploadImage(image: LocalImage) {
    const contents = await readFile(image.filePath);
    await this.execute(`Uploading ${image.name}`, async () =>
      this.client.storage
        .from(this.config.storageBucket)
        .upload(image.storagePath, contents, {
          cacheControl: "31536000",
          contentType: image.contentType,
          upsert: true,
        })
    );
  }

  async upsertPass(pass: PassRecord): Promise<RemotePass> {
    const savedPass = await this.execute<RemotePass>(
      `Upserting source pass ${pass.source_id}`,
      async () =>
        this.client
          .from("passes")
          .upsert(pass, { onConflict: "source_id" })
          .select(
            "id,source_id,azimuth_at_max,daylight_pass,direction,gain,has_histogram,has_polar_az_el,has_polar_direction,has_pristine,has_spectrogram,is_meteor,is_noaa,max_elevation,pass_end,pass_start_azimuth,pass_start"
          )
          .single()
    );

    if (!savedPass) {
      throw new Error(`Upserting source pass ${pass.source_id} returned no row`);
    }

    return normalizePass(savedPass);
  }

  async replaceUpcomingPasses(passes: UpcomingPassRecord[]) {
    const syncBatch = randomUUID();

    if (passes.length > 0) {
      await this.execute("Upserting upcoming passes", async () =>
        this.client.from("upcoming_passes").upsert(
          passes.map((pass) => ({
            ...pass,
            sync_batch: syncBatch,
          })),
          { onConflict: "satellite_name,pass_start" }
        )
      );
    }

    await this.execute("Removing stale upcoming passes", async () => {
      const query = this.client.from("upcoming_passes").delete();

      if (passes.length > 0) {
        return query.neq("sync_batch", syncBatch);
      }

      return query.gte("pass_start", "1970-01-01T00:00:00.000Z");
    });
  }

  async insertImageRows(passId: number, paths: string[]) {
    if (paths.length === 0) {
      return;
    }

    await this.execute(`Inserting image rows for pass ${passId}`, async () =>
      this.client.from("passes_images").insert(
        paths.map((path) => ({
          fk_passes_id: passId,
          path,
        }))
      )
    );
  }
}
