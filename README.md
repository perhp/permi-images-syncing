# raspinoaa → Supabase Syncer

This lightweight utility keeps the weather‑satellite images captured on a Raspberry Pi in sync with my public site, <https://www.permi.dk>. It works in three simple steps:

1. Connects to the local **raspinoaa** SQLite database on the Pi.
2. Compares the recorded passes with the rows already stored in Supabase.
3. Uploads any new or missing passes—together with their images—to the cloud.

---

## Getting Started

**Prerequisites**

- A Raspberry Pi running **raspinoaa** with its default settings.
- A Supabase project configured with the two tables shown below.

### passes

| column              | type        |
| ------------------- | ----------- |
| id                  | int8        |
| azimuth_at_max      | int8        |
| daylight_pass       | bool        |
| direction           | text        |
| gain                | int8        |
| has_histogram       | bool        |
| has_polar_az_el     | bool        |
| has_polar_direction | bool        |
| has_pristine        | bool        |
| has_spectrogram     | bool        |
| is_meteor           | bool        |
| is_noaa             | bool        |
| max_elevation       | int8        |
| pass_end            | timestamptz |
| pass_start_azimuth  | int8        |
| pass_start          | timestamptz |
| created_at          | timestamptz |

### passes_images

| column       | type        |
| ------------ | ----------- |
| id           | int8        |
| path         | text        |
| fk_passes_id | int8        |
| created_at   | timestamptz |
