require("dotenv").config();

import { PostgrestSingleResponse } from "@supabase/supabase-js";
import Database from "better-sqlite3";
import { addMinutes, format } from "date-fns";
import { readFile, readdir } from "node:fs/promises";
import { supabase } from "./libs/supabase";
import { DecodedPass } from "./models/decoded-pass";
import { decodedPassesQuery } from "./queries/decoded-passes";
import { formatDuration } from "./utils/format-duration";

console.log(`${format(new Date(), "HH:mm:ss")}: Starting up...`);

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
  const statement = db.prepare<DecodedPass[]>(decodedPassesQuery);
  const passes = statement.all() as DecodedPass[];

  if (passes.every((pass) => syncedPassesIds.includes(pass.id))) {
    console.log("    No new passes to sync\n");
  } else {
    for (const pass of passes) {
      if (syncedPassesIds.includes(pass.id)) {
        continue;
      }

      console.log("    Syncing pass: " + pass.id);
      console.log("    - Checking pass existence...");
      const { data: existingPass } = await supabase
        .from("passes")
        .select("id")
        .eq("id", pass.id)
        .single();
      if (existingPass) {
        syncedPassesIds.push(pass.id);
        console.warn("    - Pass already exists \n");
        continue;
      }

      console.log("    - Inserting pass...");
      const { error: passError } = await supabase.from("passes").insert({
        id: pass.id,
        azimuth_at_max: pass.azimuth_at_max,
        daylight_pass: Boolean(pass.daylight_pass),
        direction: pass.direction,
        gain: pass.gain,
        has_histogram: Boolean(pass.has_histogram),
        has_polar_az_el: Boolean(pass.has_polar_az_el),
        has_polar_direction: Boolean(pass.has_polar_direction),
        has_pristine: Boolean(pass.has_pristine),
        has_spectrogram: Boolean(pass.has_spectrogram),
        is_meteor: pass.file_path.includes("METEOR"),
        is_noaa: pass.file_path.includes("NOAA"),
        max_elevation: pass.max_elev,
        pass_end: new Date(pass.pass_end * 1000),
        pass_start_azimuth: pass.pass_start_azimuth,
        pass_start: new Date(pass.pass_start * 1000),
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

      let uploadCount = 1;
      for (let image of passImages) {
        const dbResponse = await supabase
          .from("passes_images")
          .insert({ path: image, fk_passes_id: pass.id });
        const storageResponse = await supabase.storage
          .from("passes")
          .upload(`images/${image}`, await readFile(`/srv/images/${image}`), {
            contentType: "image/" + image.split(".").pop(),
            upsert: true,
          });

        imagesResponses.push(dbResponse);
        imagesResponses.push(storageResponse);

        console.log(
          `    - ${uploadCount}/${passImages.length} images uploaded`
        );

        await new Promise((resolve) => setTimeout(resolve, 1000));
        uploadCount++;
      }

      const imagesErrors = imagesResponses.filter(
        (response) => response.error !== null
      );
      if (imagesErrors.length > 0) {
        console.warn(`    - Couldn't upload all images`);
        console.log(JSON.stringify(imagesErrors, null, 2));

        await supabase.from("passes").delete().eq("id", pass.id);
        await supabase
          .from("passes_images")
          .delete()
          .eq("fk_passes_id", pass.id);
        continue;
      }

      syncedPassesIds.push(pass.id);
      console.log(`    - Pass synced succesfully\n`);
    }
  }

  console.log(
    `${format(new Date(), "HH:mm:ss")}: Done in ${formatDuration(
      +new Date() - now
    )}! Next sync at ${format(
      addMinutes(new Date(), SYNC_INTERVAL_MINUTES),
      "HH:mm"
    )}.\n`
  );

  setTimeout(sync, 1000 * 60 * SYNC_INTERVAL_MINUTES);
}

sync();
