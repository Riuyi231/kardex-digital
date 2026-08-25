const shared = require('./ai-shared');
const { SYSTEM_PROMPT, extractJson, buildFields, prepareImageDataUrl } = shared;

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const IMG_MAX_WIDTH = Number(process.env.AI_IMG_MAX_WIDTH || 700);

function isConfigured() {
  return !!(process.env.GEMINI_API_KEY || '').trim();
}

function apiKey() {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) {
    throw new Error('No se encontró la clave GEMINI_API_KEY. Sácala gratis en https://aistudio.google.com/apikey, pégala en el archivo .env y reinicie la app.');
  }
  return key;
}

function splitDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) throw new Error('Imagen en formato inválido (no es un data URL base64)');
  return { mimeType: m[1], data: m[2] };
}

function parseRetryDelay(data) {
  try {
    const details = data && data.error && data.error.details;
    if (Array.isArray(details)) {
      for (const d of details) {
        if (d && typeof d.retryDelay === 'string') {
          const s = parseFloat(d.retryDelay);
          if (isFinite(s)) return Math.min(45000, Math.max(1000, Math.round(s * 1000)));
        }
      }
    }
    const msg = data && data.error && data.error.message;
    if (msg) {
      const m = String(msg).match(/retry in ([0-9.]+)s/i);
      if (m) return Math.min(45000, Math.max(1000, Math.round(parseFloat(m[1]) * 1000)));
    }
  } catch (e) { /* sin espera conocida */ }
  return 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function extractCedulaWithGemini({ front, back }) {
  const key = apiKey();

  const parts = [
    { text: 'Las imágenes siguientes son el frente y el reverso de una cédula dominicana. Extrae los datos y devuelve el JSON.' }
  ];
  for (const img of [front, back]) {
    if (!img) continue;
    const prepared = await prepareImageDataUrl(img, IMG_MAX_WIDTH);
    const { mimeType, data } = splitDataUrl(prepared);
    parts.push({ inline_data: { mime_type: mimeType, data } });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);

  try {
    const MAX_ATTEMPTS = 3;
    let lastErr = null;
    let retryWait = 0;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const wait = retryWait > 0 ? retryWait : Math.min(30000, 2000 * Math.pow(2, attempt - 1));
        await sleep(wait);
      }
      retryWait = 0;
      try {
        const resp = await fetch(`${API_URL}/${MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            generationConfig: { temperature: 0, responseMimeType: 'application/json' }
          }),
          signal: controller.signal
        });

        const data = await resp.json().catch(() => null);

        if (!resp.ok) {
          const message = data && data.error && data.error.message ? data.error.message : `HTTP ${resp.status}`;
          const err = new Error(`Error de la API Gemini (${resp.status}): ${message}`);
          if (resp.status === 429) {
            retryWait = parseRetryDelay(data);
            lastErr = err;
            continue;
          }
          if (resp.status === 500 || resp.status === 503) {
            lastErr = err;
            continue;
          }
          throw err;
        }
        if (data.error) {
          throw new Error(`Error de la API Gemini: ${data.error.message || JSON.stringify(data.error)}`);
        }

        const raw = (data.candidates && data.candidates[0] && data.candidates[0].content &&
          data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
          data.candidates[0].content.parts[0].text) || '';
        const parsed = extractJson(raw);
        if (!parsed) throw new Error('La IA no devolvió JSON válido');

        return { fields: buildFields(parsed), raw };
      } catch (e) {
        if (e && (e.name === 'AbortError')) throw new Error('La petición a Gemini tardó demasiado. Inténtelo de nuevo.');
        lastErr = e;
      }
    }
    throw lastErr || new Error('No se pudo completar la extracción con Gemini');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isConfigured, extractCedulaWithGemini };
