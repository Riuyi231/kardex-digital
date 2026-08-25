const shared = require('./ai-shared');
const { SYSTEM_PROMPT, extractJson, buildFields, prepareImageDataUrl } = shared;

const API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const IMG_MAX_WIDTH = Number(process.env.AI_IMG_MAX_WIDTH || 700);

function isConfigured() {
  const key = (process.env.OPENAI_API_KEY || '').trim();
  return !!(key && key.startsWith('sk-'));
}

function apiKey() {
  const key = (process.env.OPENAI_API_KEY || '').trim();
  if (!key) throw new Error('No se encontró la clave OPENAI_API_KEY. Ejecute la app con la variable definida.');
  if (!key.startsWith('sk-')) {
    throw new Error('La clave OPENAI_API_KEY parece inválida. Debe empezar por "sk-". Vuelva a definirla y reinicie la app.');
  }
  return key;
}

async function extractCedulaWithAI({ front, back }) {
  const key = apiKey();

  const frontUrl = await prepareImageDataUrl(front, IMG_MAX_WIDTH);
  const content = [
    { type: 'text', text: 'Las imágenes siguientes son el frente y el reverso de una cédula dominicana. Extrae los datos y devuelve el JSON.' },
    { type: 'image_url', image_url: { url: frontUrl } }
  ];
  if (back) content.push({ type: 'image_url', image_url: { url: await prepareImageDataUrl(back, IMG_MAX_WIDTH) } });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);

  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 600
      }),
      signal: controller.signal
    });

    if (!resp.ok) {
      let message = `HTTP ${resp.status}`;
      const detail = await resp.text().catch(() => '');
      try {
        const errBody = JSON.parse(detail);
        if (errBody && errBody.error && errBody.error.message) message = errBody.error.message;
      } catch (e) { /* no es JSON */ }
      throw new Error(`Error de la API OpenAI (${resp.status}): ${message}`);
    }

    const data = await resp.json();
    if (data.error) {
      throw new Error(`Error de la API OpenAI: ${data.error.message || JSON.stringify(data.error)}`);
    }
    const raw = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    const parsed = extractJson(raw);
    if (!parsed) throw new Error('La IA no devolvió JSON válido');

    return { fields: buildFields(parsed), raw };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isConfigured, extractCedulaWithAI, normalizeCedula: shared.normalizeCedula };
