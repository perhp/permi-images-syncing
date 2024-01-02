export interface DecodedPass {
    id: number;
    pass_start: number;
    file_path: string;
    daylight_pass: number;
    is_noaa: number | null;
    sat_type: number;
    img_count: number | null;
    has_spectrogram: number;
    has_pristine: number;
    gain: number;
    has_polar_az_el: number;
    has_polar_direction: number;
    has_histogram: number;
}