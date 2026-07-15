export const upcomingPassesQuery = `SELECT
    sat_name,
    pass_start,
    pass_end,
    max_elev,
    pass_start_azimuth,
    direction,
    azimuth_at_max
FROM
    predict_passes
WHERE
    pass_start > @now
    AND is_active = 1
ORDER BY
    pass_start ASC`;
