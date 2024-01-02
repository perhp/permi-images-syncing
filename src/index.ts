require('dotenv').config();

import { supabase } from "./libs/supabase";
import { DecodedPass } from './models/decoded-pass';

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('/home/leducia/raspberry-noaa-v2/db/panel.db');

db.serialize(() => {
    db.each("SELECT * FROM decoded_passes", (err: any, row: DecodedPass) => {
        if (err) {
            console.error(err);
            return;
        }

        console.log(row);
    });
});
