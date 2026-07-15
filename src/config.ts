import dotenv from "dotenv";
import { existsSync, statSync } from "node:fs";

dotenv.config({ quiet: true });

const DEFAULT_SUPABASE_URL = "https://htyouocguzgigopxxidt.supabase.co";

export interface AppConfig {
  dbPath: string;
  imageDir: string;
  remoteRefreshMs: number;
  retryAttempts: number;
  retryBaseDelayMs: number;
  storageBucket: string;
  storagePrefix: string;
  statsDiskMount: string;
  statsRetentionMs: number;
  supabaseKey: string;
  supabaseUrl: string;
  syncIntervalMs: number;
  uploadConcurrency: number;
}

function validateSupabaseKey(key: string) {
  if (key.startsWith("sb_secret_")) {
    return;
  }

  if (key.startsWith("sb_")) {
    throw new Error("Supabase synchronization requires an sb_secret_ key");
  }

  try {
    const payload = JSON.parse(
      Buffer.from(key.split(".")[1], "base64url").toString("utf8")
    ) as { role?: string };
    if (payload.role === "service_role") {
      return;
    }
  } catch {
    throw new Error("Supabase key is not a valid secret or service_role key");
  }

  throw new Error("Supabase synchronization requires a service_role key");
}

function readPositiveNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number
) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function readPositiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number
) {
  const value = readPositiveNumber(env, name, fallback);
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const supabaseKey =
    env.SUPABASE_SECRET_KEY?.trim() ?? env.SUPABASE_SERVICE_KEY?.trim();

  if (!supabaseKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY is required (SUPABASE_SERVICE_KEY is supported for legacy configurations)"
    );
  }

  validateSupabaseKey(supabaseKey);

  const supabaseUrl = (env.SUPABASE_URL ?? DEFAULT_SUPABASE_URL).trim();
  try {
    const parsedUrl = new URL(supabaseUrl);
    if (parsedUrl.protocol !== "https:") {
      throw new Error();
    }
  } catch {
    throw new Error("SUPABASE_URL must be a valid HTTPS URL");
  }

  const storagePrefix = (env.SUPABASE_STORAGE_PREFIX ?? "images")
    .replace(/^\/+|\/+$/g, "")
    .trim();

  if (!storagePrefix) {
    throw new Error("SUPABASE_STORAGE_PREFIX cannot be empty");
  }

  const storageBucket = (env.SUPABASE_STORAGE_BUCKET ?? "passes").trim();
  if (!storageBucket) {
    throw new Error("SUPABASE_STORAGE_BUCKET cannot be empty");
  }

  const statsDiskMount = (env.RASPBERRY_STATS_DISK_MOUNT ?? "/").trim();
  if (!statsDiskMount) {
    throw new Error("RASPBERRY_STATS_DISK_MOUNT cannot be empty");
  }

  return {
    dbPath:
      env.SQLITE_DB_PATH ?? "/home/pi/raspberry-noaa-v2/db/panel.db",
    imageDir: env.IMAGE_DIR ?? "/srv/images",
    remoteRefreshMs:
      readPositiveNumber(env, "REMOTE_REFRESH_MINUTES", 60) * 60_000,
    retryAttempts: readPositiveInteger(env, "REMOTE_RETRY_ATTEMPTS", 3),
    retryBaseDelayMs: readPositiveInteger(env, "RETRY_BASE_DELAY_MS", 1_000),
    storageBucket,
    storagePrefix,
    statsDiskMount,
    statsRetentionMs:
      readPositiveNumber(env, "RASPBERRY_STATS_RETENTION_DAYS", 7) *
      24 *
      60 *
      60_000,
    supabaseKey,
    supabaseUrl,
    syncIntervalMs:
      readPositiveNumber(env, "SYNC_INTERVAL_MINUTES", 5) * 60_000,
    uploadConcurrency: readPositiveInteger(env, "UPLOAD_CONCURRENCY", 2),
  };
}

export function validateLocalPaths(config: AppConfig) {
  if (!existsSync(config.dbPath) || !statSync(config.dbPath).isFile()) {
    throw new Error(`SQLite database not found: ${config.dbPath}`);
  }

  if (!existsSync(config.imageDir) || !statSync(config.imageDir).isDirectory()) {
    throw new Error(`Image directory not found: ${config.imageDir}`);
  }
}
