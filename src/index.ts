const fs = require('fs');

fs.readdir('/srv/images', (err: Error, files: string[]) => {
    if (err) {
        console.error(err);
        return;
    } 

    const filesWithoutThumb = files.filter(file => file !== 'thumb');
    console.log(filesWithoutThumb);
});
