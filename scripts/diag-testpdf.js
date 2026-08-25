const fs = require('fs');
const { pdfToImages } = require('../services/pdf');
const { recognizeDetailed } = require('../services/ocr');
const { hasMrz } = require('../services/parse-cedula');

async function main() {
  const file = 'test/cedula-prueba.pdf';
  const pages = await pdfToImages(fs.readFileSync(file));
  const details = [];
  for (const p of pages) details.push(await recognizeDetailed(p.buffer));
  let fi = details.findIndex((d) => hasMrz(d.text));
  if (fi === -1) fi = 0;
  for (let i = 0; i < details.length; i++) {
    const tag = i === fi ? 'FRENTE' : 'REVERSO';
    const lines = [];
    for (const w of details[i].words) lines.push(`${w.text.padEnd(22)} c=${w.conf} x=${w.x0} y=${w.y0}-${w.y1}`);
    fs.writeFileSync(`C:/Users/STIVEN/AppData/Local/Temp/opencode/test-p${i}-${tag}.txt`, lines.join('\n'), 'utf8');
    console.log(`--- ${tag} (${details[i].text.length} chars) ---`);
    console.log(details[i].text);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
