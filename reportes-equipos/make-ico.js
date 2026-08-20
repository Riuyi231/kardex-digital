const fs = require('fs');
const path = require('path');

const SIZES = [16, 32, 48, 64, 128, 256, 512];

function buildIco(pngBuffers) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);   // reserved
  header.writeUInt16LE(1, 2);   // type: icon
  header.writeUInt16LE(pngBuffers.length, 4);
  const entries = [];
  let offset = 6 + pngBuffers.length * 16;
  for (const [i, buf] of pngBuffers.entries()) {
    const size = SIZES[i];
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);  // width
    e.writeUInt8(size >= 256 ? 0 : size, 1);  // height
    e.writeUInt8(0, 2);                       // colors
    e.writeUInt8(0, 3);                       // reserved
    e.writeUInt16LE(1, 4);                    // planes
    e.writeUInt16LE(32, 6);                   // bit count
    e.writeUInt32LE(buf.length, 8);           // bytes in resource
    e.writeUInt32LE(offset, 12);              // image offset
    entries.push(e);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

const pngs = SIZES.map((s) => fs.readFileSync(path.join(__dirname, 'build', 'icon-' + s + '.png')));
fs.writeFileSync(path.join(__dirname, 'build', 'icon.ico'), buildIco(pngs));
console.log('icon.ico generado (manual):', fs.statSync(path.join(__dirname, 'build', 'icon.ico')).size, 'bytes');
