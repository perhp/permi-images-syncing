console.log('Starting up raspinoaa supabase syncing...');

require('dotenv').config();

import { readdir } from 'node:fs/promises';
import { supabase } from "./libs/supabase";
import { DecodedPass } from './models/decoded-pass';

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('/home/leducia/raspberry-noaa-v2/db/panel.db');

(async () => {
    const images = (await readdir('/srv/images')).filter(path => path !== 'thumb');
    const thumbs = await readdir('/srv/images/thumb');
    
    db.serialize(() => {
        db.each("SELECT * FROM decoded_passes", async (err: any, row: DecodedPass) => {
            if (err) {
                console.error(err);
                return;
            }
    
            const { id, file_path } = row;
            const passThumbs = thumbs.filter(thumb => thumb.startsWith(file_path));
            const passImages = images.filter(image => image.startsWith(file_path));
            
            const { data: existingPass, error: existingError } = await supabase.from('passes').select('id').eq('id', id).single();
            if (existingPass) {
                console.warn(`Pass ${id} already exists`);
                return;
            }

            const { data: pass, error } = await supabase.from('passes').insert({
                id, 
                gain: row.gain, 
                pass_start: row.pass_start, 
                daylight_pass: Boolean(row.daylight_pass),
                has_histogram: Boolean(row.has_histogram), 
                has_polar_az_el: Boolean(row.has_polar_az_el), 
                has_polar_direction: Boolean(row.has_polar_direction), 
                has_pristine: Boolean(row.has_pristine), 
                has_spectrogram: Boolean(row.has_spectrogram),
                is_noaa: file_path.includes('NOAA'),
                is_meteor: file_path.includes('METEOR'),
            });

            console.log('2:', error);
        });        
    });
})();
