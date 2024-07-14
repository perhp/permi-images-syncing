export interface DecodedPass {
  id: number;
  azimuth_at_max: number;
  daylight_pass: number;
  direction: string;
  file_path: string;
  gain: number;
  has_histogram: number;
  has_polar_az_el: number;
  has_polar_direction: number;
  has_pristine: number;
  has_spectrogram: number;
  img_count: number | null;
  is_noaa: number | null;
  max_elev: number;
  pass_end: number;
  pass_start_azimuth: number;
  pass_start: number;
  sat_type: number;
}
