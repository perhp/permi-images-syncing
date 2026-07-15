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
  max_elev: number;
  pass_end: number;
  pass_start_azimuth: number;
  pass_start: number;
  sat_type: number;
}

export interface PassRecord {
  source_id: number;
  azimuth_at_max: number;
  daylight_pass: boolean;
  direction: string;
  gain: number;
  has_histogram: boolean;
  has_polar_az_el: boolean;
  has_polar_direction: boolean;
  has_pristine: boolean;
  has_spectrogram: boolean;
  is_meteor: boolean;
  is_noaa: boolean;
  max_elevation: number;
  pass_end: string;
  pass_start_azimuth: number;
  pass_start: string;
}

export interface RemotePass extends PassRecord {
  id: number;
}

export interface LocalImage {
  contentType: string;
  filePath: string;
  name: string;
  storagePath: string;
}

export interface LocalPass {
  images: LocalImage[];
  record: PassRecord;
}
