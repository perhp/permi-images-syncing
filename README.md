# raspinoaa → Supabase Syncer

This service reconciles weather-satellite passes captured by
[raspberry-noaa-v2](https://github.com/jekhokie/raspberry-noaa-v2) with a
Supabase database and Storage bucket.

It is intentionally one-way: local passes are uploaded or repaired, but local
pruning never deletes existing Supabase data.

## How synchronization works

Each cycle:

1. Reads completed passes from the raspinoaa SQLite database.
2. Finds the exact local image files belonging to each pass.
3. Refreshes paginated manifests from `passes`, `passes_images`, and Storage.
4. Uploads missing Storage objects with bounded concurrency.
5. Upserts the pass by its local `source_id` after Storage uploads succeed.
6. Uses Supabase's generated pass ID for new `passes_images` rows.

The operations are idempotent. A failure leaves successfully uploaded objects
in place, and the next cycle resumes the missing work instead of deleting
partial data. One failed pass does not block later passes.

## Requirements

- Node.js 22 or newer.
- A working raspberry-noaa-v2 installation.
- A Supabase `sb_secret_...` API key.
- A Supabase Storage bucket named `passes`, unless configured otherwise.
- The Supabase tables described below.

## Configuration

Copy `.env.example` to `.env` and set at least:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_your-secret-key
```

`SUPABASE_SERVICE_KEY` remains supported as a fallback environment-variable
name for existing installations, but new configurations should use
`SUPABASE_SECRET_KEY`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `IMAGE_DIR` | `/srv/images` | Local raspinoaa image directory |
| `SQLITE_DB_PATH` | `/home/pi/raspberry-noaa-v2/db/panel.db` | Local raspinoaa database |
| `SYNC_INTERVAL_MINUTES` | `5` | Delay between completed cycles |
| `REMOTE_REFRESH_MINUTES` | `60` | Frequency for reloading the full remote manifest |
| `UPLOAD_CONCURRENCY` | `2` | Maximum simultaneous image uploads |
| `REMOTE_RETRY_ATTEMPTS` | `3` | Attempts for each Supabase operation |
| `RETRY_BASE_DELAY_MS` | `1000` | Initial exponential-backoff delay |
| `SUPABASE_STORAGE_BUCKET` | `passes` | Storage bucket name |
| `SUPABASE_STORAGE_PREFIX` | `images` | Folder inside the Storage bucket |

All numeric configuration values must be positive. The application opens the
raspinoaa database read-only and exits with a descriptive error if either local
path is missing.

## Running

Install dependencies:

```bash
npm install
```

Preview the planned changes without writing to Supabase:

```bash
npm run sync:dry-run
```

Run one synchronization cycle:

```bash
npm run sync:once
```

Run continuously:

```bash
npm start
```

For development with automatic restart:

```bash
npm run dev
```

`npm start` compiles TypeScript to `dist` before starting Node. `SIGINT` and
`SIGTERM` stop the scheduling loop and close the SQLite database cleanly.

## Supabase schema

Create `passes.id` as a database-generated identity primary key. Also create a
required, unique `source_id` column containing the original
`decoded_passes.id` value from raspinoaa:

```sql
id bigint generated always as identity primary key,
source_id bigint not null unique
```

Pass upserts use `source_id` as their conflict target without sending an `id`.
Supabase generates `passes.id`, returns it to the syncer, and that value is
stored in `passes_images.fk_passes_id`.

### `passes`

| Column | Type |
| --- | --- |
| `id` | `int8` identity, primary key |
| `source_id` | `int8`, unique |
| `azimuth_at_max` | `int8` |
| `daylight_pass` | `bool` |
| `direction` | `text` |
| `gain` | `int8` |
| `has_histogram` | `bool` |
| `has_polar_az_el` | `bool` |
| `has_polar_direction` | `bool` |
| `has_pristine` | `bool` |
| `has_spectrogram` | `bool` |
| `is_meteor` | `bool` |
| `is_noaa` | `bool` |
| `max_elevation` | `int8` |
| `pass_end` | `timestamptz` |
| `pass_start_azimuth` | `int8` |
| `pass_start` | `timestamptz` |
| `created_at` | `timestamptz` |

### `passes_images`

| Column | Type |
| --- | --- |
| `id` | `int8` |
| `path` | `text` |
| `fk_passes_id` | `int8` |
| `created_at` | `timestamptz` |

The secret key bypasses Row Level Security and must only be stored on the
Raspberry Pi or another trusted backend.
