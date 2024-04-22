export const decodedPassesQuery = `SELECT
    decoded_passes.id,
    gain,
    daylight_pass,
    has_histogram,
    has_polar_az_el,
    has_polar_direction,
    has_pristine,
    has_spectrogram,
    file_path,
    predict_passes.pass_start,
    predict_passes.max_elev,
    predict_passes.direction,
    predict_passes.azimuth_at_max,
    predict_passes.pass_end,
    predict_passes.pass_start_azimuth
FROM
    decoded_passes
    INNER JOIN predict_passes ON predict_passes.pass_start = decoded_passes.pass_start`;
