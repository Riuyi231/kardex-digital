// Genera el instructivo PDF del sistema de licencias usando Electron (printToPDF).
// Uso: node_modules\electron\dist\electron.exe scripts\make-guia-licencias-pdf.js
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, width: 800, height: 1200 });
    const htmlPath = path.join(__dirname, 'guia-licencias.html');
    await win.loadFile(htmlPath);
    await new Promise((r) => setTimeout(r, 600));
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'default' }
    });
    const outPath = path.join(__dirname, '..', 'dist', 'INSTRUCTIVO-LICENCIAS.pdf');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, pdf);
    console.log('PDF generado:', outPath, '(' + pdf.length + ' bytes)');
    app.exit(0);
  } catch (e) {
    console.error('Error generando PDF:', e);
    app.exit(1);
  }
});
