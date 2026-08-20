'use strict';
const { app, BrowserWindow, ipcMain, dialog, Notification, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const XLSX = require('xlsx');
const db = require('./services/db');
const whatsapp = require('./services/whatsapp');
const license = require('./services/license');
const syncSvc = require('./services/sync');
const { autoUpdater } = require('electron-updater');

let win;

const LOG_PATH = path.join(app.getPath('appData'), 'NexAlert', 'debug.log');
function dbg(msg) {
  try { fs.appendFileSync(LOG_PATH, new Date().toISOString() + ' ' + String(msg) + '\n'); } catch (_) {}
}

const STABLE_USERDATA = path.join(app.getPath('appData'), 'NexAlert');

function migrateLegacyData() {
  const targetData = path.join(STABLE_USERDATA, 'data');
  const targetDb = path.join(targetData, 'reportes.db');
  const candidates = [
    path.join(app.getPath('appData'), 'reportes-equipos'),
    path.join(app.getPath('appData'), 'REPORTES')
  ];
  for (const src of candidates) {
    const srcDb = path.join(src, 'data', 'reportes.db');
    if (!fs.existsSync(targetDb) && fs.existsSync(srcDb)) {
      fs.mkdirSync(targetData, { recursive: true });
      fs.copyFileSync(srcDb, targetDb);
      console.log('Migrada la base de datos desde ' + srcDb);
    }
  }
}

migrateLegacyData();
app.setPath('userData', STABLE_USERDATA);
if (process.platform === 'win32') app.setAppUserModelId('com.nexus.nexalert');

function dataDir() {
  return path.join(app.getPath('userData'), 'data');
}

function adjuntosDir() {
  return path.join(app.getPath('userData'), 'adjuntos');
}

global.__nexalertAdjuntos = adjuntosDir();

function waMediaDir() {
  return path.join(app.getPath('userData'), 'wa_media');
}

function dedupeMediaFiles() {
  try {
    if (db.getSetting('media_dedupe', '')) return;
    const dir = waMediaDir();
    if (!fs.existsSync(dir)) { db.setSetting('media_dedupe', '1'); return; }
    const archivos = fs.readdirSync(dir).filter((f) => /^wm_/.test(f));
    const seen = new Map();
    let borrados = 0;
    for (const f of archivos) {
      const p = path.join(dir, f);
      let st;
      try { st = fs.statSync(p); } catch (e) { continue; }
      if (st.size > 150 * 1024 * 1024) continue;
      const hash = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      const canon = seen.get(hash);
      if (!canon) { seen.set(hash, f); continue; }
      db.run('UPDATE wa_mensajes SET media_archivo = ? WHERE media_archivo = ?', [canon, f]);
      try { fs.unlinkSync(p); } catch (e) { /* noop */ }
      borrados += 1;
    }
    db.setSetting('media_dedupe', '1');
    if (borrados) console.log('Deduplicados ' + borrados + ' archivos de media.');
  } catch (e) { /* noop */ }
}

function adjuntosMime(name) {
  const m = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
    '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
    '.wav': 'audio/wav', '.amr': 'audio/amr', '.aac': 'audio/aac', '.pdf': 'application/pdf'
  };
  return m[path.extname(name).toLowerCase()] || 'application/octet-stream';
}

function guardarAdjuntos(nuevosPaths, eliminadosNombres, existentesNombres) {
  const dir = adjuntosDir();
  fs.mkdirSync(dir, { recursive: true });
  const result = (existentesNombres || []).slice();
  for (const p of eliminadosNombres || []) {
    if (!/^[A-Za-z0-9._@-]+$/.test(String(p))) continue;
    try { fs.unlinkSync(path.join(dir, p)); } catch (e) { /* noop */ }
    const idx = result.indexOf(p);
    if (idx >= 0) result.splice(idx, 1);
  }
  for (const p of nuevosPaths || []) {
    if (!p || typeof p !== 'string') continue;
    try {
      const base = path.basename(p).replace(/[^A-Za-z0-9._-]/g, '_') || 'foto';
      const name = 'a' + Date.now() + '_' + Math.floor(Math.random() * 1000) + '_' + base;
      fs.copyFileSync(p, path.join(dir, name));
      result.push(name);
    } catch (e) { /* noop */ }
  }
  return result;
}

function hacerBackup() {
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 14);
  const dest = path.join(dir, 'reportes-' + stamp + '.db');
  fs.copyFileSync(path.join(app.getPath('userData'), 'data', 'reportes.db'), dest);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
  while (files.length > 30) fs.unlinkSync(path.join(dir, files.shift()));
  return dest;
}

const ESTADO_LABEL = { abierto: 'Abierto', en_proceso: 'En proceso', resuelto: 'Resuelto', espera_repuesto: 'Espera de repuesto', espera_cliente: 'Espera del cliente' };
const ESTADOS_VALIDOS = ['abierto', 'en_proceso', 'resuelto', 'espera_repuesto', 'espera_cliente'];
const PRIO_LABEL = { baja: 'Baja', normal: 'Normal', urgente: 'Urgente' };

function addReporteEvent(reporteId, tipo, detalle) {
  db.run('INSERT INTO reporte_eventos (reporte_id, tipo, detalle, creado) VALUES (?,?,?,?)',
    [reporteId, tipo, detalle, db.nowDateTime()]);
}

function getReporteEquipos(reporteId) {
  return db.all(`SELECT re.equipo_id AS id, e.nombre, e.marca, e.modelo, e.serial, e.ubicacion
    FROM reporte_equipos re JOIN equipos e ON e.id = re.equipo_id
    WHERE re.reporte_id = ?`, [reporteId]);
}

function attachEquipos(rows) {
  const pairs = db.all(`SELECT re.reporte_id AS rid, e.id, e.nombre
    FROM reporte_equipos re JOIN equipos e ON e.id = re.equipo_id`);
  const map = {};
  for (const p of pairs) (map[p.rid] = map[p.rid] || []).push({ id: p.id, nombre: p.nombre });
  for (const r of rows) {
    const arr = map[r.id] || [];
    if (!arr.length && r.equipo_id && r.equipo_nombre) arr.push({ id: r.equipo_id, nombre: r.equipo_nombre });
    r.equipos = arr;
  }
  return rows;
}

function syncReporteEquipos(reporteId, clientId, ids) {
  db.run('DELETE FROM reporte_equipos WHERE reporte_id = ?', [reporteId]);
  for (const eid of ids) {
    if (db.get('SELECT id FROM equipos WHERE id = ? AND client_id = ?', [eid, clientId])) {
      db.run('INSERT INTO reporte_equipos (reporte_id, equipo_id) VALUES (?,?)', [reporteId, eid]);
    }
  }
}

function applyEstado(id, estado) {
  const prev = db.get('SELECT estado, resuelto_at FROM reportes WHERE id = ?', [id]);
  if (!prev) return;
  let rAt = null;
  if (estado === 'resuelto') rAt = prev.estado === 'resuelto' ? prev.resuelto_at : db.nowDateTime();
  db.run('UPDATE reportes SET estado = ?, resuelto_at = ? WHERE id = ?', [estado, rAt, id]);
}

function bumpReporte(id) {
  db.run('UPDATE reportes SET updated_at = ? WHERE id = ?', [new Date().toISOString(), id]);
}

function localDateTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function autoArchivarResueltos() {
  const cutoff = localDateTime(new Date(Date.now() - 24 * 3600 * 1000));
  const rows = db.all('SELECT id FROM reportes WHERE estado = \'resuelto\' AND archivado = 0 AND resuelto_at IS NOT NULL AND resuelto_at < ?', [cutoff]);
  for (const r of rows) {
    db.run('UPDATE reportes SET archivado = 1, archivado_at = ? WHERE id = ?', [db.nowDateTime(), r.id]);
    bumpReporte(r.id);
    addReporteEvent(r.id, 'archivado', 'Archivado automáticamente 24 h después de resolverlo.');
  }
  return rows.length;
}

function notifyChanged() {
  if (win && !win.isDestroyed()) win.webContents.send('app:changed');
}
global.changed = notifyChanged;

function buildEsperaMsg(reporte, client, nota) {
  const label = reporte.estado === 'espera_repuesto' ? 'Requerido: repuesto' : 'Esperando respuesta del cliente';
  const lines = [
    '🔁 ' + label,
    'Cliente: ' + (reporte.client_nombre || (client && client.nombre) || 'Sin nombre'),
    reporte.equipo_nombre ? 'Equipo: ' + reporte.equipo_nombre : '',
    reporte.tecnico_nombre ? 'Técnico: ' + reporte.tecnico_nombre : '',
    '',
    nota || ''
  ];
  return lines.filter((l) => l !== '').join('\n');
}

async function autoEnviarEsperaWhatsApp(reporteId) {
  try {
    const grupoRef = db.getSetting('wa_grupo_piezas', '');
    if (!grupoRef) { dbg('[espera-wa] Sin grupo configurado'); return; }
    if (whatsapp.snapshot().status !== 'ready') { dbg('[espera-wa] WhatsApp no conectado'); return; }
    const rp = db.get('SELECT * FROM reportes WHERE id = ?', [reporteId]);
    if (!rp) { dbg('[espera-wa] Reporte no encontrado: ' + reporteId); return; }
    const client = rp.client_id ? db.get('SELECT * FROM clients WHERE id = ?', [rp.client_id]) : null;
    const lastNote = db.get("SELECT detalle FROM reporte_eventos WHERE reporte_id = ? AND tipo = 'nota' ORDER BY id DESC LIMIT 1", [reporteId]);
    const msg = buildEsperaMsg(rp, client, lastNote ? lastNote.detalle : '');
    const chat = await whatsapp.findChat(grupoRef);
    let lastAdj = [];
    try { lastAdj = JSON.parse(rp.adjuntos || '[]'); } catch (e) { lastAdj = []; }
    dbg('[espera-wa] adjuntos: ' + JSON.stringify(lastAdj));
    const lastFotoNombre = lastAdj.length ? lastAdj[lastAdj.length - 1] : null;
    dbg('[espera-wa] lastFoto: ' + lastFotoNombre);
    if (lastFotoNombre && /^[A-Za-z0-9._@-]+$/.test(lastFotoNombre)) {
      const dir = adjuntosDir();
      const p = path.join(dir, lastFotoNombre);
      dbg('[espera-wa] path: ' + p + ' exists: ' + fs.existsSync(p));
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        dbg('[espera-wa] buf size: ' + buf.length + ' first bytes: ' + buf.slice(0, 10).toString('hex'));
        const isJpeg = buf.length > 2 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
        const isPng = buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
        const isWebp = buf.length > 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46;
        dbg('[espera-wa] isJpeg: ' + isJpeg + ' isPng: ' + isPng + ' isWebp: ' + isWebp);
        if ((isJpeg || isPng || isWebp) && buf.length > 100) {
          const ext = path.extname(lastFotoNombre).toLowerCase();
          const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          dbg('[espera-wa] Enviando imagen mime: ' + mime);
          await whatsapp.sendMediaTo(chat.id, { tipo: 'imagen', buffer: buf, caption: msg, mime });
          addReporteEvent(reporteId, 'enviado', 'Notificación de espera enviada al grupo ' + chat.name + ' (con foto).');
          sendToRenderer('app:changed');
          return;
        } else {
          dbg('[espera-wa] Imagen corrupta, bufLen=' + buf.length + ' enviando solo texto');
        }
      } else {
        dbg('[espera-wa] Archivo no existe en disco');
      }
    } else {
      dbg('[espera-wa] No hay foto adjunta en el reporte');
    }
    await whatsapp.sendMessageTo(chat.id, msg);
    addReporteEvent(reporteId, 'enviado', 'Notificación de espera enviada al grupo ' + chat.name + '.');
    sendToRenderer('app:changed');
  } catch (e) { dbg('[espera-wa] Error: ' + e.message + ' ' + e.stack); }
}

global.onEsperaDetectado = autoEnviarEsperaWhatsApp;

function sendToRenderer(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function notifyPendientes(summaryOnly) {
  if (!Notification.isSupported()) return;
  const rows = db.all(`SELECT r.id, c.nombre AS cliente, e.nombre AS equipo, r.fecha, r.prioridad
    FROM reportes r
    LEFT JOIN clients c ON c.id = r.client_id
    LEFT JOIN equipos e ON e.id = r.equipo_id
    WHERE r.enviado = 0 AND r.archivado = 0 AND r.grupo_id IS NOT NULL AND r.grupo_id != ''`);
  if (!rows.length) return;
  if (summaryOnly) {
    const n = new Notification({
      title: 'Reportes sin enviar a WhatsApp',
      body: 'Tienes ' + rows.length + ' reporte(s) pendiente(s) de enviar al grupo.',
      silent: false
    });
    n.on('click', () => { if (win) { win.show(); win.focus(); } sendToRenderer('app:goto-pendientes'); });
    n.show();
    return;
  }
  for (const r of rows) {
    try {
      const n = new Notification({
        title: '🚨 Reporte sin enviar a WhatsApp',
        body: r.cliente + (r.equipo ? ' · ' + r.equipo : '') + (r.fecha ? ' · ' + r.fecha : '') + '. Ábrelo para enviarlo al grupo.',
        silent: false
      });
      n.on('click', () => { if (win) { win.show(); win.focus(); } sendToRenderer('app:goto-pendientes'); });
      n.show();
    } catch (e) { /* noop */ }
  }
}

function notificarVencimientoLicencia() {
  try {
    const st = license.getStatus();
    if (!st.valid || !st.license || !st.license.expires) return;
    const exp = new Date(String(st.license.expires) + 'T23:59:59');
    if (isNaN(exp.getTime())) return;
    const dias = Math.ceil((exp.getTime() - Date.now()) / 86400000);
    if (dias < 0 || dias > 5) return;
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: '⚠️ Tu suscripción vence pronto',
      body: 'NEXALERT vence el ' + st.license.expires + ' (' + Math.max(0, dias) + ' día(s) restante(s)). Solicita tu clave renovada.',
      silent: false
    });
    n.on('click', () => { if (win) { win.show(); win.focus(); } });
    n.show();
  } catch (e) { /* noop */ }
}

function waSaveMensaje(m) {
  if (!m || !m.id) return null;  if (db.get('SELECT id FROM wa_mensajes WHERE mensaje_id = ?', [m.id])) return null;
  if (m.replyId && !m.replyTexto && !m.replyMedia) {
    const orig = db.get('SELECT * FROM wa_mensajes WHERE mensaje_id = ? AND jid = ?', [m.replyId, m.jid]);
    if (orig) {
      m.replyTexto = orig.texto || '';
      m.replyMedia = orig.media || '';
      m.replyRemitente = m.replyRemitente || orig.nombre || '';
    }
  }
  const tipo = m.fromMe ? 'out' : 'in';
  const id = db.run(`INSERT INTO wa_mensajes (mensaje_id, jid, telefono, nombre, texto, media, media_archivo, media_mime, es_grupo, tipo, leido, remitente, avatar, miembros, participant, mention_ids, reply_id, reply_remitente, reply_texto, reply_media, creado)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [m.id, m.jid || '', m.telefono || '', m.nombre || '', m.texto || '', m.media || '', m.mediaArchivo || '', m.mediaMime || '', m.isGroup ? 1 : 0, tipo, m.fromMe ? 1 : 0, m.remitente || '', m.avatar || '', m.miembros || 0, m.participant || '', m.mentionIds ? (Array.isArray(m.mentionIds) ? JSON.stringify(m.mentionIds) : String(m.mentionIds)) : '', m.replyId || '', m.replyRemitente || '', m.replyTexto || '', m.replyMedia || '', db.nowDateTime()]);
  db.run(`UPDATE wa_mensajes SET reply_texto = ?, reply_media = ?, reply_remitente = CASE WHEN reply_remitente = '' THEN ? ELSE reply_remitente END
    WHERE reply_id = ? AND jid = ? AND (reply_texto = '' OR reply_media = '') AND id != ?`,
    [m.texto || '', m.media || '', m.nombre || '', m.id, m.jid, id]);
  return db.get('SELECT * FROM wa_mensajes WHERE id = ?', [id]);
}

async function backfillMensajes() {
  try {
    if (!whatsapp.sock || whatsapp.status !== 'ready') return;
    const rows = db.all('SELECT DISTINCT jid FROM wa_mensajes WHERE jid IS NOT NULL AND jid != \'\'');
    if (!rows.length) return;
    const info = await whatsapp.enriquecerJids(rows.map((r) => r.jid));
    let cambios = 0;
    for (const [jid, inf] of Object.entries(info)) {
      if (inf.nombre) { db.run('UPDATE wa_mensajes SET nombre = ?, miembros = ? WHERE jid = ?', [inf.nombre, inf.miembros || 0, jid]); cambios += 1; }
      if (inf.avatar) { db.run('UPDATE wa_mensajes SET avatar = ? WHERE jid = ?', [inf.avatar, jid]); cambios += 1; }
    }
    if (cambios) sendToRenderer('wa:mensajes:update');
  } catch (e) { /* noop */ }
}

function notificarNuevoMensaje(m) {  if (!Notification.isSupported() || !win) return;
  const focused = win.isFocused();
  if (focused) return;
  try {
    const n = new Notification({
      title: '💬 ' + (m.nombre || m.telefono || 'WhatsApp'),
      body: m.texto || m.media || 'Nuevo mensaje',
      silent: true
    });
    n.on('click', () => { if (win) { win.show(); win.focus(); } sendToRenderer('app:goto-mensajes'); });
    n.show();
  } catch (e) { /* noop */ }
}

/* ------- Importación de técnicos (Excel / CSV / texto) ------- */
function splitCsvLine(line, delim) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function detectDelim(line) {
  let best = null, bestN = 0;
  for (const d of [',', ';', '\t']) {
    const n = line.split(d).length - 1;
    if (n > bestN) { best = d; bestN = n; }
  }
  return best;
}

function namesFromRows(rows) {
  const HEADER = /(^|[\s_-])(nombre|tecnico|técnico|name|empleado)([\s_-]|$)/i;
  let colIdx = 0, start = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i];
    const hit = row.findIndex((cell) => HEADER.test(String(cell == null ? '' : cell).trim()));
    if (hit >= 0) { colIdx = hit; start = i + 1; break; }
  }
  const names = [];
  const seen = new Set();
  for (let i = start; i < rows.length; i++) {
    const cell = rows[i] && rows[i][colIdx] != null ? String(rows[i][colIdx]).trim() : '';
    if (!cell || /^(nombre|tecnico|técnico|name|empleado)$/i.test(cell)) continue;
    const norm = cell.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(norm)) continue;
    seen.add(norm);
    names.push(cell.replace(/\s+/g, ' '));
  }
  return names;
}

function importTecnicos(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let rows = [];
  if (ext === '.xlsx' || ext === '.xls') {
    const wb = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  } else {
    const buf = fs.readFileSync(filePath);
    let text = null;
    try { text = buf.toString('utf8'); } catch (e) { /* noop */ }
    if (!text || text.indexOf('\uFFFD') !== -1) text = new TextDecoder('windows-1252').decode(buf);
    const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '');
    const delim = detectDelim(lines[0] || '');
    rows = lines.map((l) => (delim ? splitCsvLine(l, delim) : [l]));
  }
  return namesFromRows(rows);
}

function settingsAll() {
  return {
    negocio: db.getSetting('negocio', 'NexAlert'),
    recordatorio_enabled: db.getSetting('recordatorio_enabled', '0'),
    recordatorio_medio: db.getSetting('recordatorio_medio', 'grupo'),
    recordatorio_dias: db.getSetting('recordatorio_dias', '3'),
    recordatorio_hora: db.getSetting('recordatorio_hora', '09:00'),
    recordatorio_max: db.getSetting('recordatorio_max', '3'),
    sync_url: db.getSetting('sync_url', ''),
    sync_enabled: db.getSetting('sync_enabled', '0'),
    sync_last: db.getSetting('sync_last', ''),
    wa_grupo_piezas: db.getSetting('wa_grupo_piezas', '')
  };
}

function reporteEquiposOrPrimary(rp) {
  const eqs = getReporteEquipos(rp.id);
  if (eqs.length) return eqs;
  if (rp.equipo_id) {
    const e = db.get('SELECT * FROM equipos WHERE id = ?', [rp.equipo_id]);
    return e ? [e] : [];
  }
  return [];
}

function buildReportMsg(client, equipos, reporte, s) {
  const prio = PRIO_LABEL[reporte.prioridad] || 'Normal';
  const prioIcon = reporte.prioridad === 'urgente' ? '🔴' : reporte.prioridad === 'baja' ? '🟢' : '🟡';
  let adj = [];
  try { adj = JSON.parse(reporte.adjuntos || '[]'); } catch (e) { adj = []; }
  const eqs = Array.isArray(equipos) && equipos.length ? equipos : [];
  const eqLines = eqs.length
    ? (eqs.length === 1
      ? [
          'Equipo: ' + eqs[0].nombre,
          (eqs[0].marca || eqs[0].modelo) ? 'Marca/Modelo: ' + [eqs[0].marca, eqs[0].modelo].filter(Boolean).join(' ') : '',
          eqs[0].serial ? 'Serial: ' + eqs[0].serial : '',
          eqs[0].ubicacion ? 'Ubicación: ' + eqs[0].ubicacion : ''
        ]
      : ['Equipos: ' + eqs.map((x) => x.nombre).join(', ')])
    : ['Equipo: (no especificado)'];
  const lines = [
    '🚨 REPORTE DE FALLA',
    'Prioridad: ' + prioIcon + ' ' + prio,
    'Empresa: ' + client.nombre,
    client.contacto ? 'Contacto: ' + client.contacto : '',
    client.telefono ? 'Teléfono: ' + client.telefono : '',
    'Fecha: ' + reporte.fecha,
    ...eqLines,
    '',
    'Problema:',
    reporte.descripcion,
    reporte.solucion ? '✅ Solución: ' + reporte.solucion : '',
    adj.length ? '📎 Se adjuntan ' + adj.length + ' foto(s) del equipo' : '',
    '',
    '— ' + (s.negocio || 'REPORTES')
  ];
  return lines.filter((l) => l !== '').join('\n');
}

function diasDesdeFecha(f) {
  const d = parseDtLocal(f);
  if (!d) return null;
  const diff = Date.now() - d.getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

function parseDtLocal(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]) || 0);
  const d = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (d) return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
  const x = new Date(s);
  return isNaN(x.getTime()) ? null : x;
}

function buildRecordatorioMsg(client, equipos, reporte, s) {
  const dias = diasDesdeFecha(reporte.fecha || reporte.creado);
  const prio = PRIO_LABEL[reporte.prioridad] || 'Normal';
  const eqs = Array.isArray(equipos) && equipos.length ? equipos : [];
  const eqTxt = eqs.length ? 'Equipos: ' + eqs.map((x) => x.nombre).join(', ') : 'Equipo: (no especificado)';
  const lines = [
    '⏰ RECORDATORIO DE SERVICIO',
    'Cliente: ' + client.nombre,
    client.telefono ? 'Teléfono: ' + client.telefono : '',
    eqTxt,
    'Reportado: ' + (reporte.fecha || '—') + (dias !== null ? ' (hace ' + dias + ' día(s))' : ''),
    'Prioridad: ' + prio,
    '',
    'Problema:',
    String(reporte.descripcion).slice(0, 200),
    '',
    'Este reporte sigue pendiente. Por favor confirmar el estatus.',
    '— ' + (s.negocio || 'REPORTES')
  ];
  return lines.filter((l) => l !== '').join('\n');
}

async function ejecutarRecordatorios() {
  const s = settingsAll();
  if (s.recordatorio_enabled !== '1') return { ok: true, data: { enviados: [], desactivado: true } };
  if (whatsapp.snapshot().status !== 'ready') return { ok: true, data: { enviados: [], waNoConectado: true } };
  const diasMin = Math.max(1, Number(s.recordatorio_dias) || 3);
  const maxR = Math.max(1, Number(s.recordatorio_max) || 3);
  const hoy = db.nowStamp();
  const rows = db.all(`SELECT r.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, e.nombre AS equipo_nombre
    FROM reportes r
    LEFT JOIN clients c ON c.id = r.client_id
    LEFT JOIN equipos e ON e.id = r.equipo_id
    WHERE r.estado != 'resuelto' AND r.archivado = 0 AND r.enviado = 1
      AND r.grupo_id IS NOT NULL AND r.grupo_id != ''`);
  const enviados = [];
  for (const rp of rows) {
    try {
      const dias = diasDesdeFecha(rp.fecha || rp.creado);
      if (dias === null || dias < diasMin) continue;
      const nAnt = db.get('SELECT COUNT(*) AS n FROM reporte_eventos WHERE reporte_id = ? AND tipo = ?', [rp.id, 'recordatorio']);
      if (nAnt.n >= maxR) continue;
      const yaHoy = db.get('SELECT COUNT(*) AS n FROM reporte_eventos WHERE reporte_id = ? AND tipo = ? AND creado LIKE ?', [rp.id, 'recordatorio', hoy + '%']);
      if (yaHoy.n > 0) continue;
      const msg = buildRecordatorioMsg({ nombre: rp.cliente_nombre || 'Cliente', telefono: rp.cliente_telefono }, reporteEquiposOrPrimary(rp), rp, s);
      const medio = s.recordatorio_medio || 'grupo';
      let sentTo = '';
      if (medio === 'grupo' || medio === 'ambos') {
        if (rp.grupo_id || rp.grupo_nombre) {
          try {
            sentTo = await whatsapp.sendToGroup(rp.grupo_id || rp.grupo_nombre, msg);
          } catch (e) { sentTo = ''; }
        }
      }
      if (!sentTo && (medio === 'directo' || medio === 'ambos') && rp.cliente_telefono) {
        const tel = whatsapp.normalizarTelefono(rp.cliente_telefono);
        if (tel) {
          try {
            await whatsapp.sendMessageTo(tel + '@s.whatsapp.net', msg);
            sentTo = tel;
          } catch (e) { /* noop */ }
        }
      }
      if (!sentTo) continue;
      addReporteEvent(rp.id, 'recordatorio', 'Recordatorio automático enviado a ' + sentTo + ' (' + dias + ' día(s) sin resolver).');
      enviados.push({ id: rp.id, sentTo, cliente: rp.cliente_nombre, dias });
    } catch (e) { /* continuar con el siguiente */ }
  }
  return { ok: true, data: { enviados, desactivado: false, waNoConectado: false, fecha: hoy } };
}

function iniciarRecordatorios() {
  setInterval(() => {
    try {
      const s = settingsAll();
      if (s.recordatorio_enabled !== '1') return;
      const h = String(s.recordatorio_hora || '09:00').match(/^(\d{1,2}):(\d{2})/);
      if (!h) return;
      const ahora = new Date();
      const hh = Number(h[1]), mm = Number(h[2]);
      if (ahora.getHours() < hh || (ahora.getHours() === hh && ahora.getMinutes() < mm)) return;
      if (whatsapp.snapshot().status !== 'ready') return;
      const hoy = db.nowStamp();
      if (db.getSetting('recordatorio_ultimo', '') === hoy) return;
      ejecutarRecordatorios().then(() => {
        try { db.setSetting('recordatorio_ultimo', hoy); } catch (e) { /* noop */ }
      }).catch(() => { /* reintentar en el próximo tick */ });
    } catch (e) { /* noop */ }
  }, 5 * 60 * 1000);
}

const PDF_ESTADO = { abierto: 'Abierto', en_proceso: 'En proceso', resuelto: 'Resuelto', espera_repuesto: 'Espera de repuesto', espera_cliente: 'Espera del cliente' };
const PDF_HIST = {
  creado: '🆕 Reporte creado',
  editado: '✏️ Reporte editado',
  enviado: '📣 Enviado a WhatsApp',
  estado: '🔄 Estado cambiado',
  tecnico: '👷 Técnico',
  archivado: '📦 Archivo',
  nota: '📝 Nota del técnico',
  recordatorio: '⏰ Recordatorio automático'
};

function escHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function buildReportePdfHtml(rp, client, equipos, eventos, imgs) {
  const prio = PRIO_LABEL[rp.prioridad] || 'Normal';
  const prioColor = rp.prioridad === 'urgente' ? '#dc2626' : rp.prioridad === 'baja' ? '#16a34a' : '#a16207';
  const eqs = Array.isArray(equipos) && equipos.length ? equipos : [];
  const eqVal = eqs.length
    ? eqs.map((x) => [x.nombre, [x.marca, x.modelo].filter(Boolean).join(' '), x.serial, x.ubicacion].filter(Boolean).join(' · ')).join('<br>')
    : '(no especificado)';
  const filas = [
    ['Cliente', client ? client.nombre : '—'],
    ['Contacto', client && (client.contacto || client.telefono) ? [client.contacto, client.telefono].filter(Boolean).join(' · ') : '—'],
    ['Equipo(s)', eqVal],
    ['Fecha del reporte', rp.fecha || '—'],
    ['Grupo de WhatsApp', rp.grupo_nombre || '(sin grupo)'],
    ['Técnico', rp.tecnico_nombre || 'Sin asignar'],
    ['Prioridad', prio],
    ['Estado', PDF_ESTADO[rp.estado] || rp.estado],
    ['Resuelto el', rp.resuelto_at || '—'],
    ['Archivado el', rp.archivado_at || '—']
  ];
  const eventsHtml = (eventos && eventos.length ? eventos.map((ev) => `
      <tr>
        <td class="nowrap">${escHtml(ev.creado || '')}</td>
        <td><b>${escHtml(PDF_HIST[ev.tipo] || ev.tipo || '')}</b></td>
        <td>${escHtml(ev.detalle || '')}</td>
      </tr>`).join('')
    : '<tr><td colspan="3" class="muted">Sin eventos registrados.</td></tr>');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #101828; font-size: 13px; margin: 0; padding: 0; }
    .page { padding: 8px 10px; }
    .head { background: #1b1f3b; color: #fff; padding: 14px 16px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; }
    .head h1 { margin: 0; font-size: 18px; }
    .head .sub { font-size: 11px; color: #b6b3d4; }
    .badge { display: inline-block; border-radius: 10px; padding: 2px 10px; font-size: 11.5px; font-weight: 600; margin-left: 4px; }
    .badge-estado { background: #dcfce7; color: #15803d; }
    .badge-abierto { background: #fee2e2; color: #b91c1c; }
    .badge-en_proceso { background: #fef9c3; color: #a16207; }
    h2 { font-size: 14px; margin: 18px 0 8px; border-bottom: 2px solid #e4e7ee; padding-bottom: 4px; color: #1b1f3b; }
    table.meta { width: 100%; border-collapse: collapse; }
    table.meta td { padding: 4px 6px; border-bottom: 1px solid #eef0f5; vertical-align: top; }
    table.meta td.k { font-weight: 600; width: 150px; color: #5a6472; }
    .caja { border: 1px solid #e4e7ee; border-radius: 8px; padding: 10px 12px; background: #fafbfd; white-space: pre-wrap; }
    table.hist { width: 100%; border-collapse: collapse; margin-top: 4px; }
    table.hist th { text-align: left; font-size: 11px; color: #5a6472; background: #f4f6fa; }
    table.hist th, table.hist td { padding: 6px 8px; border: 1px solid #e4e7ee; }
    .nowrap { white-space: nowrap; }
    .muted { color: #98a1b0; }
    .fotos { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; }
    .foto { max-width: 46%; }
    .foto img { width: 100%; border-radius: 6px; border: 1px solid #e4e7ee; }
    .firma { margin-top: 34px; border-top: 1px solid #c7cfdd; padding-top: 8px; font-size: 11.5px; color: #5a6472; text-align: center; }
  </style></head><body><div class="page">
    <div class="head">
      <div><h1>🚨 NEXALERT · Reporte de falla N° ${rp.id}</h1><div class="sub">${escHtml(client ? client.nombre : '')} · ${escHtml(rp.fecha || '')}</div></div>
      <div><span class="badge ${'badge-' + (rp.estado || '')}">${escHtml(PDF_ESTADO[rp.estado] || rp.estado || '')}</span> <span class="badge" style="background:#fef9c3;color:${prioColor}">${escHtml(prio)}</span></div>
    </div>
    <h2>Datos generales</h2>
    <table class="meta">${filas.map(([k, v]) => `<tr><td class="k">${k}</td><td>${escHtml(v)}</td></tr>`).join('')}</table>
    <h2>Problema reportado</h2>
    <div class="caja">${escHtml(rp.descripcion)}</div>
    <h2>Solución / nota del técnico</h2>
    <div class="caja">${rp.solucion ? escHtml(rp.solucion) : '<span class="muted">Sin nota registrada.</span>'}</div>
    <h2>Historial del reporte</h2>
    <table class="hist"><tr><th>Fecha</th><th>Evento</th><th>Detalle</th></tr>${eventsHtml}</table>
    <h2>Imágenes de evidencia</h2>
    ${imgs && imgs.length ? '<div class="fotos">' + imgs.map((d) => '<div class="foto"><img src="' + d + '"></div>').join('') + '</div>' : '<span class="muted">Sin imágenes adjuntas.</span>'}
    <div class="firma">Reporte generado por NEXALERT · ${db.nowDateTime()}</div>
  </div></body></html>`;
}

async function printToPdf(html) {
  const w = new BrowserWindow({ show: false, width: 800, height: 1000 });
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 500));
    return await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
  } finally {
    if (!w.isDestroyed()) w.destroy();
  }
}

async function generarReportePdf(id) {
  const rp = db.get('SELECT * FROM reportes WHERE id = ?', [id]);
  if (!rp) throw new Error('Reporte no encontrado');
  const client = db.get('SELECT * FROM clients WHERE id = ?', [rp.client_id]);
  const equipos = reporteEquiposOrPrimary(rp);
  const eventos = db.all('SELECT * FROM reporte_eventos WHERE reporte_id = ? ORDER BY id ASC', [id]);
  let adj = [];
  try { adj = JSON.parse(rp.adjuntos || '[]'); } catch (e) { adj = []; }
  const imgs = [];
  for (const name of adj) {
    if (!/^[A-Za-z0-9._@-]+$/.test(String(name))) continue;
    const p = path.join(adjuntosDir(), name);
    if (fs.existsSync(p)) {
      try { imgs.push('data:' + adjuntosMime(name) + ';base64,' + fs.readFileSync(p).toString('base64')); } catch (e) { /* noop */ }
    }
  }
  return { rp, client, equipos, eventos, imgs, html: buildReportePdfHtml(rp, client, equipos, eventos, imgs) };
}

function registerIpc() {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('clients:list', () => {
    const rows = db.all('SELECT * FROM clients ORDER BY nombre COLLATE NOCASE ASC')
      .map((c) => ({ ...c, equipos: db.get('SELECT COUNT(*) AS n FROM equipos WHERE client_id = ?', [c.id]).n }));
    return { ok: true, data: rows };
  });

  ipcMain.handle('clients:save', (e, c) => {
    if (!c || !String(c.nombre || '').trim()) return { ok: false, error: 'El nombre del cliente es obligatorio' };
    const rec = {
      nombre: String(c.nombre).trim(),
      contacto: String(c.contacto || '').trim(),
      telefono: String(c.telefono || '').trim(),
      email: String(c.email || '').trim(),
      direccion: String(c.direccion || '').trim(),
      notas: String(c.notas || '')
    };
    if (c.id) {
      db.run('UPDATE clients SET nombre=?, contacto=?, telefono=?, email=?, direccion=?, notas=? WHERE id=?',
        [rec.nombre, rec.contacto, rec.telefono, rec.email, rec.direccion, rec.notas, c.id]);
      return { ok: true, data: db.get('SELECT * FROM clients WHERE id = ?', [c.id]) };
    }
    const id = db.run('INSERT INTO clients (nombre, contacto, telefono, email, direccion, notas, creado) VALUES (?,?,?,?,?,?,?)',
      [rec.nombre, rec.contacto, rec.telefono, rec.email, rec.direccion, rec.notas, db.nowStamp()]);
    return { ok: true, data: db.get('SELECT * FROM clients WHERE id = ?', [id]) };
  });

  ipcMain.handle('clients:delete', (e, id) => {
    db.run('DELETE FROM reporte_equipos WHERE reporte_id IN (SELECT id FROM reportes WHERE client_id = ?)', [id]);
    db.run('DELETE FROM reportes WHERE client_id = ?', [id]);
    db.run('DELETE FROM equipos WHERE client_id = ?', [id]);
    db.run('DELETE FROM clients WHERE id = ?', [id]);
    return { ok: true };
  });

  ipcMain.handle('equipos:list', (e, clientId) => {
    const rows = clientId
      ? db.all('SELECT * FROM equipos WHERE client_id = ? ORDER BY nombre COLLATE NOCASE ASC', [clientId])
      : db.all('SELECT * FROM equipos ORDER BY nombre COLLATE NOCASE ASC');
    return { ok: true, data: rows };
  });

  ipcMain.handle('equipos:save', (e, eq) => {
    if (!eq || !eq.client_id || !String(eq.nombre || '').trim()) return { ok: false, error: 'El cliente y el nombre del equipo son obligatorios' };
    const rec = {
      client_id: Number(eq.client_id),
      nombre: String(eq.nombre).trim(),
      marca: String(eq.marca || '').trim(),
      modelo: String(eq.modelo || '').trim(),
      serial: String(eq.serial || '').trim(),
      ubicacion: String(eq.ubicacion || '').trim(),
      notas: String(eq.notas || '')
    };
    if (eq.id) {
      db.run('UPDATE equipos SET client_id=?, nombre=?, marca=?, modelo=?, serial=?, ubicacion=?, notas=? WHERE id=?',
        [rec.client_id, rec.nombre, rec.marca, rec.modelo, rec.serial, rec.ubicacion, rec.notas, eq.id]);
      return { ok: true, data: db.get('SELECT * FROM equipos WHERE id = ?', [eq.id]) };
    }
    const id = db.run('INSERT INTO equipos (client_id, nombre, marca, modelo, serial, ubicacion, notas, creado) VALUES (?,?,?,?,?,?,?,?)',
      [rec.client_id, rec.nombre, rec.marca, rec.modelo, rec.serial, rec.ubicacion, rec.notas, db.nowStamp()]);
    return { ok: true, data: db.get('SELECT * FROM equipos WHERE id = ?', [id]) };
  });

  ipcMain.handle('equipos:delete', (e, id) => {
    db.run('UPDATE reportes SET equipo_id = NULL WHERE equipo_id = ?', [id]);
    db.run('DELETE FROM reporte_equipos WHERE equipo_id = ?', [id]);
    db.run('DELETE FROM equipos WHERE id = ?', [id]);
    return { ok: true };
  });

  ipcMain.handle('reportes:list', () => {
    const rows = db.all(`SELECT r.*,
      COALESCE(c.nombre, r.client_nombre) AS cliente_nombre,
      COALESCE(e.nombre, r.equipo_nombre) AS equipo_nombre,
      c.contacto AS cliente_contacto,
      c.telefono AS cliente_telefono,
      c.email AS cliente_email,
      (SELECT ev.detalle FROM reporte_eventos ev WHERE ev.reporte_id = r.id AND ev.tipo = 'nota' ORDER BY ev.id DESC LIMIT 1) AS ultima_nota,
      (SELECT ev.creado FROM reporte_eventos ev WHERE ev.reporte_id = r.id AND ev.tipo = 'nota' ORDER BY ev.id DESC LIMIT 1) AS ultima_nota_at
      FROM reportes r
      LEFT JOIN clients c ON c.id = r.client_id
      LEFT JOIN equipos e ON e.id = r.equipo_id
      ORDER BY r.fecha DESC, r.id DESC`);
    return { ok: true, data: attachEquipos(rows) };
  });

  ipcMain.handle('reportes:historial', (e, id) => {
    const rows = db.all('SELECT * FROM reporte_eventos WHERE reporte_id = ? ORDER BY id ASC', [id]);
    return { ok: true, data: rows };
  });

  ipcMain.handle('reportes:save', (e, rp) => {
    if (!rp || !String(rp.descripcion || '').trim()) return { ok: false, error: 'La descripción del problema es obligatoria' };
    const prev = rp.id ? db.get('SELECT * FROM reportes WHERE id = ?', [rp.id]) : null;
    const estado = ESTADOS_VALIDOS.includes(rp.estado) ? rp.estado : 'abierto';
    let resueltoAt = null;
    if (estado === 'resuelto') resueltoAt = prev && prev.estado === 'resuelto' ? prev.resuelto_at : db.nowDateTime();
    const eqIds = (Array.isArray(rp.equipos_ids) && rp.equipos_ids.length
      ? rp.equipos_ids.map(Number)
      : (rp.equipo_id ? [Number(rp.equipo_id)] : [])).filter((x) => x > 0);
    const clientId = Number(rp.client_id) || 0;
    const clientNombre = String(rp.client_nombre || '').trim();
    const equipoNombre = String(rp.equipo_nombre || '').trim();
    if (!clientId && !clientNombre) return { ok: false, error: 'Selecciona un cliente o escribe el nombre del cliente' };
    const rec = {
      client_id: clientId,
      client_nombre: clientNombre,
      equipo_nombre: equipoNombre,
      equipo_id: eqIds[0] || (Number(rp.equipo_id) || null),
      descripcion: String(rp.descripcion).trim(),
      fecha: rp.fecha || db.nowStamp(),
      estado,
      grupo_id: String(rp.grupo_id || '').trim(),
      grupo_nombre: String(rp.grupo_nombre || rp.grupo_id || '').trim(),
      prioridad: ['baja', 'normal', 'urgente'].includes(rp.prioridad) ? rp.prioridad : 'normal',
      solucion: String(rp.solucion || '').trim(),
      adjuntos: JSON.stringify(guardarAdjuntos(rp.adjuntosNuevos, rp.adjuntosEliminados, rp.adjuntos)),
      resuelto_at: resueltoAt
    };
    if (prev && prev.prioridad !== rec.prioridad) addReporteEvent(rp.id, 'prioridad', 'Prioridad → ' + PRIO_LABEL[rec.prioridad] + '.');
    if (rp.id) {
      db.run('UPDATE reportes SET client_id=?, client_nombre=?, equipo_nombre=?, equipo_id=?, descripcion=?, fecha=?, estado=?, grupo_id=?, grupo_nombre=?, prioridad=?, solucion=?, adjuntos=?, resuelto_at=? WHERE id=?',
        [rec.client_id, rec.client_nombre, rec.equipo_nombre, rec.equipo_id, rec.descripcion, rec.fecha, rec.estado, rec.grupo_id, rec.grupo_nombre, rec.prioridad, rec.solucion, rec.adjuntos, rec.resuelto_at, rp.id]);
      bumpReporte(rp.id);
      addReporteEvent(rp.id, 'editado', 'Reporte editado.');
      syncReporteEquipos(rp.id, rec.client_id, eqIds);
    } else {
      const id = db.run('INSERT INTO reportes (client_id, client_nombre, equipo_nombre, equipo_id, descripcion, fecha, estado, grupo_id, grupo_nombre, prioridad, solucion, adjuntos, resuelto_at, creado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [rec.client_id, rec.client_nombre, rec.equipo_nombre, rec.equipo_id, rec.descripcion, rec.fecha, rec.estado, rec.grupo_id, rec.grupo_nombre, rec.prioridad, rec.solucion, rec.adjuntos, rec.resuelto_at, db.nowStamp()]);
      bumpReporte(id);
      syncReporteEquipos(id, rec.client_id, eqIds);
      addReporteEvent(id, 'creado', 'Reporte registrado.');
      if (rec.grupo_id && Notification.isSupported()) {
        try {
          const cl = db.get('SELECT * FROM clients WHERE id = ?', [rec.client_id]);
          const n = new Notification({
            title: '🚨 Reporte creado sin enviar',
            body: (cl ? cl.nombre : clientNombre || 'Cliente') + '. Ábrelo para enviarlo al grupo de WhatsApp.',
            silent: false
          });
          n.on('click', () => { if (win) { win.show(); win.focus(); } sendToRenderer('app:goto-pendientes'); });
          n.show();
        } catch (e) { /* noop */ }
      }
    }
    if (rec.client_id && rec.grupo_id) {
      const cl = db.get('SELECT grupo_id FROM clients WHERE id = ?', [rec.client_id]);
      if (cl && !cl.grupo_id) db.run('UPDATE clients SET grupo_id = ?, grupo_nombre = ? WHERE id = ?', [rec.grupo_id, rec.grupo_nombre, rec.client_id]);
    }
    return { ok: true, data: db.get('SELECT * FROM reportes WHERE id = ?', [rp.id || db.get('SELECT MAX(id) AS id FROM reportes').id]) };
  });

  ipcMain.handle('reportes:setEstado', (e, id, estado) => {
    if (!ESTADOS_VALIDOS.includes(estado)) return { ok: false, error: 'Estado no válido' };
    const prev = db.get('SELECT estado FROM reportes WHERE id = ?', [id]);
    applyEstado(id, estado);
    bumpReporte(id);
    addReporteEvent(id, 'estado', 'Estado → ' + ESTADO_LABEL[estado] + '.');
    if (estado === 'espera_repuesto' || estado === 'espera_cliente') {
      dbg('[setEstado] Disparando autoEnviarEsperaWhatsApp para reporte ' + id + ' estado: ' + estado);
      setTimeout(() => autoEnviarEsperaWhatsApp(id), 500);
    }
    return { ok: true, data: db.get('SELECT * FROM reportes WHERE id = ?', [id]) };
  });

  ipcMain.handle('reportes:nota', (e, id, texto) => {
    const t = String(texto || '').trim();
    if (!t) return { ok: false, error: 'Escribe el texto de la nota' };
    const rp = db.get('SELECT * FROM reportes WHERE id = ?', [id]);
    if (!rp) return { ok: false, error: 'Reporte no encontrado' };
    addReporteEvent(id, 'nota', t);
    return { ok: true, data: db.get('SELECT * FROM reportes WHERE id = ?', [id]) };
  });

  ipcMain.handle('reportes:recordatorioRun', async () => {
    try {
      return await ejecutarRecordatorios();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('reportes:resolver', (e, id, solucion, adjuntosNuevos, adjuntosEliminados, adjuntosExistentes) => {
    const rp = db.get('SELECT * FROM reportes WHERE id = ?', [id]);
    if (!rp) return { ok: false, error: 'Reporte no encontrado' };
    const nota = String(solucion || '').trim();
    let existentes = adjuntosExistentes;
    if (!Array.isArray(existentes)) {
      try { existentes = JSON.parse(rp.adjuntos || '[]'); } catch (err) { existentes = []; }
    }
    const adj = JSON.stringify(guardarAdjuntos(adjuntosNuevos, adjuntosEliminados, existentes));
    const rAt = rp.estado === 'resuelto' ? rp.resuelto_at : db.nowDateTime();
    db.run('UPDATE reportes SET estado = ?, solucion = ?, resuelto_at = ?, adjuntos = ? WHERE id = ?', ['resuelto', nota, rAt, adj, id]);
    bumpReporte(id);
    addReporteEvent(id, 'estado', 'Estado → Resuelto.' + (nota ? ' Solución: ' + nota : ''));
    return { ok: true, data: db.get('SELECT * FROM reportes WHERE id = ?', [id]) };
  });

  ipcMain.handle('reportes:export', async (e, rows) => {
    const res = await dialog.showSaveDialog({
      title: 'Exportar reportes a Excel',
      defaultPath: path.join(app.getPath('downloads'), 'reportes-' + db.nowStamp() + '.xlsx'),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    const data = (rows || []).map((r) => ({
      Fecha: r.fecha || '',
      Cliente: r.cliente_nombre || '',
      Equipo: (r.equipos && r.equipos.length ? r.equipos.map((x) => x.nombre).join(', ') : (r.equipo_nombre || '')),
      Prioridad: PRIO_LABEL[r.prioridad] || 'Normal',
      Estado: ESTADO_LABEL[r.estado] || r.estado,
      Tecnico: r.tecnico_nombre || '',
      'Fecha asignacion': r.asignado_at || '',
      Grupo: r.grupo_nombre || '',
      Enviado: r.enviado ? 'Si' : 'No',
      'Fecha envio': r.enviado_at || '',
      Descripcion: r.descripcion || '',
      Solucion: r.solucion || '',
      Archivado: r.archivado ? 'Si' : 'No'
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 22 }, { wch: 8 }, { wch: 12 }, { wch: 40 }, { wch: 40 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reportes');
    XLSX.writeFile(wb, res.filePath);
    return { ok: true, data: res.filePath };
  });

  function diasEntre(a, b) {
    const da = parseDtLocal(a), db2 = parseDtLocal(b);
    if (!da || !db2) return null;
    const d = (db2.getTime() - da.getTime()) / 86400000;
    return d >= 0 ? d : 0;
  }

  function calcularResumen() {
    const rows = db.all(`SELECT r.*, c.nombre AS cliente_nombre, e.nombre AS equipo_nombre, t.nombre AS tec_nombre
      FROM reportes r
      LEFT JOIN clients c ON c.id = r.client_id
      LEFT JOIN equipos e ON e.id = r.equipo_id
      LEFT JOIN tecnicos t ON t.id = r.tecnico_id`);
    attachEquipos(rows);
    const total = rows.length;
    const activos = rows.filter((r) => !r.archivado);
    const resueltos = rows.filter((r) => r.estado === 'resuelto');
    const porEstado = ESTADOS_VALIDOS.map((k) => ({ estado: k, label: ESTADO_LABEL[k], n: activos.filter((r) => r.estado === k).length }));
    const diasResueltos = resueltos.map((r) => diasEntre(r.creado, r.resuelto_at)).filter((x) => x !== null);
    const promedioGlobal = diasResueltos.length ? diasResueltos.reduce((a, b) => a + b, 0) / diasResueltos.length : null;
    const porTecnico = {};
    for (const r of resueltos) {
      const k = (r.tec_nombre || r.tecnico_nombre || '').trim() || 'Sin técnico';
      porTecnico[k] = porTecnico[k] || { tecnico: k, total: 0, dias: [] };
      const d = diasEntre(r.creado, r.resuelto_at);
      if (d === null) continue;
      porTecnico[k].total++;
      porTecnico[k].dias.push(d);
    }
    const resumenTecnicos = Object.values(porTecnico)
      .map((x) => ({ tecnico: x.tecnico, resueltos: x.total, promedio: x.dias.length ? x.dias.reduce((a, b) => a + b, 0) / x.dias.length : null }))
      .sort((a, b) => b.resueltos - a.resueltos);
    const porMes = {};
    for (const r of rows) {
      const ck = String(r.creado || '').slice(0, 7);
      if (ck) {
        porMes[ck] = porMes[ck] || { mes: ck, creados: 0, resueltos: 0 };
        porMes[ck].creados++;
      }
      if (r.estado === 'resuelto' && r.resuelto_at) {
        const rk = String(r.resuelto_at).slice(0, 7);
        porMes[rk] = porMes[rk] || { mes: rk, creados: 0, resueltos: 0 };
        porMes[rk].resueltos++;
      }
    }
    const meses = Object.values(porMes).sort((a, b) => (a.mes < b.mes ? -1 : 1)).slice(-12);
    const porCliente = {};
    for (const r of rows) {
      const k = (r.cliente_nombre || '').trim() || 'Sin cliente';
      porCliente[k] = porCliente[k] || { cliente: k, total: 0, activos: 0 };
      porCliente[k].total++;
      if (!r.archivado) porCliente[k].activos++;
    }
    const resumenClientes = Object.values(porCliente).sort((a, b) => b.total - a.total);
    const porEquipo = {};
    for (const r of rows) {
      const eqs = (r.equipos && r.equipos.length) ? r.equipos : (r.equipo_id ? [{ nombre: r.equipo_nombre || '' }] : []);
      for (const x of eqs) {
        const k = (x.nombre || '').trim();
        if (!k) continue;
        porEquipo[k] = porEquipo[k] || { equipo: k, total: 0 };
        porEquipo[k].total++;
      }
    }
    const resumenEquipos = Object.values(porEquipo).sort((a, b) => b.total - a.total).slice(0, 12);
    const viejos = activos.filter((r) => r.estado !== 'resuelto').map((r) => ({
      id: r.id, dias: diasEntre(r.creado, db.nowDateTime()),
      cliente: r.cliente_nombre,
      equipo: (r.equipos && r.equipos.length ? r.equipos.map((x) => x.nombre).join(', ') : (r.equipo_nombre || '')),
      estado: r.estado
    })).filter((x) => x.dias !== null && x.dias >= 7).sort((a, b) => b.dias - a.dias);
    return { total, activos: activos.length, resueltos: resueltos.length, promedioGlobal, porEstado, resumenTecnicos, meses, resumenClientes, resumenEquipos, viejos };
  }

  ipcMain.handle('reportes:resumen', () => {
    try {
      return { ok: true, data: calcularResumen() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('reportes:resumenXlsx', async () => {
    const res = await dialog.showSaveDialog({
      title: 'Exportar resumen ejecutivo a Excel',
      defaultPath: path.join(app.getPath('downloads'), 'resumen-' + db.nowStamp() + '.xlsx'),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    const s = calcularResumen();
    const p = (x) => (x == null ? '' : Math.round(x * 10) / 10);
    const wb = XLSX.utils.book_new();
    const general = [
      { Metrica: 'Total de reportes', Valor: s.total },
      { Metrica: 'Activos (sin archivar)', Valor: s.activos },
      { Metrica: 'Resueltos', Valor: s.resueltos },
      { Metrica: 'Promedio días para resolver', Valor: p(s.promedioGlobal) }
    ];
    for (const e of s.porEstado) general.push({ Metrica: e.label, Valor: e.n });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(general), 'Resumen');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.resumenTecnicos.map((t) => ({ Tecnico: t.tecnico, Resueltos: t.resueltos, 'Promedio dias': p(t.promedio) }))), 'Por tecnico');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.meses.map((m) => ({ Mes: m.mes, Creados: m.creados, Resueltos: m.resueltos }))), 'Por mes');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.resumenClientes.map((c) => ({ Cliente: c.cliente, Total: c.total, Activos: c.activos }))), 'Por cliente');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.resumenEquipos.map((q) => ({ Equipo: q.equipo, 'Total reportes': q.total }))), 'Por equipo');
    XLSX.writeFile(wb, res.filePath);
    return { ok: true, data: res.filePath };
  });

  ipcMain.handle('reportes:backup', () => {
    try {
      const p = hacerBackup();
      return { ok: true, data: p };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('reportes:pdf', async (e, id) => {
    try {
      const data = await generarReportePdf(id);
      const pdf = await printToPdf(data.html);
      const res = await dialog.showSaveDialog({
        title: 'Guardar reporte en PDF',
        defaultPath: path.join(app.getPath('downloads'), 'reporte-' + id + '-' + db.nowStamp() + '.pdf'),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });
      if (res.canceled || !res.filePath) return { ok: true, canceled: true };
      fs.writeFileSync(res.filePath, pdf);
      return { ok: true, path: res.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('reportes:pdfEnviar', async (e, id) => {
    try {
      const lic = license.canUse();
      if (!lic.ok) throw new Error('Licencia de NEXALERT no disponible: ' + lic.reason + '. Activa tu licencia en la pantalla de inicio.');
      const data = await generarReportePdf(id);
      const rp = data.rp;
      if (!rp.grupo_id && !rp.grupo_nombre) throw new Error('El reporte no tiene un grupo de WhatsApp asignado.');
      const pdf = await printToPdf(data.html);
      const chat = await whatsapp.findChat(rp.grupo_id || rp.grupo_nombre);
      const caption = '🚨 Reporte N° ' + rp.id + (data.client ? ' · ' + data.client.nombre : '') + (rp.estado === 'resuelto' ? ' · ✅ Resuelto' : '');
      await whatsapp.sendDocument(chat.id, pdf, 'reporte-' + rp.id + '.pdf', caption);
      db.run('UPDATE reportes SET enviado = 1, enviado_at = ? WHERE id = ?', [db.nowStamp(), rp.id]);
      addReporteEvent(rp.id, 'enviado', 'Reporte en PDF enviado al grupo ' + chat.name + '.');
      return { ok: true, sentTo: chat.name };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('adjuntos:pick', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Elegir fotos del reporte',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, data: res.filePaths };
  });

  ipcMain.handle('adjuntos:read', (e, name) => {
    if (!/^[A-Za-z0-9._@-]+$/.test(String(name || ''))) return { ok: false, error: 'Nombre de archivo inválido' };
    const p = path.join(adjuntosDir(), name);
    if (!fs.existsSync(p)) return { ok: false, error: 'Archivo no encontrado' };
    const buf = fs.readFileSync(p);
    return { ok: true, data: 'data:' + adjuntosMime(name) + ';base64,' + buf.toString('base64') };
  });

  ipcMain.handle('adjuntos:preview', (e, filePath) => {
    if (!filePath || typeof filePath !== 'string' || !/\.(png|jpe?g|gif|webp|bmp)$/i.test(filePath)) return { ok: false, error: 'No es una imagen válida' };
    try {
      const buf = fs.readFileSync(filePath);
      return { ok: true, data: 'data:' + adjuntosMime(path.basename(filePath)) + ';base64,' + buf.toString('base64') };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('reportes:setTecnico', (e, id, tecnicoId) => {
    const rp = db.get('SELECT * FROM reportes WHERE id = ?', [id]);
    if (!rp) return { ok: false, error: 'Reporte no encontrado' };
    const tId = Number(tecnicoId) || null;
    if (tId) {
      const t = db.get('SELECT * FROM tecnicos WHERE id = ?', [tId]);
      if (!t) return { ok: false, error: 'Técnico no encontrado' };
      db.run('UPDATE reportes SET tecnico_id = ?, tecnico_nombre = ?, asignado_at = ? WHERE id = ?',
        [t.id, t.nombre, db.nowDateTime(), id]);
      bumpReporte(id);
      addReporteEvent(id, 'tecnico', 'Asignado a ' + t.nombre + '.');
    } else {
      db.run('UPDATE reportes SET tecnico_id = NULL, tecnico_nombre = NULL, asignado_at = NULL WHERE id = ?', [id]);
      bumpReporte(id);
      addReporteEvent(id, 'tecnico', rp.tecnico_nombre ? 'Técnico ' + rp.tecnico_nombre + ' desasignado.' : 'Asignación de técnico quitada.');
    }
    return { ok: true, data: db.get('SELECT * FROM reportes WHERE id = ?', [id]) };
  });

  ipcMain.handle('reportes:delete', (e, id) => {
    db.run('DELETE FROM reporte_eventos WHERE reporte_id = ?', [id]);
    db.run('DELETE FROM reporte_equipos WHERE reporte_id = ?', [id]);
    db.run('DELETE FROM reportes WHERE id = ?', [id]);
    db.run('INSERT INTO sync_tombstones (reporte_id, updated_at) VALUES (?, ?) ON CONFLICT(reporte_id) DO UPDATE SET updated_at = excluded.updated_at',
      [id, new Date().toISOString()]);
    return { ok: true };
  });

  ipcMain.handle('reportes:setArchivado', (e, id, archivado) => {
    const rp = db.get('SELECT * FROM reportes WHERE id = ?', [id]);
    if (!rp) return { ok: false, error: 'Reporte no encontrado' };
    const a = archivado ? 1 : 0;
    db.run('UPDATE reportes SET archivado = ?, archivado_at = ? WHERE id = ?', [a, a ? db.nowDateTime() : null, id]);
    bumpReporte(id);
    addReporteEvent(id, 'archivado', a ? 'Reporte archivado.' : 'Reporte restaurado a la lista activa.');
    return { ok: true, data: db.get('SELECT * FROM reportes WHERE id = ?', [id]) };
  });

  ipcMain.handle('tecnicos:list', () => {
    const rows = db.all('SELECT * FROM tecnicos ORDER BY nombre COLLATE NOCASE ASC')
      .map((t) => ({ ...t, pendientes: db.get('SELECT COUNT(*) AS n FROM reportes WHERE tecnico_id = ? AND estado != ?', [t.id, 'resuelto']).n }));
    return { ok: true, data: rows };
  });

  ipcMain.handle('tecnicos:save', (e, t) => {
    if (!t || !String(t.nombre || '').trim()) return { ok: false, error: 'El nombre del técnico es obligatorio' };
    const nombre = String(t.nombre).trim().replace(/\s+/g, ' ');
    const dup = db.get('SELECT id FROM tecnicos WHERE lower(nombre) = ? AND id != ?', [nombre.toLowerCase(), t.id || 0]);
    if (dup) return { ok: false, error: 'Ya existe un técnico llamado "' + nombre + '"' };
    const telefono = String(t.telefono || '').trim();
    const rol = String(t.rol || 'tecnico');
    if (t.id) {
      db.run('UPDATE tecnicos SET nombre = ?, telefono = ?, rol = ? WHERE id = ?', [nombre, telefono, rol, t.id]);
      db.run('UPDATE reportes SET tecnico_nombre = ? WHERE tecnico_id = ?', [nombre, t.id]);
      return { ok: true, data: db.get('SELECT * FROM tecnicos WHERE id = ?', [t.id]) };
    }
    const id = db.run('INSERT INTO tecnicos (nombre, telefono, rol, creado) VALUES (?,?,?,?)', [nombre, telefono, rol, db.nowStamp()]);
    return { ok: true, data: db.get('SELECT * FROM tecnicos WHERE id = ?', [id]) };
  });

  ipcMain.handle('tecnicos:delete', (e, id) => {
    const t = db.get('SELECT * FROM tecnicos WHERE id = ?', [id]);
    if (t) {
      const asignados = db.all('SELECT id, tecnico_nombre FROM reportes WHERE tecnico_id = ?', [id]);
      for (const r of asignados) addReporteEvent(r.id, 'tecnico', 'Técnico ' + r.tecnico_nombre + ' eliminado del catálogo.');
      db.run('UPDATE reportes SET tecnico_id = NULL, tecnico_nombre = NULL, asignado_at = NULL WHERE tecnico_id = ?', [id]);
      db.run('DELETE FROM tecnicos WHERE id = ?', [id]);
    }
    return { ok: true };
  });

  ipcMain.handle('tecnicos:pickFile', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Importar técnicos desde archivo',
      properties: ['openFile'],
      filters: [
        { name: 'Archivos de Excel, CSV o texto', extensions: ['xlsx', 'xls', 'csv', 'txt'] },
        { name: 'Excel', extensions: ['xlsx', 'xls'] },
        { name: 'CSV', extensions: ['csv'] },
        { name: 'Texto', extensions: ['txt'] }
      ]
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, data: res.filePaths[0] };
  });

  ipcMain.handle('tecnicos:previewImport', (e, filePath) => {
    try {
      return { ok: true, data: importTecnicos(filePath) };
    } catch (err) {
      return { ok: false, error: 'No se pudo leer el archivo: ' + err.message };
    }
  });

  ipcMain.handle('tecnicos:importSave', (e, names) => {
    let added = 0, skipped = 0;
    for (const n of names || []) {
      const nombre = String(n).trim().replace(/\s+/g, ' ');
      if (!nombre) continue;
      const dup = db.get('SELECT id FROM tecnicos WHERE lower(nombre) = ?', [nombre.toLowerCase()]);
      if (dup) { skipped++; continue; }
      db.run('INSERT INTO tecnicos (nombre, telefono, creado) VALUES (?,?,?)', [nombre, '', db.nowStamp()]);
      added++;
    }
    return { ok: true, data: { added, skipped } };
  });

  ipcMain.handle('settings:get', () => ({ ok: true, data: settingsAll() }));
  ipcMain.handle('settings:save', (e, s) => {
    if (s && typeof s === 'object') {
      if ('negocio' in s) db.setSetting('negocio', String(s.negocio || ''));
      const keys = {
        recordatorio_enabled: '0',
        recordatorio_medio: 'grupo',
        recordatorio_dias: '3',
        recordatorio_hora: '09:00',
        recordatorio_max: '3',
        wa_grupo_piezas: ''
      };
      for (const k of Object.keys(keys)) {
        if (k in s) db.setSetting(k, String(s[k] == null ? keys[k] : s[k]));
      }
      if ('sync_url' in s) db.setSetting('sync_url', String(s.sync_url || '').trim());
      if ('sync_enabled' in s) db.setSetting('sync_enabled', s.sync_enabled ? '1' : '0');
    }
    return { ok: true, data: settingsAll() };
  });

  ipcMain.handle('sync:status', () => ({ ok: true, data: syncSvc.estado() }));

  ipcMain.handle('sync:run', async () => {
    const r = await syncSvc.sincronizar(true);
    return r;
  });

  ipcMain.handle('sync:setTecnicoPass', (e, id, { habilitado, pass } = {}) => {
    const t = db.get('SELECT * FROM tecnicos WHERE id = ?', [id]);
    if (!t) return { ok: false, error: 'Técnico no encontrado' };
    const p = String(pass || '');
    if (habilitado && p.length < 4) return { ok: false, error: 'La contraseña debe tener al menos 4 caracteres' };
    db.run('UPDATE tecnicos SET sync_pass = ? WHERE id = ?', [habilitado ? p : '__clear__', id]);
    return { ok: true, data: db.get('SELECT id, nombre FROM tecnicos WHERE id = ?', [id]) };
  });

  ipcMain.handle('license:status', () => ({
    ok: true,
    data: { ...license.getStatus(), machineId: license.machineId() }
  }));

  ipcMain.handle('license:activate', (e, { key } = {}) => {
    const payload = license.activate(String(key || '').trim());
    return { ok: true, payload };
  });

  ipcMain.handle('license:deactivate', () => {
    license.deactivate();
    return { ok: true, data: license.getStatus() };
  });

  ipcMain.handle('wa:status', () => ({ ok: true, data: whatsapp.snapshot() }));
  ipcMain.handle('wa:connect', async () => { await whatsapp.connect(); return { ok: true, data: whatsapp.snapshot() }; });
  ipcMain.handle('wa:disconnect', async () => { await whatsapp.disconnect(); return { ok: true, data: whatsapp.snapshot() }; });
  ipcMain.handle('wa:resetSession', async () => { await whatsapp.resetSession(); return { ok: true, data: whatsapp.snapshot() }; });

  ipcMain.handle('wa:send', async (e, { reportId }) => {
    try {
      const lic = license.canUse();
      if (!lic.ok) throw new Error('Licencia de NEXALERT no disponible: ' + lic.reason + '. Activa tu licencia en la pantalla de inicio.');
      const rp = db.get('SELECT * FROM reportes WHERE id = ?', [reportId]);
      if (!rp) return { ok: false, error: 'Reporte no encontrado' };
      const client = db.get('SELECT * FROM clients WHERE id = ?', [rp.client_id]);
      const s = settingsAll();
      const msg = buildReportMsg(client, reporteEquiposOrPrimary(rp), rp, s);
      const sentTo = await whatsapp.sendToGroup(rp.grupo_id || rp.grupo_nombre, msg);
      db.run('UPDATE reportes SET enviado = 1, enviado_at = ?, mensaje = ?, grupo_nombre = ? WHERE id = ?',
        [db.nowStamp(), msg, sentTo, reportId]);
      addReporteEvent(reportId, 'enviado', 'Enviado al grupo ' + sentTo + '.');
      return { ok: true, data: { sentTo, message: msg } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('wa:mensajes:list', () => {
    const rows = db.all(`SELECT * FROM wa_mensajes ORDER BY id DESC LIMIT 300`);
    return { ok: true, data: rows };
  });

  ipcMain.handle('wa:mensajes:leer', (e, ids) => {
    if (ids && ids.length) {
      for (const id of ids) db.run('UPDATE wa_mensajes SET leido = 1 WHERE id = ?', [Number(id)]);
    } else {
      db.run('UPDATE wa_mensajes SET leido = 1');
    }
    return { ok: true };
  });

  ipcMain.handle('wa:mensajes:borrar', (e, id) => {
    db.run('DELETE FROM wa_mensajes WHERE id = ?', [Number(id)]);
    return { ok: true };
  });

  ipcMain.handle('wa:mensajes:borrarTodos', () => {
    db.run('DELETE FROM wa_mensajes');
    return { ok: true };
  });

  ipcMain.handle('wa:mensajes:enviar', async (e, { jid, texto, media, reply, mentions } = {}) => {
    try {
      const lic = license.canUse();
      if (!lic.ok) throw new Error('Licencia de NEXALERT no disponible: ' + lic.reason + '. Activa tu licencia en la pantalla de inicio.');
      const txt = String(texto || '').trim();
      const tipo = media && media.tipo ? String(media.tipo) : '';
      const mentionsArr = Array.isArray(mentions) ? mentions.filter((j) => j && /@/.test(String(j))) : [];
      if (!jid) return { ok: false, error: 'Conversación no válida.' };
      if (!txt && !tipo) return { ok: false, error: 'Escribe un mensaje o adjunta un archivo para enviar.' };
      let res;
      let mediaArchivo = '';
      let mediaMime = '';
      if (tipo && media && media.dataBase64) {
        const buff = Buffer.from(String(media.dataBase64), 'base64');
        res = await whatsapp.sendMediaTo(jid, { tipo, buffer: buff, caption: txt, fileName: media.nombre, mime: media.mime, reply, mentions: mentionsArr });
        mediaArchivo = whatsapp.guardarMediaBuffer(buff, media.ext || '');
        mediaMime = String(media.mime || '');
      } else {
        res = await whatsapp.sendMessageTo(jid, txt, reply, mentionsArr);
      }
      const outJid = String(res.jid || jid);
      const out = {
        id: res.id || ('out' + Date.now()),
        jid: outJid,
        telefono: outJid.endsWith('@g.us') ? '' : whatsapp.normalizarTelefono(whatsapp.resolverLid ? whatsapp.resolverLid(outJid) : outJid),
        nombre: 'Yo',
        remitente: '',
        avatar: '',
        texto: txt,
        media: tipo,
        mediaArchivo,
        mediaMime,
        isGroup: outJid.endsWith('@g.us'),
        fromMe: true,
        mentionIds: mentionsArr,
        fecha: Date.now()
      };
      const row = waSaveMensaje(out);
      sendToRenderer('wa:newmensaje', row);
      return { ok: true, data: row };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('wa:mensajes:grupo', async (e, jid) => {
    try {
      if (!/^[\d-]+@g\.us$/.test(String(jid || ''))) return { ok: false, error: 'Conversación no válida' };
      const data = await whatsapp.obtenerParticipantes(String(jid));
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('wa:mensajes:media', (e, fileName, mime) => {
    if (!/^[A-Za-z0-9._@-]+$/.test(String(fileName || ''))) return { ok: false, error: 'Nombre de archivo inválido' };
    const p = path.join(waMediaDir(), fileName);
    if (!fs.existsSync(p)) return { ok: false, error: 'Media no disponible' };
    const buf = fs.readFileSync(p);
    const m = /^[a-z0-9][a-z0-9+.-]*\/[a-z0-9+.-]*$/i.test(String(mime || '')) ? String(mime) : adjuntosMime(path.basename(fileName));
    return { ok: true, data: 'data:' + m + ';base64,' + buf.toString('base64') };
  });

  ipcMain.handle('wa:mensajes:abrirMedia', (e, fileName) => {
    if (!/^[A-Za-z0-9._@-]+$/.test(String(fileName || ''))) return { ok: false, error: 'Nombre de archivo inválido' };
    const p = path.join(waMediaDir(), fileName);
    if (!fs.existsSync(p)) return { ok: false, error: 'Media no disponible' };
    shell.openPath(p);
    return { ok: true };
  });

  ipcMain.handle('wa:mensajes:importarStickers', (e, archivos) => {
    try {
      const lista = Array.isArray(archivos) ? archivos : [];
      const guardados = [];
      for (const a of lista) {
        const b64 = String((a && a.dataBase64) || '');
        if (!b64) continue;
        const buff = Buffer.from(b64, 'base64');
        if (!buff.length) continue;
        const ext = String((a && a.ext) || 'webp');
        const nombre = whatsapp.guardarMediaBuffer(buff, ext);
        if (nombre) guardados.push(nombre);
      }
      return { ok: true, archivos: guardados };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('wa:mensajes:descargar', async (e, fileName, defaultName) => {
    if (!/^[A-Za-z0-9._@-]+$/.test(String(fileName || ''))) return { ok: false, error: 'Nombre de archivo inválido' };
    const p = path.join(waMediaDir(), fileName);
    if (!fs.existsSync(p)) return { ok: false, error: 'Media no disponible' };
    const sugerido = String(defaultName || path.basename(fileName)).replace(/[\\/:*?"<>|]/g, '_');
    const res = await dialog.showSaveDialog({
      title: 'Guardar imagen',
      defaultPath: path.join(app.getPath('downloads'), sugerido)
    });
    if (res.canceled || !res.filePath) return { ok: true, cancel: true };
    fs.copyFileSync(p, res.filePath);
    return { ok: true, path: res.filePath };
  });

  ipcMain.handle('wa:mensajes:cliente', (e, { telefono, nombre } = {}) => {
    const tel = whatsapp.normalizarTelefono(String(telefono || '').replace(/^\+/, ''));
    const nom = String(nombre || '').trim();
    if (!tel && !nom) return { ok: false, error: 'El mensaje no tiene teléfono ni nombre para identificar al cliente.' };
    let cl = null;
    if (tel && tel.length >= 8) {
      const candidates = db.all('SELECT * FROM clients WHERE telefono IS NOT NULL AND telefono != \'\'');
      const t = tel.length > 10 ? tel.slice(-10) : tel;
      cl = candidates.find((c) => {
        const ct = String(c.telefono).replace(/\D/g, '').replace(/^0+/, '');
        const ctn = ct.length > 10 ? ct.slice(-10) : ct;
        return ctn === t;
      }) || null;
    }
    if (!cl && nom) {
      cl = db.all('SELECT * FROM clients WHERE lower(nombre) = ?', [nom.toLowerCase()])[0] || null;
    }
    if (!cl) {
      const id = db.run('INSERT INTO clients (nombre, telefono, creado) VALUES (?,?,?)',
        [nom || tel || 'Cliente WhatsApp', tel, db.nowStamp()]);
      cl = db.get('SELECT * FROM clients WHERE id = ?', [id]);
    } else if (!cl.telefono && tel) {
      db.run('UPDATE clients SET telefono = ? WHERE id = ?', [tel, cl.id]);
      cl.telefono = tel;
    }
    return { ok: true, data: { client_id: cl.id, client: cl } };
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    title: 'NexAlert',
    icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, 'renderer', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'media');
  });
  win.webContents.session.setPermissionCheckHandler((wc, permission) => permission === 'media');
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (/^https?:/i.test(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  whatsapp.on('status', (s) => {
    if (win && !win.isDestroyed()) win.webContents.send('wa:status', s);
    if (s.status === 'ready') backfillMensajes();
  });
  whatsapp.on('message', (m) => {
    try {
      const row = waSaveMensaje(m);
      if (!row) return;
      sendToRenderer('wa:newmensaje', row);
      notificarNuevoMensaje(m);
    } catch (e) { /* noop */ }
  });
  whatsapp.on('lid-update', () => {
    try { repararTelefonos(); } catch (e) { /* noop */ }
    try { backfillMensajes(); } catch (e) { /* noop */ }
    sendToRenderer('wa:mensajes:update');
  });
}

function smoke() {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rep-smoke-'));
  const licDir = path.join(tmp, 'lic');
  license.setStorePath(path.join(licDir, 'nexalert-license.json'));
  const licStatus = license.getStatus();
  const licCanUse = license.canUse();
  db.open(path.join(tmp, 'smoke.db')).then(() => {
    const c = db.run(`INSERT INTO clients (nombre, telefono, creado) VALUES ('EMPRESA A','809-000-0000',?)`, [db.nowStamp()]);
    const e = db.run(`INSERT INTO equipos (client_id, nombre, marca, serial, creado) VALUES (?, 'POS', 'Hikvision', 'S-001', ?)`, [c, db.nowStamp()]);
    const r = db.run(`INSERT INTO reportes (client_id, equipo_id, descripcion, fecha, estado, grupo_id, grupo_nombre, creado) VALUES (?, ?, 'No enciende la pantalla', ?, 'abierto', ?, ?, ?)`, [c, e, db.nowStamp(), '123456@g.us', 'MANTENIMIENTO PRUEBA', db.nowStamp()]);
    const t = db.run(`INSERT INTO tecnicos (nombre, telefono, creado) VALUES ('JUAN PEREZ','809-111-2222',?)`, [db.nowStamp()]);
    db.run(`UPDATE reportes SET tecnico_id = ?, tecnico_nombre = 'JUAN PEREZ', asignado_at = ? WHERE id = ?`, [t, db.nowDateTime(), r]);
    addReporteEvent(r, 'enviado', 'Enviado al grupo MANTENIMIENTO PRUEBA.');
    db.run(`UPDATE reportes SET archivado = 1, archivado_at = ? WHERE id = ?`, [db.nowDateTime(), r]);
    addReporteEvent(r, 'archivado', 'Reporte archivado.');
    db.run(`INSERT INTO reportes (client_id, equipo_id, descripcion, fecha, estado, resuelto_at, creado) VALUES (?, ?, 'Resuelto viejo', ?, 'resuelto', '2020-01-01 00:00:00', ?)`, [c, e, db.nowStamp(), db.nowStamp()]);
    const autoArchivados = autoArchivarResueltos();
    const csv = path.join(tmp, 'tecnicos.csv');
    fs.writeFileSync(csv, 'nombre,telefono\nMARIA LOPEZ,809-333-4444\nPEDRO DIAZ,\nJuan Perez\n');
    const importados = importTecnicos(csv);
    const list = db.all('SELECT r.*, c.nombre AS cliente_nombre, e.nombre AS equipo_nombre FROM reportes r LEFT JOIN clients c ON c.id=r.client_id LEFT JOIN equipos e ON e.id=r.equipo_id');
    const eventos = db.all('SELECT * FROM reporte_eventos WHERE reporte_id = ? ORDER BY id ASC', [r]);
    const activos = db.all('SELECT COUNT(*) AS n FROM reportes WHERE archivado = 0')[0].n;
    const archivados = db.all('SELECT COUNT(*) AS n FROM reportes WHERE archivado = 1')[0].n;
    console.log('SMOKE: clientes=' + db.all('SELECT COUNT(*) AS n FROM clients')[0].n + ' | equipos=' + db.all('SELECT COUNT(*) AS n FROM equipos')[0].n + ' | reportes=' + list.length + ' | tecnico=' + list[0].tecnico_nombre + ' | eventos=' + eventos.length + ' | importCSV=' + importados.join('/') + ' | activos=' + activos + ' | archivados=' + archivados + ' | autoArchivados=' + autoArchivados + ' | licTrial=' + licStatus.trial.daysLeft + 'd | licUsable=' + (licCanUse.ok ? 'SI' : 'NO'));
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    app.exit(0);
  }).catch((e) => { console.error('SMOKE FAIL', e); app.exit(1); });
}

function repararTelefonos() {
  try {
    const rows = db.all('SELECT id, jid, telefono, participant, es_grupo FROM wa_mensajes');
    let cambios = 0;
    for (const r of rows) {
      const jid = String(r.jid || '');
      let nuevo = '';
      if (Number(r.es_grupo) === 1) {
        if (r.participant) {
          const pReal = whatsapp.resolverLid ? whatsapp.resolverLid(String(r.participant)) : String(r.participant);
          nuevo = whatsapp.normalizarTelefono(pReal);
        }
      } else {
        nuevo = whatsapp.normalizarTelefono(whatsapp.resolverLid ? whatsapp.resolverLid(jid) : jid);
      }
      if (nuevo !== String(r.telefono || '')) {
        db.run('UPDATE wa_mensajes SET telefono = ? WHERE id = ?', [nuevo, r.id]);
        cambios++;
      }
    }
    if (cambios) console.log('Reparados ' + cambios + ' teléfonos en mensajes.');
  } catch (e) {
    console.error('Reparación de teléfonos fallida', e);
  }
}

app.whenReady().then(() => {
  if (process.argv.includes('--smoke')) return smoke();
  whatsapp.configure(path.join(app.getPath('userData'), 'baileys'));
  whatsapp.configureMedia(waMediaDir());
  license.setStorePath(path.join(app.getPath('userData'), 'nexalert-license.json'));
  db.open(path.join(dataDir(), 'reportes.db')).then(() => {
    registerIpc();
    try { dedupeMediaFiles(); } catch (e) { console.error('Deduplicación de media fallida', e); }
    try { autoArchivarResueltos(); } catch (e) { console.error('Auto-archivado fallido', e); }
    try { repararTelefonos(); } catch (e) { console.error('Reparación de teléfonos fallida', e); }
    try { iniciarRecordatorios(); } catch (e) { console.error('Recordatorios fallidos', e); }
    try { syncSvc.iniciar(); } catch (e) { console.error('Sincronización fallida', e); }
    createWindow();
    autoUpdater.logger = { info: (m) => dbg('UPDATE: ' + m), warn: (m) => dbg('UPDATE WARN: ' + m), error: (m) => dbg('UPDATE ERR: ' + m) };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (info) => {
      dbg('Update disponible: v' + info.version);
      sendToRenderer('app:update-available', { version: info.version });
    });
    autoUpdater.on('download-progress', (p) => {
      sendToRenderer('app:update-progress', { percent: Math.round(p.percent) });
    });
    autoUpdater.on('update-downloaded', (info) => {
      dbg('Update descargado: v' + info.version);
      sendToRenderer('app:update-downloaded', { version: info.version });
    });
    autoUpdater.on('error', (e) => { dbg('Update error: ' + e.message); });
    setTimeout(() => { autoUpdater.checkForUpdatesAndNotify().catch(() => {}); }, 15000);
    ipcMain.handle('app:install-update', () => { autoUpdater.quitAndInstall(); });
    setTimeout(() => { try { notifyPendientes(true); } catch (e) { /* noop */ } }, 8000);
    setTimeout(() => { try { notificarVencimientoLicencia(); } catch (e) { /* noop */ } }, 12000);
    setInterval(() => {
      try { if (autoArchivarResueltos() > 0) notifyChanged(); } catch (e) { /* noop */ }
    }, 60 * 60 * 1000);
    setInterval(() => {
      try { if (win && !win.isDestroyed() && !win.isFocused()) notifyPendientes(true); } catch (e) { /* noop */ }
    }, 15 * 60 * 1000);
    setInterval(() => {
      try { notificarVencimientoLicencia(); } catch (e) { /* noop */ }
    }, 6 * 60 * 60 * 1000);
    setInterval(() => {
      try { if (whatsapp.status === 'ready') backfillMensajes(); } catch (e) { /* noop */ }
    }, 90 * 1000);
    const baileysDir = path.join(app.getPath('userData'), 'baileys');
    if (fs.existsSync(path.join(baileysDir, 'creds.json'))) whatsapp.connect();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

app.on('will-quit', () => {
  if (process.argv.includes('--smoke')) return;
  try { db.close(); } catch (e) { /* noop */ }
  try { hacerBackup(); } catch (e) { console.error('Backup fallido', e); }
});
