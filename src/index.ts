console.log("Starting up...");

require("dotenv").config();

import { PostgrestSingleResponse } from "@supabase/supabase-js";
import Database from "better-sqlite3";
import { addMinutes, format } from "date-fns";
import { readFile, readdir } from "node:fs/promises";
import { supabase } from "./libs/supabase";
import { DecodedPass } from "./models/decoded-pass";

const db = new Database("/home/leducia/raspberry-noaa-v2/db/panel.db");

const SYNC_INTERVAL_MINUTES = 5;
const syncedPassesIds: number[] = [];

async function sync() {
  console.log(`${format(new Date(), "HH:mm:ss")}: Syncing...\n`);
  const now = +new Date();

  if (syncedPassesIds.length === 0) {
    console.log("    Getting initial passes...\n");
    const { data: initialPasses } = await supabase.from("passes").select("id");
    if (initialPasses) {
      syncedPassesIds.push(...initialPasses.map((pass) => pass.id));
    }
  }

  const images = (await readdir("/srv/images")).filter(
    (path) => path !== "thumb"
  );
  const statement = db.prepare<DecodedPass[]>("SELECT * FROM decoded_passes");
  const passes = statement.all();
  for (const pass of passes as DecodedPass[]) {
    console.log("    Syncing pass: " + pass.id);

    if (syncedPassesIds.includes(pass.id)) {
      console.log("    - Pass already synced ¹\n");
      continue;
    }

    console.log("    - Checking pass existence...");
    const { data: existingPass } = await supabase
      .from("passes")
      .select("id")
      .eq("id", pass.id)
      .single();
    if (existingPass) {
      syncedPassesIds.push(pass.id);
      console.warn("    - Pass already exists ²\n");
      continue;
    }

    console.log("    - Inserting pass...");
    const { error: passError } = await supabase.from("passes").insert({
      id: pass.id,
      gain: pass.gain,
      pass_start: new Date(pass.pass_start * 1000),
      daylight_pass: Boolean(pass.daylight_pass),
      has_histogram: Boolean(pass.has_histogram),
      has_polar_az_el: Boolean(pass.has_polar_az_el),
      has_polar_direction: Boolean(pass.has_polar_direction),
      has_pristine: Boolean(pass.has_pristine),
      has_spectrogram: Boolean(pass.has_spectrogram),
      is_noaa: pass.file_path.includes("NOAA"),
      is_meteor: pass.file_path.includes("METEOR"),
    });

    if (passError) {
      console.warn(`    - Couldn't insert pass`);
      console.log(JSON.stringify(passError, null, 2));
      continue;
    }

    console.log("    - Uploading images...");
    const passImages = images.filter((image) =>
      image.startsWith(pass.file_path)
    );
    const imagesResponses:
      | (
          | {
              data: {
                path: string;
              };
              error: null;
            }
          | {
              data: null;
              error: any;
            }
          | PostgrestSingleResponse<null>
        )[] = [];

    for (let image of passImages) {
      const dbResponse = await supabase
        .from("passes_images")
        .insert({ path: image, fk_passes_id: pass.id });
      const storageResponse = await supabase.storage
        .from("passes")
        .upload(`images/${image}`, await readFile(`/srv/images/${image}`), {
          contentType: "image/" + image.split(".").pop(),
        });

      imagesResponses.push(dbResponse);
      imagesResponses.push(storageResponse);

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const imagesErrors = imagesResponses.filter(
      (response) => response.error !== null
    );
    if (imagesErrors.length > 0) {
      console.warn(`    - Couldn't upload all images`);
      console.log(JSON.stringify(imagesErrors, null, 2));

      await supabase.from("passes").delete().eq("id", pass.id);
      await supabase.from("passes_images").delete().eq("fk_passes_id", pass.id);
      continue;
    }

    syncedPassesIds.push(pass.id);
    console.log(`    - Pass synced succesfully\n`);
  }

  console.log(
    `${format(new Date(), "HH:mm:ss")}: Done in ${
      +new Date() - now
    }ms! Next sync at ${format(
      addMinutes(new Date(), SYNC_INTERVAL_MINUTES),
      "HH:mm"
    )}.`
  );
}

setInterval(sync, 1000 * 60 * SYNC_INTERVAL_MINUTES);
sync();
