console.log('Starting up raspinoaa supabase syncing...');

require('dotenv').config();

import { readFile, readdir } from 'node:fs/promises';
import { supabase } from "./libs/supabase";
import { DecodedPass } from './models/decoded-pass';

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('/home/leducia/raspberry-noaa-v2/db/panel.db');

async function sync() {
    const images = (await readdir('/srv/images')).filter(path => path !== 'thumb');

    db.serialize(() => {
        db.each("SELECT * FROM decoded_passes", async (err: any, row: DecodedPass) => {
            if (err) {
                console.error(err);
                return;
            }

            const { id, file_path } = row;
            const { data: existingPass } = await supabase.from('passes').select('id').eq('id', id).single();
            if (existingPass) {
                console.warn(`Pass ${id} already exists`);
                return;
            }

            await supabase.from('passes').insert({
                id,
                gain: row.gain,
                pass_start: new Date(row.pass_start * 1000),
                daylight_pass: Boolean(row.daylight_pass),
                has_histogram: Boolean(row.has_histogram),
                has_polar_az_el: Boolean(row.has_polar_az_el),
                has_polar_direction: Boolean(row.has_polar_direction),
                has_pristine: Boolean(row.has_pristine),
                has_spectrogram: Boolean(row.has_spectrogram),
                is_noaa: file_path.includes('NOAA'),
                is_meteor: file_path.includes('METEOR'),
            });

            const passImages = images.filter(image => image.startsWith(file_path));
            await Promise.all([
                ...passImages.map(image => supabase.from('passes_images').insert({ path: image, fk_passes_id: id })),
                ...passImages.map(async image => supabase.storage.from('passes').upload(`images/${image}`, (await readFile(`/srv/images/${image}`)), { contentType: 'image/' + image.split('.').pop() })),
            ]);
        });
    });
}

// Sync every 30 minutes
setInterval(sync, 1000 * 60 * 30);
sync();