const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const bwipjs = require('bwip-js');

const OUT = path.join(__dirname, '..', 'test', 'cedula-prueba.pdf');

function barcodePng(text) {
  return bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: 4,
    height: 12,
    includetext: false,
    textxalign: 'center'
  });
}

async function makeCard(doc, opts, back) {
  const page = doc.addPage([612, 396]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  if (back) {
    let y = 330;
    const rows = [
      ['FECHA DE NACIMIENTO', '12/03/1985'],
      ['LUGAR DE NACIMIENTO', 'SANTO DOMINGO'],
      ['NACIONALIDAD', 'DOMINICANA'],
      ['ESTADO CIVIL', 'CASADO (A)'],
      ['PROFESIÓN U OCUPACIÓN', 'INGENIERO'],
      ['NOMBRE DEL PADRE', 'PEDRO PÉREZ MARTÍNEZ'],
      ['NOMBRE DE LA MADRE', 'MARÍA GARCÍA DE PÉREZ'],
      ['FECHA DE EMISIÓN', '15/06/2021'],
      ['FECHA DE VENCIMIENTO', '15/06/2031']
    ];
    page.drawText('JUNTA CENTRAL ELECTORAL', { x: 60, y: 365, size: 14, font: bold, color: rgb(0, 0, 0.5) });
    page.drawText('REPÚBLICA DOMINICANA', { x: 60, y: 350, size: 12, font, color: rgb(0.2, 0.2, 0.2) });
    for (const [label, val] of rows) {
      page.drawText(label, { x: 60, y, size: 11, font: bold, color: rgb(0.1, 0.1, 0.4) });
      page.drawText(val, { x: 270, y, size: 12, font, color: rgb(0, 0, 0) });
      y -= 28;
    }
    page.drawText('FIRMA DEL TITULAR', { x: 60, y: 60, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
    return page;
  }

  page.drawText('REPÚBLICA DOMINICANA', { x: 200, y: 360, size: 13, font: bold, color: rgb(0.1, 0.1, 0.5) });
  page.drawText('CÉDULA DE IDENTIDAD Y ELECTORAL', { x: 170, y: 344, size: 12, font, color: rgb(0.1, 0.1, 0.5) });
  page.drawText('JUAN CARLOS PÉREZ GARCÍA', { x: 120, y: 300, size: 16, font: bold, color: rgb(0, 0, 0) });
  page.drawText(`NÚMERO DE CÉDULA`, { x: 120, y: 270, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
  page.drawText(opts.cedula, { x: 120, y: 255, size: 18, font: bold, color: rgb(0, 0, 0) });
  page.drawText('SEXO M', { x: 120, y: 220, size: 13, font: bold, color: rgb(0, 0, 0) });

  const png = await barcodePng(opts.cedula.replace(/-/g, ''));
  const img = await doc.embedPng(png);
  page.drawImage(img, { x: 82, y: 80 });

  page.drawRectangle({ x: 60, y: 60, width: 492, height: 276, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  return page;
}

(async () => {
  const doc = await PDFDocument.create();
  const opts = { cedula: '001-2345678-9' };
  await makeCard(doc, opts, false);
  await makeCard(doc, opts, true);
  const bytes = await doc.save();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, bytes);
  console.log('PDF de prueba creado:', OUT);
})();
