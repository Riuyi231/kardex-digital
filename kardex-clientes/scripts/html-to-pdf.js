'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const src = process.argv[2];
const out = process.argv[3];

if (!src || !out) {
  console.error('Uso: electron scripts/html-to-pdf.js <origen.html> <salida.pdf>');
  app.exit(1);
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, width: 900, height: 1200 });
    await win.loadFile(path.resolve(src));
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 }
    });
    fs.writeFileSync(path.resolve(out), pdf);
    console.log('PDF generado:', out);
    app.exit(0);
  } catch (e) {
    console.error('Error al generar PDF:', e);
    app.exit(1);
  }
});
