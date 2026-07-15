export interface PredictedPass {
  azimuth_at_max: number;
  direction: string;
  max_elev: number;
  pass_end: number;
  pass_start: number;
  pass_start_azimuth: number;
  sat_name: string;
}

export interface UpcomingPassRecord {
  azimuth_at_max: number;
  direction: string;
  max_elevation: number;
  pass_end: string;
  pass_start: string;
  pass_start_azimuth: number;
  satellite_name: string;
}
