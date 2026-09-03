// Exportación a Excel (.xlsx) con tablas reales (ListObjects) para planillas, nómina, reportes, etc.
const ExcelJS = require('exceljs');

function sanitizeTableName(name) {
  const s = String(name || 'Tabla').replace(/[^A-Za-z0-9_]/g, '').replace(/^\d/, 'T');
  return s || 'Tabla';
}

function colWidths(headers, rows) {
  return headers.map((h, i) => {
    let max = String(h).length;
    for (const r of rows) {
      const len = String(r[i] == null ? '' : r[i]).length;
      if (len > max) max = len;
    }
    return Math.min(45, Math.max(9, max + 2));
  });
}

function uniqueName(base, used) {
  let name = base;
  let k = 1;
  while (used[name]) { name = base + k; k++; }
  used[name] = true;
  return name;
}

function addSingleTable(ws, sheet, usedNames) {
  const headers = (sheet.headers || []).map(String);
  const dataRows = (sheet.rows || []).map(r => r.map(c => (c == null ? '' : c)));
  const footer = Array.isArray(sheet.footer) ? sheet.footer.map(c => (c == null ? '' : c)) : null;
  const rows = footer ? dataRows.concat([footer]) : dataRows;
  const widths = colWidths(headers, rows);

  let base = sanitizeTableName(sheet.name);
  let tableName = uniqueName(base, usedNames);

  if (rows.length) {
    ws.addTable({
      name: tableName,
      ref: 'A1',
      headerRow: true,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: headers.map(h => ({ name: h })),
      rows
    });
  } else {
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true };
  }
  headers.forEach((h, idx) => { ws.getColumn(idx + 1).width = widths[idx]; });

  if (footer) {
    const row = ws.getRow(rows.length + 1);
    row.eachCell((cell) => { cell.font = { bold: true }; });
  }
}

// sheets: [{ name, title, tables: [{ title, headers, rows, footer }], grandTotal }]
// Apila varias tablas (una por departamento) en la misma hoja, cada una con su
// subtotal, y debajo de la última el total general.
function addGroupedSheet(ws, sheet, usedNames) {
  const tables = sheet.tables || [];
  let rowNum = 1;
  if (sheet.title) {
    ws.getCell(rowNum, 1).value = sheet.title;
    ws.getCell(rowNum, 1).font = { bold: true, size: 13 };
    ws.mergeCells(rowNum, 1, rowNum, Math.max(1, (tables[0]?.headers || []).length || 6));
    rowNum += 2;
  }
  let widths = null;
  // Recopila, por cada columna numérica, las celdas de los subtotales de cada
  // tabla para poder generar el TOTAL GENERAL como fórmula de SUMA.
  const grandCells = {};
  for (const tbl of tables) {
    const headers = (tbl.headers || []).map(String);
    const dataRows = (tbl.rows || []).map(r => r.map(c => (c == null ? '' : c)));
    const footer = Array.isArray(tbl.footer) ? tbl.footer.map(c => (c == null ? '' : c)) : null;
    const rows = footer ? dataRows.concat([footer]) : dataRows;
    if (widths == null) widths = colWidths(headers, rows);

    if (tbl.title) {
      ws.getCell(rowNum, 1).value = tbl.title;
      ws.getCell(rowNum, 1).font = { bold: true, size: 11 };
      rowNum += 1;
    }
    let base = sanitizeTableName(tbl.title || tbl.name || sheet.name);
    let tableName = uniqueName(base, usedNames);
    if (rows.length) {
      const tblRef = rowNum; // cabecera de la tabla (ref de addTable)
      ws.addTable({
        name: tableName,
        ref: `A${tblRef}`,
        headerRow: true,
        style: { theme: 'TableStyleMedium2', showRowStripes: true },
        columns: headers.map(h => ({ name: h })),
        rows
      });
      if (footer) {
        const dataStart = tblRef + 1; // primera fila de datos
        const dataEnd = tblRef + dataRows.length; // última fila de datos (sin el footer)
        const footRowIdx = tblRef + rows.length; // fila del subtotal (footer)
        const footRow = ws.getRow(footRowIdx);
        footRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const idx = colNumber - 1;
          const fv = footer[idx];
          if (typeof fv === 'number' && !isNaN(fv)) {
            const colLetter = ws.getColumn(colNumber).letter;
            cell.value = { formula: `SUM(${colLetter}${dataStart}:${colLetter}${dataEnd})` };
            (grandCells[colNumber] = grandCells[colNumber] || []).push(`${colLetter}${footRowIdx}`);
          }
          cell.font = { bold: true };
        });
      }
      rowNum += rows.length + 1; // fila de la tabla + cabecera
    } else {
      ws.addRow(headers);
      ws.getRow(rowNum).font = { bold: true };
      rowNum += 1;
    }
    rowNum += 1; // fila en blanco entre tablas
  }
  if (Array.isArray(sheet.grandTotal)) {
    ws.getCell(rowNum, 1).value = 'TOTAL GENERAL';
    ws.getCell(rowNum, 1).font = { bold: true };
    sheet.grandTotal.forEach((v, idx) => {
      const colNumber = idx + 2; // la columna 1 tiene el rótulo
      const colLetter = ws.getColumn(colNumber).letter;
      // Si hay subtotales en esa columna, el total general es la suma de esos subtotales.
      if (grandCells[colNumber] && grandCells[colNumber].length) {
        ws.getCell(rowNum, colNumber).value = { formula: `SUM(${grandCells[colNumber].join(',')})` };
      } else {
        ws.getCell(rowNum, colNumber).value = (typeof v === 'number' && !isNaN(v)) ? { formula: '0' } : (v == null ? '' : v);
      }
      ws.getCell(rowNum, colNumber).font = { bold: true };
    });
  }
  if (widths) widths.forEach((w, idx) => { ws.getColumn(idx + 1).width = w; });
}

// sheets: [{ name, headers, rows, footer }] o [{ name, title, tables, grandTotal }]
function buildWorkbook(sheets) {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const usedNames = {};
  const usedSheets = {};
  for (const sheet of sheets || []) {
    const baseSheetName = String(sheet.name || 'Hoja').replace(/[*?:\\/[\]]/g, '-').slice(0, 31);
    const sheetName = uniqueName(baseSheetName, usedSheets);
    const ws = wb.addWorksheet(sheetName);
    if (Array.isArray(sheet.tables)) addGroupedSheet(ws, sheet, usedNames);
    else addSingleTable(ws, sheet, usedNames);
  }
  return wb;
}

async function writeExcelSheets(filePath, sheets) {
  const wb = buildWorkbook(sheets);
  await wb.xlsx.writeFile(filePath);
  return filePath;
}

async function buildSheetsBuffer(sheets) {
  const wb = buildWorkbook(sheets);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

module.exports = { writeExcelSheets, buildSheetsBuffer };
