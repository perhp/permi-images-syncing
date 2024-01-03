console.log('Starting up...');

require('dotenv').config();

import { readFile, readdir } from 'node:fs/promises';
import { supabase } from "./libs/supabase";
import { DecodedPass } from './models/decoded-pass';

import Database from 'better-sqlite3';
const db = new Database('/home/leducia/raspberry-noaa-v2/db/panel.db');

async function sync() {
    console.log('Syncing...');

    const images = (await readdir('/srv/images')).filter(path => path !== 'thumb');
    const statement = db.prepare<DecodedPass[]>('SELECT * FROM decoded_passes');
    const passes = statement.all();
    for (const pass of passes as DecodedPass[]) {
        console.log('    Syncing pass: ' + pass.id);

        const { id } = pass as DecodedPass;
        const { data: existingPass } = await supabase.from('passes').select('id').eq('id', id).single();
        if (existingPass) {
            console.warn(`    Pass ${id} already exists`);
            continue;
        }

        await supabase.from('passes').insert({
            id,
            gain: pass.gain,
            pass_start: new Date(pass.pass_start * 1000),
            daylight_pass: Boolean(pass.daylight_pass),
            has_histogram: Boolean(pass.has_histogram),
            has_polar_az_el: Boolean(pass.has_polar_az_el),
            has_polar_direction: Boolean(pass.has_polar_direction),
            has_pristine: Boolean(pass.has_pristine),
            has_spectrogram: Boolean(pass.has_spectrogram),
            is_noaa: pass.file_path.includes('NOAA'),
            is_meteor: pass.file_path.includes('METEOR'),
        });

        const passImages = images.filter(image => image.startsWith(pass.file_path));
        await Promise.all([
            ...passImages.map(image => supabase.from('passes_images').insert({ path: image, fk_passes_id: id })),
            ...passImages.map(async image => supabase.storage.from('passes').upload(`images/${image}`, (await readFile(`/srv/images/${image}`)), { contentType: 'image/' + image.split('.').pop() })),
        ]);

        console.log(`    Pass ${id} synced succesfully`);
    }

    console.log('Done!');
}

// Sync every 30 minutes
setInterval(sync, 1000 * 60 * 30);
sync();