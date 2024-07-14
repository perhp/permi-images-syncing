# raspinoaa to supabase syncer

This project synchronizes weather satellite images from my Raspberry Pi to https://www.permi.dk. It is a straightforward process: it accesses the SQLite database on the device using raspinoaa, compares it with my own database, and uploads any missing satellite passes to the server.

If you want something similar, you'll just need to have raspinoaa installed on your raspberry with default settings, and a supabase project with the following tables:

| passses             |             |
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

| passses_images |             |
| -------------- | ----------- |
| id             | int8        |
| path           | text        |
| fk_passes_id   | int8        |
| created_at     | timestamptz |
