const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

const documentos = require('./documentos');
const db = require('./active-db');
const pdf = require('./pdf');
const DEFAULT_TEMPLATES = require('./default-templates');

const TIPOS_DOC = ['constancia', 'carta', 'solicitud'];

// Modo por defecto por tipo de documento cuando la base no lo define:
// las cartas se generan desde la plantilla Word integrada y la solicitud desde el PDF integrado.
const DEFAULT_MODE = { constancia: 'docx', carta: 'docx', solicitud: 'pdf_form' };

function getDocMode(kind) {
  const s = documentos.getSettings();
  const stored = s[`doc_tipo_${kind}`] || '';
  const hasPlantilla = !!(s[`doc_plantilla_${kind}`] || '');
  // Si hay una plantilla subida, respetar el modo con el que se subió.
  if (hasPlantilla && stored) return stored;
  // Sin plantilla propia: usar la integrada del sistema.
  return DEFAULT_MODE[kind] || 'generada';
}

// Devuelve la plantilla configurada en la base o, si no hay, la integrada del sistema.
// `fmt` elige la variante integrada cuando la base no tiene plantilla (p. ej. la solicitud
// tiene un PDF de formulario del banco y una versión Word integrada).
function getTemplateData(kind, fmt) {
  const s = documentos.getSettings();
  const dbB64 = s[`doc_plantilla_${kind}`] || '';
  if (dbB64) return { base64: dbB64, name: s[`doc_plantilla_${kind}_name`] || '' };
  if (kind === 'solicitud') {
    const def = fmt === 'docx' ? (DEFAULT_TEMPLATES.solicitud_docx || DEFAULT_TEMPLATES.solicitud) : DEFAULT_TEMPLATES.solicitud;
    return def ? { base64: def.base64, name: def.name, mode: fmt === 'docx' ? 'docx' : 'pdf_form' } : { base64: '', name: '' };
  }
  const def = DEFAULT_TEMPLATES[kind] || (kind === 'carta' ? DEFAULT_TEMPLATES.constancia : null);
  return def ? { base64: def.base64, name: def.name, mode: 'docx' } : { base64: '', name: '' };
}

// Quita el prefijo "data:mime;base64," si quedó guardado (corrige plantillas viejas)
function stripDataUrlPrefix(str) {
  if (!str) return '';
  const s = String(str);
  const m = s.match(/^data:[^,]*;base64,(.*)$/s);
  return m ? m[1] : s;
}

function renderDocxTemplate(tplBase64, ctx) {
  const zip = new PizZip(Buffer.from(stripDataUrlPrefix(tplBase64), 'base64'));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' }
  });
  doc.render(ctx);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/* ============ Relleno automático por etiquetas ============ */

const xmlUnescape = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Detecta la etiqueta en español y rellena el hueco que le sigue (guiones bajos, puntos o espacios).
// Las reglas más específicas (que consumen "de:", "No.:", "RD$"...) van primero para acertar el hueco.
const FILL_RULES = [
  { re: /nombre\s+(?:completo|del\s+empleado)\s*(?::)?/i, key: 'nombre_completo' },
  { re: /portador(?:a)?\s+de\s+la\s+c[eé]dula\s*(?:n[oó]\.?\s*:?)?/i, key: 'cedula' },
  { re: /c[eé]dula\s+(?:de\s+(?:identidad\s+)?)?n[oó]\.?\s*:?\s*/i, key: 'cedula' },
  { re: /n[oó]\.?\s*(?:de\s+)?c[eé]dula\s*(?::)?/i, key: 'cedula' },
  { re: /fecha\s+de\s+(?:ingreso|entrada|contrataci[oó]n|inicio\s+de\s+labores)\s*(?::)?/i, key: 'fecha_ingreso_fmt' },
  { re: /desde\s+el\s+(?:d[íi]a\s+)?/i, key: 'fecha_ingreso_fmt' },
  { re: /salario\s+(?:mensual\s+)?(?:de\s*:?\s*)?(?:rd\s*\$)?\s*(?::)?/i, key: 'salario_rd' },
  { re: /celular\s*(?::)?/i, key: 'firma_celular' },
  { re: /sueldo|remuneraci[oó]n\s+(?:mensual\s+)?(?:de\s*:?\s*)?(?:rd\s*\$)?\s*(?::)?/i, key: 'salario_rd' },
  { re: /reside\s+en\s+(?:la\s+)?(?:ciudad\s+de\s+)?/i, key: 'ciudad' },
  { re: /ciudad\s+de\s+residencia\s*(?::)?/i, key: 'ciudad' },
  { re: /puesto\s+(?:de\s*:?\s*)?(?:trabajo\s+)?\s*(?::)?/i, key: 'puesto' },
  { re: /departamento\s+(?:de\s*:?\s*)?\s*(?::)?/i, key: 'departamento' },
  { re: /sucursal\s*(?::)?/i, key: 'sucursal' },
  { re: /nombre/i, key: 'nombre_completo' },
  { re: /(?:el|la|los|las)\s+se[nñ]or(?:a|es|as)?\s*/i, key: 'nombre_completo' },
  { re: /c[eé]dula/i, key: 'cedula' },
  { re: /ciudad|domicilio/i, key: 'ciudad' },
  { re: /area|área/i, key: 'departamento' },
  { re: /puesto|posici[oó]n|cargo/i, key: 'puesto' },
  { re: /departamento/i, key: 'departamento' },
  { re: /salario/i, key: 'salario_rd' }
];

// Reemplaza el valor YA escrito en la plantilla (cartas pre-llenadas) tras cada etiqueta.
// El grupo 1 captura el valor existente y se sustituye por el dato del empleado.
// Las reglas se evalúan sobre el texto COMPLETO de la página (líneas unidas con \n) con bandera
// /m, de modo que ^ y $ anclan al inicio/fin de cada línea y un párrafo que se parte en varias
// líneas (p. ej. "Que ... de nacionalidad" en un PDF) se puede reemplazar completo.
const H = '[ \\t\\u00A0]'; // espacio horizontal: no cruza líneas
const INLINE_RULES = [
  { re: new RegExp(`a\\s+favor\\s+de\\s*:${H}*([^\\n]*)$`, 'im'), key: 'nombre_completo' },
  { re: /^Que\s+([\s\S]*?),\s+de\s+nacionalidad/im, key: 'nombre_completo' },
  { re: new RegExp(`^${H}*A${H}*:${H}*([^\\n]+?)${H}*$`, 'im'), key: 'banco' },
  { re: new RegExp(`^${H}*([Bb]anco\\s+[A-ZÁÉÍÓÚÑa-záéíóúñ0-9][A-ZÁÉÍÓÚÑa-záéíóúñ0-9. \\t&]*?)${H}*$`, 'im'), key: 'banco' },
  { re: new RegExp(`^${H}*(Banreservas|Banco\\s+Popular|Popular|Banco\\s+BHD|BHD\\s+León|Banco\\s+Santa\\s+Cruz|Banco\\s+Caribe|Scotiabank|Banco\\s+Cibao|Banco\\s+Ademi|Ademi|Banco\\s+Vimenca|Banesco)${H}*$`, 'im'), key: 'banco' },
  { re: new RegExp(`nombre\\s+del\\s+empleado${H}*:?${H}*([^\\n]*)$`, 'im'), key: 'nombre_completo' },
  { re: new RegExp(`fecha\\s+de\\s+nacimiento${H}*:?${H}*(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})`, 'i'), key: 'fecha_nacimiento_fmt' },
  { re: new RegExp(`salario\\s+base${H}*:?${H}*([0-9.,]+)`, 'i'), key: 'salario_num' },
  { re: /((?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+\d{1,2},\s*\d{4})/i, key: 'fecha_header' },
  { re: /((?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+\d{1,2}\s+del\s+\d{4})/i, key: 'fecha_header_del' },
  { re: new RegExp(`portador(?:a)?\\s+de\\s+la\\s+c[eé]dula\\s*(?:n[oó]\\.?\\s*|#|n[uú]mero\\s*)?${H}*:?${H}*([0-9 \\t-]{8,20})`, 'i'), key: 'cedula' },
  { re: new RegExp(`c[eé]dula\\s*(?:n[oó]\\.?\\s*|#)?${H}*:?${H}*([0-9 \\t-]{8,20})`, 'i'), key: 'cedula' },
  { re: /(?:en\s+la\s+|de\s+)?ciudad\s+de\s+([A-ZÁÉÍÓÚÑa-záéíóúñ][^,.;\n]+)/i, key: 'ciudad' },
  { re: new RegExp(`(?:desde\\s+el|desde\\s+el\\s+d[íi]a)\\s+(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})`, 'i'), key: 'fecha_ingreso_fmt' },
  { re: /funci[oó]n\s+de\s+([^,\n]+?)(?=\s+en\s+(?:el\s+)?departamento|\s+en\s+cuya\s+posici[oó]n|,|\.|;|$)/im, key: 'puesto' },
  { re: /departamento\s+de\s+([^,\n]+?)(?=\s+suc\.|,\s*en\s+cuya\s+posici[oó]n|,|;|$)/im, key: 'departamento' },
  { re: /suc\.?\s+([^\s_][^,.;\n]*?)(?=,|;|\.|$)/im, key: 'sucursal' },
  { re: /ingreso\s+mensual\s+base\s+de\s+(RD\$\s*[0-9.,]+)/i, key: 'salario_rd' },
  { re: /salario\s+mensual\s+de\s+(RD\$\s*[0-9.,]+)/i, key: 'salario_rd' },
  { re: new RegExp(`^${H}*De${H}*:${H}*([^\\n]*)$`, 'im'), key: 'empresa' },
  { re: /La\s+empresa\s+([^\n]+?)\s*,\s*constituida/im, key: 'empresa' },
  // "nuestra empresa X" seguido de ", con RNC", otra cláusula en minúscula o fin de línea.
  // El lookahead evita comerse el resto de la línea (p. ej. "TECNAS, EIRL, con RNC No. ...").
  { re: /nuestra\s+empresa\s+([^\n]*?)\s*(?=,\s+[a-záéíóúñ]|\.?\s*$)/im, key: 'empresa' },
  { re: new RegExp(`^${H}*Asunto${H}*:${H}*([^\\n]*)$`, 'im'), key: 'asunto' },
  // Bloque del firmante en la solicitud de cuenta de nómina (modelo del banco):
  // valores ya escritos tras NOMBRE:, TELÉFONO TRABAJO:, CELULAR: y en el bloque "firma responsable".
  { re: new RegExp(`^${H}*NOMBRE${H}*:${H}*_+${H}*([^\\n]+)`, 'im'), key: 'firma_nombre' },
  { re: new RegExp(`^${H}*TELEFONO${H}+TRABAJO${H}*:${H}*_+${H}*([^\\n]+)`, 'im'), key: 'empresa_tel' },
  { re: new RegExp(`^${H}*CELULAR${H}*:${H}*_+${H}*([^\\n]+)`, 'im'), key: 'firma_celular' },
  { re: new RegExp(`^${H}*firma${H}+responsable[\\s\\S]*?\\n${H}*([^\\n]+)`, 'im'), key: 'firma_nombre' },
  { re: new RegExp(`^${H}*Enc\\.?${H}*Dpto\\.?${H}+([^\\n]+)$`, 'im'), key: 'firma_cargo' }
];

function setRunXml(runXml, newText) {
  const first = runXml.match(/<w:t(\s[^>]*)?>[\s\S]*?<\/w:t>/);
  let attrs = first ? (first[1] || '') : '';
  if (!/\sxml:space=/.test(attrs)) attrs += ' xml:space="preserve"';
  const t = xmlEscape(newText);
  const out = runXml.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, '');
  return out.replace(/<\/w:r>/, `<w:t${attrs}>${t}</w:t></w:r>`);
}

// Aplica una sustitución [s,e) → repl sobre el array de textos de runs (mutado en sitio)
function applyReplacement(texts, s, e, repl) {
  let pos = 0;
  for (let i = 0; i < texts.length; i++) {
    const runStart = pos;
    const runEnd = pos + texts[i].length;
    if (e <= runStart) break;
    if (s >= runEnd) { pos = runEnd; continue; }
    const a = Math.max(0, s - runStart);
    const b = Math.min(texts[i].length, Math.max(0, e - runStart));
    texts[i] = texts[i].slice(0, a) + repl + texts[i].slice(b);
    if (e > runEnd) {
      let p2 = runEnd;
      for (let j = i + 1; j < texts.length; j++) {
        const rjStart = p2;
        const rjEnd = p2 + texts[j].length;
        if (e >= rjEnd) { texts[j] = ''; p2 = rjEnd; continue; }
        texts[j] = texts[j].slice(Math.max(0, e - rjStart));
        break;
      }
    }
    break;
  }
}

// Rellena una plantilla Word buscando etiquetas en español y dejando el dato del empleado
function fillDocxLabels(zip, ctx) {
  const entry = zip.file('word/document.xml');
  if (!entry) return 0;
  let filled = 0;

  const newXml = entry.asText().replace(/<w:p\b[\s\S]*?<\/w:p>/g, (pBlock) => {
    const runs = [];
    const runRe = /<w:r\b[\s\S]*?<\/w:r>/g;
    let m;
    while ((m = runRe.exec(pBlock)) !== null) runs.push(m[0]);
    if (!runs.length) return pBlock;

    const origTexts = runs.map((r) => {
      let t = '';
      const tre = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
      let mm;
      while ((mm = tre.exec(r)) !== null) t += xmlUnescape(mm[1]);
      return t;
    });
    const texts = origTexts.slice();

    const repls = [];
    let scanPos = 0;
    let guard = 0;
    while (guard++ < 50) {
      const text = texts.join('');
      let best = null;
      for (const rule of FILL_RULES) {
        const mm = rule.re.exec(text);
        if (!mm || mm.index < scanPos) continue;
        if (!best || mm.index < best.s) best = { kind: 'fill', rule, m: mm, s: mm.index };
      }
      for (const rule of INLINE_RULES) {
        const mm = rule.re.exec(text);
        if (!mm || !mm[1]) continue;
        const gStart = mm.index + mm[0].indexOf(mm[1]);
        if (gStart < scanPos) continue;
        if (!best || gStart < best.s) best = { kind: 'inline', rule, m: mm, s: gStart, gStart, gEnd: gStart + mm[1].length };
      }
      if (!best) break;

      if (best.kind === 'inline') {
        let value = ctx && ctx[best.rule.key] ? String(ctx[best.rule.key]) : '';
        if (value) {
          repls.push({ s: best.gStart, e: best.gEnd, repl: value });
        }
        scanPos = best.gEnd;
        continue;
      }

      const { rule, m } = best;
      const labelEnd = m.index + m[0].length;
      const after = text.slice(labelEnd).match(/^([:;]?)([\s\u00A0]*)([_\.·…\u00A0-]*)/) || ['', '', '', ''];
      const punct = after[1] || '';
      const blanks = after[3] || '';
      const slotEnd = labelEnd + (after[0] || '').length;
      const trailing = text.slice(slotEnd).trim();
      // Rellenar si hay hueco real (2+ en blanco) o si el label con ":" termina la línea.
      // NO si ya hay contenido escrito (p. ej. "NOMBRE:_BOLIVAR ROJAS") — eso lo maneja INLINE.
      const hasBlanks = blanks.length >= 2;
      const colonOnly = punct && !trailing;
      if (hasBlanks || colonOnly) {
        let value = ctx && ctx[rule.key] ? String(ctx[rule.key]) : '';
        // Si la etiqueta ya termina en "RD$" (ej. "salario de RD$"), no duplicar la moneda
        if (value && /rd\s*\$?\s*$/i.test(m[0])) {
          value = value.replace(/^\s*rd\s*\$?\s*/i, '').trim();
        }
        if (value) {
          repls.push({ s: labelEnd, e: slotEnd, repl: (punct ? punct + ' ' : ' ') + value });
        }
      }
      scanPos = slotEnd;
    }

    if (!repls.length) return pBlock;
    filled += repls.length;
    // aplicar de derecha a izquierda para no desplazar offsets
    for (let i = repls.length - 1; i >= 0; i--) {
      applyReplacement(texts, repls[i].s, repls[i].e, repls[i].repl);
    }

    let rebuilt = '';
    let last = 0;
    let ri = 0;
    runRe.lastIndex = 0;
    let mm;
    while ((mm = runRe.exec(pBlock)) !== null) {
      rebuilt += pBlock.slice(last, mm.index);
      rebuilt += texts[ri] !== origTexts[ri] ? setRunXml(mm[0], texts[ri]) : mm[0];
      last = mm.index + mm[0].length;
      ri++;
    }
    return rebuilt + pBlock.slice(last);
  });

  if (newXml !== entry.asText()) {
    zip.file('word/document.xml', newXml);
  }
  return filled;
}

// Alias para nombres de campos de formulario PDF en español
const FIELD_ALIASES = {
  nombre: 'nombre_completo', nombrecompleto: 'nombre_completo', nombreyapellidos: 'nombre_completo',
  nombre_del_empleado: 'nombre_completo', nombres: 'nombres', apellidos: 'apellidos',
  cedula: 'cedula', ci: 'cedula', identificacion: 'cedula',
  fecha_ingreso: 'fecha_ingreso_fmt', fechadeingreso: 'fecha_ingreso_fmt', fechadeentrada: 'fecha_ingreso_fmt',
  ingreso: 'fecha_ingreso_fmt', fechaentrada: 'fecha_ingreso_fmt',
  salario: 'salario_rd', sueldo: 'salario_rd', salariord: 'salario_rd', salariomensual: 'salario_texto',
  ciudad: 'ciudad', residencia: 'ciudad', ciudadresidencia: 'ciudad', domicilio: 'ciudad',
  puesto: 'puesto', cargo: 'puesto', posicion: 'puesto',
  departamento: 'departamento', area: 'departamento',
  fecha: 'fecha', telefono: 'telefono', email: 'email', correo: 'email',
  nss: 'nss', ars: 'ars', afp: 'afp', banco: 'banco', cuenta: 'cuenta'
};

function findSoffice() {
  const known = [
    'C:/Program Files/LibreOffice/program/soffice.exe',
    'C:/Program Files (x86)/LibreOffice/program/soffice.exe'
  ];
  for (const p of known) {
    if (fs.existsSync(p)) return p;
  }
  for (const cmd of ['soffice', 'libreoffice', 'soffice.exe']) {
    try {
      const r = spawnSync(cmd, ['--version'], { timeout: 8000, windowsHide: true });
      if (!r.error && (r.stdout && r.stdout.toString().includes('LibreOffice'))) return cmd;
    } catch (e) { /* siguiente */ }
  }
  return null;
}

function docxToPdf(buffer) {
  const soffice = findSoffice();
  if (!soffice) throw new Error('Para exportar a PDF desde una plantilla Word, instale LibreOffice en la PC.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kardex-docx-'));
  try {
    const src = path.join(dir, 'template.docx');
    const out = path.join(dir, 'out');
    fs.writeFileSync(src, buffer);
    fs.mkdirSync(out, { recursive: true });
    const r = spawnSync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', out, src], { timeout: 90000, windowsHide: true });
    if (r.error) throw new Error('LibreOffice no pudo ejecutarse: ' + r.error.message);
    const pdfPath = path.join(out, 'template.pdf');
    if (!fs.existsSync(pdfPath)) throw new Error('La conversión a PDF falló (LibreOffice no respondió). Revise que el archivo no esté abierto.');
    return fs.readFileSync(pdfPath);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* limpieza */ }
  }
}

// Aplica las reglas INLINE_RULES a un texto de línea, devolviendo los reemplazos {gStart, gEnd, value}
function matchInlineReplacements(text, ctx) {
  const out = [];
  let scanPos = 0;
  let guard = 0;
  while (guard++ < 50) {
    let best = null;
    for (const rule of INLINE_RULES) {
      const mm = rule.re.exec(text);
      if (!mm || !mm[1]) continue;
      const gStart = mm.index + mm[0].indexOf(mm[1]);
      if (gStart < scanPos) continue;
      if (!best || gStart < best.gStart) best = { mm, gStart, gEnd: gStart + mm[1].length, key: rule.key };
    }
    if (!best) break;
    const value = ctx && ctx[best.key] ? String(ctx[best.key]) : '';
    const matched = text.slice(best.gStart, best.gEnd);
    if (value && value !== matched) out.push({ gStart: best.gStart, gEnd: best.gEnd, value });
    scanPos = best.gEnd;
  }
  return out;
}

// Asigna el equivalente de fuente estándar (Times/Arial...) para redibujar el texto reemplazado
const PDF_STANDARD_FONT_MAP = [
  [/TimesNewRoman.*Italic|Times.*Italic/i, 'TimesRomanItalic'],
  [/TimesNewRomanPS-BoldMT|Times.*Bold/i, 'TimesRomanBold'],
  [/TimesNewRoman|Times/i, 'TimesRoman'],
  [/Arial.*Bold|Helvetica.*Bold/i, 'HelveticaBold'],
  [/Arial.*Italic|Helvetica.*Oblique/i, 'HelveticaOblique'],
  [/Arial|Helvetica/i, 'Helvetica'],
  [/Courier.*Bold/i, 'CourierBold'],
  [/Courier/i, 'Courier']
];
function pdfFontFor(name) {
  const s = String(name || '');
  for (const [re, st] of PDF_STANDARD_FONT_MAP) if (re.test(s)) return st;
  return 'Helvetica';
}

// Limpia el texto para poder codificarlo con fuentes estándar (WinAnsi)
function pdfSafeText(s) {
  let t = String(s);
  if (/[^\x00-\xFF]/.test(t)) {
    t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    t = t.replace(/[^\x00-\xFF]/g, '');
  }
  return t;
}

function resolvePdfFontName(pageJs, fontName) {
  try {
    const fo = pageJs.commonObjs && pageJs.commonObjs.get(fontName);
    return fo ? (fo.name || '') : '';
  } catch (e) { return ''; }
}

// Devuelve los ítems de texto que cubren [s, e) en la línea
function collectReplItems(items, s, e) {
  let pos = 0;
  const covered = [];
  for (const it of items) {
    const start = pos;
    const end = pos + it.str.length;
    if (e <= start) break;
    if (end > start && s < end) covered.push(it);
    pos = end;
  }
  return covered;
}

// Devuelve los ítems (etiquetados con su línea) que cubren [s, e) en el texto de la página
function collectPageReplItems(lines, s, e) {
  const covered = [];
  for (const line of lines) {
    const ls = line.start;
    const le = ls + line.text.length;
    if (e <= ls) break;
    if (le > ls && s < le) {
      const a = Math.max(0, s - ls);
      const b = Math.min(line.text.length, Math.max(0, e - ls));
      for (const it of collectReplItems(line.items, a, b)) {
        it.__line = line;
        covered.push(it);
      }
    }
  }
  return covered;
}

// Reemplaza valores escritos en un PDF SIN campos de formulario (cartas pre-llenadas):
// localiza el texto con pdfjs, lo tapa con un rectángulo blanco y lo redibuja con la fuente del empleado.
async function fillPdfInline(tplBase64, ctx) {
  const pdfjsLib = require('pdfjs-dist');
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const bytes = Buffer.from(stripDataUrlPrefix(tplBase64), 'base64');
  const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  // Ruta a los 14 fuentes estándar de PDF (FoxitSerif, FoxitSans...) para que pdfjs pueda
  // extraer el texto de PDFs que usan esas fuentes sin incrustar.
  const stdFontDir = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts');
  const opts = { data: new Uint8Array(bytes), isEvalSupported: false };
  if (fs.existsSync(stdFontDir)) opts.standardFontDataUrl = stdFontDir + path.sep;
  const src = await pdfjsLib.getDocument(opts).promise;
  let filled = 0;
  try {
    for (let p = 1; p <= src.numPages; p++) {
      const pageJs = await src.getPage(p);
      const tc = await pageJs.getTextContent();
      // agrupar ítems en líneas por su posición Y
      const lines = [];
      for (const it of (tc.items || [])) {
        if (!it || typeof it.str !== 'string' || !it.str) continue;
        const y = it.transform ? it.transform[5] : 0;
        let line = null;
        for (const l of lines) if (Math.abs(l.y - y) < 0.75) { line = l; break; }
        if (!line) { line = { y, items: [] }; lines.push(line); }
        line.items.push(it);
      }
      // texto de la página: líneas unidas con \n (permite reglas multilínea con /m)
      let pageText = '';
      for (const line of lines) {
        line.items.sort((a, b) => (a.transform ? a.transform[4] : 0) - (b.transform ? b.transform[4] : 0));
        line.text = line.items.map((i) => i.str).join('');
        line.start = pageText.length;
        pageText += line.text + '\n';
      }
      const pageRepls = [];
      for (const r of matchInlineReplacements(pageText, ctx)) {
        const covered = collectPageReplItems(lines, r.gStart, r.gEnd);
        if (covered.length) pageRepls.push({ items: covered, value: r.value });
      }
      // Resolver las fuentes (commonObjs) para redibujar con la fuente equivalente
      try { await pageJs.getOperatorList(); } catch (e) { /* fuentes opcional */ }
      const plPage = pdfDoc.getPage(p - 1);
      for (const repl of pageRepls) {
        const safe = pdfSafeText(repl.value);
        if (!safe) continue;
        // agrupar ítems cubiertos por línea: tapar cada línea afectada y redibujar el valor en la primera
        const byLine = new Map();
        for (const it of repl.items) {
          if (!byLine.has(it.__line)) byLine.set(it.__line, []);
          byLine.get(it.__line).push(it);
        }
        const first = repl.items[0];
        const fontSize = (first.height || first.fontSize || 10);
        const font = await pdfDoc.embedFont(StandardFonts[pdfFontFor(resolvePdfFontName(pageJs, first.fontName))]);
        let drawn = false;
        for (const [line, its] of byLine) {
          let x0 = its[0].transform[4];
          let xMax = x0;
          for (const it of its) xMax = Math.max(xMax, it.transform[4] + (it.width || 0));
          plPage.drawRectangle({
            x: x0 - 0.5, y: line.y - fontSize * 0.3,
            width: xMax - x0 + 1, height: fontSize * 1.2,
            color: rgb(1, 1, 1)
          });
          if (!drawn) {
            plPage.drawText(safe, { x: x0, y: line.y, size: fontSize, font });
            drawn = true;
          }
        }
        filled++;
      }
    }
  } finally {
    try { src.destroy(); } catch (e) { /* noop */ }
  }
  if (!filled) {
    throw new Error('No se encontraron valores para reemplazar en el PDF. Use una plantilla Word (.docx) o un PDF generado desde la carta con esos datos.');
  }
  return { buffer: Buffer.from(await pdfDoc.save()), filled };
}

async function fillPdfForm(tplBase64, ctx) {
  const { PDFDocument } = require('pdf-lib');
  const pdfDoc = await PDFDocument.load(Buffer.from(stripDataUrlPrefix(tplBase64), 'base64'), { updateMetadata: false });
  const form = pdfDoc.getForm();
  const fields = form.getFields();
  if (!fields || !fields.length) {
    // PDF sin campos de formulario: reemplazo de texto directo
    return fillPdfInline(tplBase64, ctx);
  }
  let filled = 0;
  for (const f of fields) {
    const name = String(f.getName ? f.getName() : '').trim();
    const key = name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!key) continue;
    // El alias (clave canónica, ya formateada: salario_rd, fecha_ingreso_fmt, nombre_completo...) tiene prioridad
    let value = FIELD_ALIASES[key] ? ctx[FIELD_ALIASES[key]] : ctx[key];
    if (value == null) continue;
    value = String(value);
    const type = f.constructor ? f.constructor.name : '';
    try {
      if (type === 'PDFTextField') {
        form.getTextField(name).setText(value);
        filled++;
      } else if (type === 'PDFCheckBox') {
        const v = value.trim().toLowerCase();
        if (['si', 'sí', 'true', '1', 'x', 'check', 'marcado'].includes(v)) {
          form.getCheckBox(name).check();
          filled++;
        }
      } else if (type === 'PDFDropdown') {
        const dd = form.getDropdown(name);
        const opts = dd.getOptions().map(o => String(o).toLowerCase());
        const v = value.toLowerCase();
        if (opts.includes(v)) { dd.select(v); filled++; }
      } else if (type === 'PDFRadioGroup') {
        const rg = form.getRadioGroup(name);
        const opts = rg.getOptions().map(o => String(o).toLowerCase());
        const v = value.toLowerCase();
        if (opts.includes(v)) { rg.select(v); filled++; }
      }
    } catch (e) { /* campo no editable */ }
  }
  form.flatten();
  return { buffer: Buffer.from(await pdfDoc.save()), filled };
}

function buildCtx(emp, vacaciones) {
  const ctx = documentos.employeeCtx(emp);
  const s = documentos.getSettings();
  // Destinatario de la carta: banco o particular (el nombre que ponga el usuario).
  let dest = (s.doc_destinatario || '').trim();
  if (!dest) dest = (s.doc_banco || '').trim(); // compatibilidad con versiones anteriores
  ctx.banco = dest;
  ctx.empresa = (s.doc_company_name || '').trim();
  ctx.empresa_rnc = (s.doc_company_rnc || '').trim();
  ctx.empresa_tel = (s.doc_company_tel || '').trim();
  ctx.empresa_email = (s.doc_company_email || '').trim();
  ctx.empresa_direccion = (s.doc_company_address || '').trim();
  ctx.firma_nombre = (s.doc_firma_nombre || '').trim();
  ctx.firma_cargo = (s.doc_firma_cargo || '').trim();
  ctx.firma_celular = (s.doc_firma_celular || '').trim();
  ctx.vacaciones = (vacaciones || []).map(v => ({
    tipo: String(v.tipo || '').replace(/_/g, ' '),
    modalidad: String(v.modalidad || 'tomadas'),
    fecha_inicio: v.fecha_inicio || '',
    fecha_fin: v.fecha_fin || '',
    dias: v.dias || '',
    dias_pagados: v.dias_pagados || '',
    dias_guardados: v.dias_guardados || '',
    motivo: v.motivo || ''
  }));
  return ctx;
}

// kind: 'constancia' | 'carta' | 'solicitud'; fmt: 'pdf' | 'docx'
async function renderDoc(kind, emp, fmt, vacaciones) {
  const ctx = buildCtx(emp, vacaciones);
  // La carta de salario usa los mismos datos que la constancia; solo cambia el asunto.
  if (kind === 'carta') ctx.asunto = 'Carta de Salario';
  const tpl = getTemplateData(kind, fmt);
  const mode = tpl.mode || getDocMode(kind);

  if (mode === 'docx') {
    if (!tpl.base64) throw new Error('No hay plantilla Word configurada para este documento.');
    const docxBuf = renderDocxTemplate(tpl.base64, ctx);
    const zip = new PizZip(docxBuf);
    const filled = fillDocxLabels(zip, ctx);
    const finalBuf = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    const out = { format: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: finalBuf, name: tpl.name || 'documento.docx', filled };
    if (fmt === 'docx') return out;
    // PDF desde el MISMO modelo Word: LibreOffice si está disponible, si no render nativo.
    let buffer;
    try {
      buffer = docxToPdf(finalBuf);
    } catch (e) {
      buffer = await pdf.docxLetterToPdf(finalBuf);
    }
    return { ...out, format: 'pdf', mime: 'application/pdf', buffer };
  }

  if (mode === 'pdf_form') {
    if (!tpl.base64) throw new Error('No hay plantilla PDF configurada para este documento.');
    if (fmt !== 'pdf') throw new Error('Una plantilla PDF con campos solo genera PDF.');
    const r = await fillPdfForm(tpl.base64, ctx);
    return { format: 'pdf', mime: 'application/pdf', buffer: r.buffer, name: tpl.name || 'documento.pdf', filled: r.filled };
  }

  // mode 'generada' (PDF generado por el sistema) — solo como compatibilidad con bases antiguas
  if (kind === 'solicitud') throw new Error('La solicitud de cuenta de nómina usa la plantilla integrada del sistema. Configure el destinatario y la empresa en Sistema.');
  if (fmt !== 'pdf') throw new Error('Este documento se genera en PDF. Seleccione PDF para descargarlo.');
  const buffer = kind === 'constancia' ? await documentos.buildConstanciaPdf(emp) : await documentos.buildCartaSalarioPdf(emp);
  return { format: 'pdf', mime: 'application/pdf', buffer, name: 'documento.pdf' };
}

// Describe el modo actual para mostrarlo en la UI
function describe(kind) {
  const mode = getDocMode(kind);
  const tpl = getTemplateData(kind);
  if (mode === 'generada') return { mode, label: 'Documento generado (PDF)', file: '' };
  return { mode, label: mode === 'docx' ? 'Plantilla Word' : 'Plantilla PDF', file: tpl.name };
}

module.exports = { renderDoc, describe, findSoffice, TIPOS_DOC };
