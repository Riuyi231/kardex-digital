const HEADER_PHRASES = [
  'REPÚBLICA DOMINICANA', 'REPUBLICA DOMINICANA',
  'CÉDULA DE IDENTIDAD Y ELECTORAL', 'CEDULA DE IDENTIDAD Y ELECTORAL',
  'JUNTA CENTRAL ELECTORAL', 'FIRMA DEL TITULAR'
];

const HEADER_KEYWORDS = [
  'REPUBLICA', 'REPÚBLICA', 'CEDULA', 'CÉDULA', 'IDENTIDAD', 'ELECTORAL', 'JUNTA',
  'CENTRAL', 'SEXO', 'FECHA', 'NACIMIENTO', 'NACIONALIDAD', 'ESTADO', 'CIVIL',
  'PROFESION', 'PROFESIÓN', 'OCUPACION', 'OCUPACIÓN', 'PADRE', 'MADRE', 'EMISION',
  'EMISIÓN', 'VENCIMIENTO', 'NOMBRE', 'APELLIDOS', 'FIRMA', 'TITULAR',
  'LUGAR', 'NUMERO', 'NÚMERO'
];

const FIELD_DEFS = [
  { key: 'fecha_nacimiento', label: 'FECHA DE NACIMIENTO' },
  { key: 'lugar_nacimiento', label: 'LUGAR DE NACIMIENTO' },
  { key: 'nacionalidad', label: 'NACIONALIDAD' },
  { key: 'estado_civil', label: 'ESTADO CIVIL' },
  { key: 'profesion', label: 'PROFESIÓN U OCUPACIÓN' },
  { key: 'fecha_vencimiento', label: 'FECHA DE VENCIMIENTO' }
];

const KNOWN_SHORT = new Set(['DE', 'LA', 'LOS', 'LAS', 'DEL', 'EL', 'EN', 'Y', 'AL', 'SAN']);

const MESES = {
  ENERO: '01', FEBRERO: '02', MARZO: '03', ABRIL: '04', MAYO: '05', JUNIO: '06',
  JULIO: '07', AGOSTO: '08', SEPTIEMBRE: '09', OCTUBRE: '10', NOVIEMBRE: '11', DICIEMBRE: '12'
};

const LABEL_DEFS = [
  { key: 'nombres', labels: ['NOMBRE Y APELLIDOS', 'NOMBRES', 'NOMBRE'] },
  { key: 'apellidos', labels: ['APELLIDOS', 'APELLIDO'] },
  { key: 'nacionalidad', labels: ['NACIONALIDAD'] },
  { key: 'fecha_nacimiento', labels: ['FECHA DE NACIMIENTO', 'FECHA NACIMIENTO'] },
  { key: 'lugar_nacimiento', labels: ['LUGAR DE NACIMIENTO', 'LUGAR NACIMIENTO'] },
  { key: 'estado_civil', labels: ['ESTADO CIVIL'] },
  { key: 'sexo', labels: ['SEXO'] },
  { key: 'profesion', labels: ['OCUPACION U OFICIO', 'OCUPACION Y OFICIO', 'PROFESION U OCUPACION', 'PROFESION U OFICIO', 'OCUPACION', 'PROFESION'] },
  { key: 'fecha_vencimiento', labels: ['FECHA DE VENCIMIENTO', 'FECHA VENCIMIENTO'] }
];

function stripAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normLabel(s) {
  return stripAccents(String(s || '')).toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const long = a.length >= b.length ? a : b;
  if (long.length === 0) return 1;
  return 1 - levenshtein(a, b) / long.length;
}

function findFuzzyIndex(hay, needle, maxErr) {
  hay = stripAccents(String(hay || '')).toUpperCase();
  needle = stripAccents(String(needle || '')).toUpperCase();
  if (!needle) return -1;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    const win = hay.slice(i, i + needle.length);
    if (levenshtein(win, needle) <= maxErr) return i;
  }
  return -1;
}

function findLabelRegex(label) {
  const unaccented = stripAccents(label).replace(/\s+/g, '\\s*');
  const accented = label.replace(/\s+/g, '\\s*');
  return new RegExp(`(?:${accented}|${unaccented})\\s*[:\\-]?\\s*`, 'i');
}

FIELD_DEFS.forEach((d) => { d.re = findLabelRegex(d.label); });

function cleanText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function isCedulaLine(line) {
  return /^\d{3}[-.\s]?\d{7}[-.\s]?\d$/.test(line);
}

function findCedula(text) {
  const re = /(\d{3})\s*[-.\s]?\s*(\d{7})\s*[-.\s]?\s*(\d)/g;
  const candidates = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    candidates.push(`${m[1]}-${m[2]}-${m[3]}`);
  }
  return candidates.length ? candidates[0] : '';
}

function pad2(v) {
  return String(v).padStart(2, '0');
}

function normYear(y) {
  const yy = String(y);
  if (yy.length === 2) return (yy > '30' ? '19' : '20') + yy;
  return yy;
}

function normalizeDate(raw) {
  if (!raw) return '';
  const t = String(raw).trim();
  let m = t.match(/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{2,4})/);
  if (m) return `${pad2(m[1])}/${pad2(m[2])}/${normYear(m[3])}`;
  m = t.match(/\b(\d{1,2})\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(\d{4})\b/i);
  if (m) return `${pad2(m[1])}/${MESES[m[2].toUpperCase()]}/${m[3]}`;
  return t;
}

function extractDateText(text) {
  const t = String(text || '').trim();
  let m = t.match(/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{2,4})/);
  if (m) return `${pad2(m[1])}/${pad2(m[2])}/${normYear(m[3])}`;
  m = t.match(/\b(\d{1,2})\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(\d{4})\b/i);
  if (m) return `${pad2(m[1])}/${MESES[m[2].toUpperCase()]}/${m[3]}`;
  return '';
}

function splitName(full) {
  if (!full) return { nombres: '', apellidos: '' };
  const tokens = full.trim().split(/\s+/);
  if (tokens.length === 1) return { nombres: tokens[0], apellidos: '' };
  if (tokens.length === 2) return { nombres: tokens[0], apellidos: tokens[1] };
  return { nombres: tokens.slice(0, -2).join(' '), apellidos: tokens.slice(-2).join(' ') };
}

function isHeaderLine(line) {
  const upper = stripAccents(line).toUpperCase();
  if (HEADER_PHRASES.some((p) => upper.includes(stripAccents(p).toUpperCase()))) return true;
  if (/SEXO\s*[:.]?\s*[FMO]?\s*$/.test(upper) && /SEXO/.test(upper)) return true;
  const words = upper.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.every((w) => HEADER_KEYWORDS.includes(w))) return true;
  return false;
}

function isLikelyNameLine(line) {
  if (!line) return false;
  if (line.length < 3 || line.length > 80) return false;
  if (isCedulaLine(line)) return false;
  const words = line.split(/\s+/);
  const alphaWords = words.filter((w) => /^[A-ZÁÉÍÓÚÜÑ]{2,}$/.test(stripAccents(w).toUpperCase()));
  if (alphaWords.length < 2) return false;
  if (isHeaderLine(line)) return false;
  return true;
}

function findSexo(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = stripAccents(lines[i]).toUpperCase();
    if (!line.includes('SEXO')) continue;
    const m = line.match(/SEXO\s*[:.]?\s*([FMO])/);
    if (m) return m[1];
    const next = stripAccents(lines[i + 1] || '').toUpperCase();
    const m2 = next.match(/^\s*([FMO])\s*$/);
    if (m2) return m2[1];
  }
  return '';
}

/* ======================== Extracción geométrica con words ======================== */

function linesFromWords(words) {
  if (!words || !words.length) return [];
  const ws = words.slice().sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));
  const lines = [];
  for (const w of ws) {
    let placed = false;
    for (const line of lines) {
      const cy = (line.y0 + line.y1) / 2;
      const wy = (w.y0 + w.y1) / 2;
      if (Math.abs(wy - cy) <= 7) {
        line.words.push(w);
        line.x0 = Math.min(line.x0, w.x0);
        line.x1 = Math.max(line.x1, w.x1);
        line.y0 = Math.min(line.y0, w.y0);
        line.y1 = Math.max(line.y1, w.y1);
        placed = true;
        break;
      }
    }
    if (!placed) {
      lines.push({ words: [w], x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1 });
    }
  }
  for (const line of lines) {
    line.words.sort((a, b) => a.x0 - b.x0);
    line.text = line.words.map((w) => w.text).join(' ');
  }
  return lines;
}

function bestLabelMatch(line) {
  let best = null;
  const n = normLabel(line.text);
  for (const def of LABEL_DEFS) {
    if ((def.key === 'nombres' || def.key === 'apellidos') && /NOMBRE|APELLIDO/.test(n) && /PADRE|MADRE/.test(n)) continue;
    for (const lbl of def.labels) {
      let sim = 0;
      if (n === lbl || n.startsWith(lbl)) sim = 1;
      else {
        const maxErr = lbl.length >= 12 ? 2 : 1;
        if (findFuzzyIndex(n, lbl, maxErr) === 0) sim = 0.92;
        else if (n.length >= 3) sim = similarity(n, lbl);
      }
      if (sim >= 0.75 && (!best || sim > best.sim || (sim === best.sim && lbl.length > best.lbl.length))) {
        best = { key: def.key, sim, lbl, n };
      }
    }
  }
  return best;
}

function extractValueFromWords(words, key) {
  if (!words || !words.length) return '';
  if (key === 'fecha_nacimiento' || key === 'fecha_vencimiento') {
    const text = words.map((w) => w.text).join(' ');
    return extractDateText(text);
  }
  if (key === 'sexo') {
    const w = words.filter((x) => x.conf >= 60).find((x) => /^[FMO]$/i.test(x.text));
    return w ? w.text.toUpperCase() : '';
  }
  const good = words
    .slice()
    .sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0))
    .filter((w) => w.conf >= 40)
    .map((w) => {
      const bare = w.text.replace(/[^A-ZÁÉÍÓÚÜÑ]/gi, '').toUpperCase();
      return bare.length >= 2 && (bare.length >= 3 || KNOWN_SHORT.has(bare)) ? bare : '';
    })
    .filter(Boolean);
  if (!good.length) return '';
  const max = key === 'nombres' || key === 'apellidos' ? 8 : key === 'lugar_nacimiento' ? 6 : 4;
  return good.slice(0, max).join(' ');
}

function parseSexoEstadoFromLine(line) {
  const n = normLabel(line.text);
  const words = line.words.slice().sort((a, b) => a.x0 - b.x0);
  const result = {};
  if (/SEXO/.test(n)) {
    let m = /SEXO\s*:?\s*([FMO])/i.exec(n);
    if (!m) {
      const w = words.find((x) => x.conf >= 60 && /^[FMO]$/i.test(x.text));
      if (w) m = [null, w.text];
    }
    if (m) result.sexo = m[1].toUpperCase();
  }
  if (/ESTADO\s*CIVIL/.test(n)) {
    let m = /ESTADO\s*CIVIL\s*:?\s*([A-Z]+(?:\s+[A-Z]+){0,2})/.exec(n);
    if (m) {
      const val = m[1].trim();
      if (val && !/^(?:SEXO|MASCULINO|FEMENINO)$/.test(val)) result.estado_civil = val;
    }
  }
  return result;
}

function cleanInlineValue(rest, key) {
  if (!rest) return '';
  if (key === 'fecha_nacimiento' || key === 'fecha_vencimiento') {
    return extractDateText(rest);
  }
  if (key === 'sexo') {
    const m = rest.match(/[FMO]/i);
    return m ? m[0].toUpperCase() : '';
  }
  return cleanAlphaValue(rest);
}

function extractLabeledFields(front, back) {
  const result = {};
  const pages = [
    { name: 'front', words: (front && front.words) || [] },
    { name: 'back', words: (back && back.words) || [] }
  ];

  const matched = [];
  const usedLines = new Set();
  for (const page of pages) {
    const lines = linesFromWords(page.words);
    for (const line of lines) {
      const n = normLabel(line.text);
      if (/SEXO/.test(n) || /ESTADO\s*CIVIL/.test(n)) {
        const inline = parseSexoEstadoFromLine(line);
        let got = false;
        if (inline.sexo && !result.sexo) { result.sexo = inline.sexo; got = true; }
        if (inline.estado_civil && !result.estado_civil) { result.estado_civil = inline.estado_civil; got = true; }
        if (got) {
          usedLines.add(line);
          continue;
        }
      }
      const m = bestLabelMatch(line);
      if (!m) continue;
      if (usedLines.has(line)) continue;
      usedLines.add(line);
      matched.push({ key: m.key, sim: m.sim, lbl: m.lbl, line, page });
    }
  }

  for (const page of pages) {
    const pageWidth = page.words.length ? Math.max(...page.words.map((w) => w.x1)) : 0;
    const pageMatches = matched.filter((m) => m.page === page).sort((a, b) => a.line.y0 - b.line.y0);
    for (let i = 0; i < pageMatches.length; i++) {
      const m = pageMatches[i];
      const labelLine = m.line;
      let value = cleanInlineValue(valueAfterLabel(labelLine.text, m.lbl), m.key);
      if (!value) {
        const labelWords = new Set(labelLine.words);
        const nextY = i + 1 < pageMatches.length ? pageMatches[i + 1].line.y0 : Infinity;
        const xMax = labelLine.x0 + Math.max(150, pageWidth * 0.4);
        const region = page.words.filter((w) =>
          !labelWords.has(w) &&
          w.y0 >= labelLine.y1 - 12 &&
          w.y0 < nextY &&
          w.x0 >= labelLine.x0 - 15 &&
          w.x0 <= xMax
        );
        value = extractValueFromWords(region, m.key);
      }
      if (value && !result[m.key]) result[m.key] = value;
    }
  }

  if (!result.nombres && !result.apellidos) {
    for (const page of pages) {
      const lines = linesFromWords(page.words);
      for (const line of lines) {
        const n = normLabel(line.text);
        if (/PADRE|MADRE/.test(n)) continue;
        if (isLikelyNameLine(line.text) && !bestLabelMatch(line)) {
          const cleaned = line.text.split(/\s+/).map((w) => w.replace(/[^A-ZÁÉÍÓÚÜÑ]/gi, '')).filter((w) => w.length >= 2).join(' ');
          if (cleaned) {
            const spl = splitName(cleaned);
            result.nombres = spl.nombres;
            result.apellidos = spl.apellidos;
            break;
          }
        }
      }
      if (result.nombres || result.apellidos) break;
    }
  }

  return result;
}

/* ======================== Fallback basado en texto ======================== */

function findLabelLine(lines, def) {
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    const n = normLabel(lines[i]);
    for (const lbl of def.labels) {
      if (n === lbl) return { index: i, sim: 1, lbl, n };
      if (n.length >= 3) {
        const sim = similarity(n, lbl);
        if (sim >= 0.75 && (!best || sim > best.sim)) best = { index: i, sim, lbl, n };
      }
    }
  }
  return best;
}

function cleanAlphaValue(raw) {
  const tokens = stripAccents(String(raw || ''))
    .toUpperCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean);
  let best = [];
  let cur = [];
  for (const t of tokens) {
    if ((t.length >= 3 || KNOWN_SHORT.has(t)) && !/^\d+$/.test(t)) {
      cur.push(t);
      if (cur.length > best.length || (cur.length === best.length && cur.join(' ').length > best.join(' ').length)) {
        best = cur.slice();
      }
    } else {
      cur = [];
    }
  }
  return best.join(' ');
}

function valueAfterLabel(lineText, lbl) {
  const idx = findFuzzyIndex(lineText, lbl, lbl.length >= 12 ? 2 : 1);
  if (idx === -1) return '';
  return stripAccents(String(lineText || '')).slice(idx + lbl.length).replace(/^[\s:.\-—]+/, '').trim();
}

function extractNextValue(lines, def) {
  const m = findLabelLine(lines, def);
  if (!m) return '';
  const raw = lines[m.index];
  const rest = valueAfterLabel(raw, m.lbl);
  if (rest) return rest;
  for (let j = m.index + 1; j < lines.length; j++) {
    const next = lines[j];
    if (isHeaderLine(next)) continue;
    if (FIELD_DEFS.some((d) => d.re.test(next))) break;
    if (isCedulaLine(next)) continue;
    return next;
  }
  return '';
}

function fillFromText(fields, lines, isFront) {
  for (const def of LABEL_DEFS) {
    if (fields[def.key]) continue;
    const val = extractNextValue(lines, def);
    if (!val) continue;
    if (def.key === 'nombres' || def.key === 'apellidos') {
      const cleaned = cleanAlphaValue(val);
      if (cleaned) {
        if (def.key === 'nombres') fields.nombres = cleaned;
        else fields.apellidos = cleaned;
      }
    } else if (def.key === 'sexo') {
      const m = val.match(/[FMO]/);
      if (m) fields.sexo = m[0];
    } else if (def.key === 'fecha_nacimiento' || def.key === 'fecha_vencimiento') {
      const d = extractDateText(val);
      if (d) fields[def.key] = d;
    } else {
      const cleaned = cleanAlphaValue(val);
      if (cleaned) fields[def.key] = cleaned;
    }
  }
}

/* ======================== MRZ ======================== */

function checkDigitValid(digits) {
  if (!/^\d{11}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const d = +digits[i];
    let p = d * (i % 2 === 0 ? 1 : 2);
    if (p > 9) p -= 9;
    sum += p;
  }
  return (10 - (sum % 10)) % 10 === +digits[10];
}

function mrzDate(yyMMDD, kind) {
  if (!/^\d{6}$/.test(yyMMDD)) return '';
  const dd = yyMMDD.slice(4, 6);
  const mm = yyMMDD.slice(2, 4);
  if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return '';
  let yy = +yyMMDD.slice(0, 2);
  if (kind === 'expiry') {
    yy += 2000;
  } else {
    yy = 2000 + yy > new Date().getFullYear() ? 1900 + yy : 2000 + yy;
  }
  return `${dd}/${mm}/${yy}`;
}

function hasMrz(text) {
  const t = String(text || '');
  if (/ID\s*<?\s*DOM/i.test(t)) return true;
  if (t.includes('<<') && /[A-ZÁÉÍÓÚÜÑ]{2,}<{2}[A-ZÁÉÍÓÚÜÑ]/.test(t)) return true;
  return /(\d{6})\d?[MF](\d{6})\d?/i.test(t);
}

function parseMrz(frontText, backText) {
  const combined = `${frontText || ''}\n${backText || ''}`;
  const lines = combined.split('\n').map((l) => l.trim()).filter((l) => l.length >= 5);
  const mrzLines = lines.filter((l) => l.includes('<') && (l.includes('<<') || /ID\s*DOM/i.test(l) || /^[A-Z0-9]{2,10}<{1,3}/.test(l)));
  if (mrzLines.length === 0) return null;
  const block = mrzLines.join('\n');
  const result = {};

  const candidates = [];
  for (const line of mrzLines) {
    for (const seg of line.split('<')) {
      const digits = seg.replace(/[^0-9]/g, '');
      if (digits.length < 11) continue;
      if (digits.length === 11) candidates.push({ s: digits, exact: true });
      else for (let i = 0; i + 11 <= digits.length; i++) candidates.push({ s: digits.slice(i, i + 11), exact: false });
    }
  }
  const match = candidates.find((c) => c.exact && checkDigitValid(c.s)) ||
                candidates.find((c) => checkDigitValid(c.s));
  if (match) {
    const s = match.s;
    result.cedula = `${s.slice(0, 3)}-${s.slice(3, 10)}-${s.slice(10)}`;
  }

  const NAME_LINE_RE = /^[A-ZÁÉÍÓÚÜÑ]+(<[A-ZÁÉÍÓÚÜÑ]+)*<<[A-ZÁÉÍÓÚÜÑ]+(<[A-ZÁÉÍÓÚÜÑ]+)*$/;
  const nameLine = mrzLines
    .map((l) => l.replace(/[^A-ZÁÉÍÓÚÜÑ<]/gi, '').toUpperCase())
    .find((l) => NAME_LINE_RE.test(l));
  if (nameLine) {
    const parts = nameLine.split('<<');
    const primary = (parts[0] || '').replace(/</g, ' ').trim();
    const secondary = (parts[1] || '').replace(/</g, ' ').trim();
    if (primary) result.apellidos = primary;
    if (secondary) result.nombres = secondary;
  }

  const dm = block.match(/(\d{6})\d?([MF])(\d{6})\d?/i);
  if (dm) {
    result.sexo = dm[2].toUpperCase();
    const birth = mrzDate(dm[1], 'birth');
    if (birth) result.fecha_nacimiento = birth;
    const expiry = mrzDate(dm[3], 'expiry');
    if (expiry) result.fecha_vencimiento = expiry;
  }

  if (/DOM/.test(block.toUpperCase())) result.nacionalidad = 'DOMINICANA';

  return result;
}

/* ======================== Orquestador ======================== */

function normalizeInput(x) {
  if (typeof x === 'string') return { text: x, words: [] };
  return { text: (x && x.text) ? x.text : '', words: (x && x.words) || [] };
}

function parseCedula(frontInput, backInput) {
  const front = normalizeInput(frontInput);
  const back = normalizeInput(backInput);
  const frontText = front.text || '';
  const backText = back.text || '';
  const combined = `${frontText}\n${backText}`;
  const frontLines = cleanText(frontText);
  const backLines = cleanText(backText);
  const allLines = [...frontLines, ...backLines];

  const fields = {
    cedula: '', nombres: '', apellidos: '', sexo: '',
    fecha_nacimiento: '', nacionalidad: '', lugar_nacimiento: '', estado_civil: '',
    profesion: '',
    fecha_vencimiento: ''
  };

  Object.assign(fields, extractLabeledFields(front, back));
  fillFromText(fields, frontLines, true);
  fillFromText(fields, backLines, false);

  if (!fields.cedula) fields.cedula = findCedula(combined);
  if (!fields.sexo) fields.sexo = findSexo(allLines);

  if (!fields.nombres && !fields.apellidos) {
    const nameLines = frontLines.filter(isLikelyNameLine);
    if (nameLines.length) {
      const spl = splitName(nameLines[0]);
      fields.nombres = spl.nombres;
      fields.apellidos = spl.apellidos;
    }
  }

  if (fields.estado_civil) fields.estado_civil = fields.estado_civil.replace(/\s*\(?A\)?\s*$/i, '').trim();

  for (const key of ['fecha_nacimiento', 'fecha_vencimiento']) {
    if (fields[key]) fields[key] = normalizeDate(fields[key]);
  }

  const mrz = parseMrz(frontText, backText);
  if (mrz) {
    if (mrz.cedula) fields.cedula = mrz.cedula;
    if (mrz.sexo) fields.sexo = mrz.sexo;
    if (mrz.fecha_nacimiento) fields.fecha_nacimiento = mrz.fecha_nacimiento;
    if (mrz.fecha_vencimiento) fields.fecha_vencimiento = mrz.fecha_vencimiento;
    if (mrz.nacionalidad && !fields.nacionalidad) fields.nacionalidad = mrz.nacionalidad;
    if (!fields.nombres && mrz.nombres) fields.nombres = mrz.nombres;
    if (!fields.apellidos && mrz.apellidos) fields.apellidos = mrz.apellidos;
  }

  return fields;
}

module.exports = { parseCedula, findCedula, normalizeDate, splitName, parseMrz, hasMrz };
