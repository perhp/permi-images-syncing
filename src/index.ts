import { parseFileName } from "./utils/parse-file-name";

const fs = require('fs');
fs.readdir('/srv/images', (err: Error, files: string[]) => {
    if (err) {
        console.error(err);
        return;
    } 

    const filesWithoutThumb = files.filter(file => file !== 'thumb');
    const satelliteImages = filesWithoutThumb.map(file => parseFileName(file));
    console.log(satelliteImages);
});
