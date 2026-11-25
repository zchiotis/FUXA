'use strict';
// Photo-derived transparent asset for the preview. Geometry is retained in the bitmap.
// The SVG viewport removes transparent margins without changing the image pixels.
const fs=require('fs'),path=require('path');
let image;
function graphic(){
    if(!image)image='data:image/png;base64,'+fs.readFileSync(path.resolve(__dirname,'../../api/melissa/public/graphics/agv-v9.png')).toString('base64');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="289 39 963 1079" role="img" aria-label="AGV μεταφοράς παλετών"><title>AGV μεταφοράς παλετών</title><image width="1402" height="1122" href="${image}"/></svg>`;
}
module.exports={graphic};
