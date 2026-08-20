const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m || m[1] === '') continue;
        let value = m[2].replace(/^["']|["']$/g, '').trim();
        if (value) process.env[m[1]] = value;
      }
    }
  } catch (e) { /* .env opcional */ }
}

loadEnvFile();

const FIELD_KEYS = [
  'cedula', 'nombres', 'apellidos', 'sexo', 'fecha_nacimiento', 'lugar_nacimiento',
  'nacionalidad', 'estado_civil', 'profesion',
  'fecha_vencimiento'
];

const SYSTEM_PROMPT = `Eres un sistema de extracción de datos de la cédula de identidad y electoral dominicana (frente y reverso).
Extrae TODOS los campos legibles de las imágenes. Si un campo no es legible o no aparece, devuélvelo como cadena vacía.
Devuelve SOLO JSON válido (sin markdown, sin comentarios) con esta estructura exacta:
{"cedula":"","nombres":"","apellidos":"","sexo":"","fecha_nacimiento":"","lugar_nacimiento":"","nacionalidad":"","estado_civil":"","profesion":"","fecha_vencimiento":""}
Reglas:
- cedula: formato 000-0000000-0. Si la secuencia de 11 dígitos aparece sin guiones, formátala.
- fechas: formato DD/MM/AAAA.
- nombres y apellidos: tal como aparecen impresos, en mayúsculas (apellidos primero, como en la cédula).
- sexo: "Masculino" o "Femenino" (o M/F si solo aparece la letra).
- estado_civil: "Soltero(a)", "Casado(a)", "Divorciado(a)", "Viudo(a)" o "Unión libre".
- nacionalidad: normalmente "DOMINICANA".
No inventes datos: si no estás seguro de un valor, déjalo vacío.`;

function normalizeCedula(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}`;
  return String(raw || '').trim();
}

function extractJson(text) {
  const t = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = t.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(t.slice(start, i + 1));
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

function buildFields(parsed) {
  const fields = {};
  for (const key of FIELD_KEYS) fields[key] = String(parsed[key] == null ? '' : parsed[key]).trim();
  fields.cedula = normalizeCedula(fields.cedula);
  return fields;
}

async function prepareImageDataUrl(dataUrl, maxWidth) {
  try {
    const { loadImage, createCanvas } = require('./canvas');
    const img = await loadImage(dataUrl);
    if (!img.width || !img.height) return dataUrl;
    const scale = Math.min(1, maxWidth / img.width);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const buf = canvas.toBuffer('image/jpeg', { quality: 82 });
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (e) {
    return dataUrl;
  }
}

module.exports = { FIELD_KEYS, SYSTEM_PROMPT, normalizeCedula, extractJson, buildFields, prepareImageDataUrl };
