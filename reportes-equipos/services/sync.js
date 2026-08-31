'use strict';
const path = require('path');
const fs = require('fs');
const db = require('./db');

const ESTADO_LABEL = { abierto: 'Abierto', en_proceso: 'En proceso', resuelto: 'Resuelto', espera_repuesto: 'Espera de repuesto', espera_cliente: 'Espera del cliente' };

const STATE = { corriendo: false, conectado: false, error: null, ultimo: null, timer: null };

const LOG_PATH = path.join(process.env.APPDATA || path.join(require('os').tmpdir(), 'nexalert-tmp'), 'NexAlert', 'debug.log');
function dbg(msg) { try { fs.appendFileSync(LOG_PATH, new Date().toISOString() + ' [sync] ' + String(msg) + '\n'); } catch (_) {} }

function adjuntosDir() {
  if (global.__nexalertAdjuntos) return global.__nexalertAdjuntos;
  const base = process.env.APPDATA || path.join(require('os').tmpdir(), 'nexalert-tmp');
  return path.join(base, 'NexAlert', 'adjuntos');
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

function arrAdjuntos(v) {
  try {
    const a = JSON.parse(v || '[]');
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
  } catch (e) { return []; }
}

function settings() {
  return {
    enabled: db.getSetting('sync_enabled', '0') === '1',
    url: db.getSetting('sync_url', ''),
    deviceToken: db.getSetting('sync_device_token', ''),
    seq: Number(db.getSetting('sync_seq', '0')),
    last: db.getSetting('sync_last', '')
  };
}

function estado() {
  return { ...settings(), corriendo: STATE.corriendo, conectado: STATE.conectado, error: STATE.error, ultimo: STATE.ultimo };
}

function pushTecnicos() {
  return db.all('SELECT id, nombre, telefono, rol, sync_pass FROM tecnicos').map((t) => ({
    id: t.id,
    nombre: t.nombre || '',
    telefono: t.telefono || '',
    rol: t.rol || 'tecnico',
    pass: t.sync_pass || ''
  }));
}

function pushReportes() {
  const rows = db.all(`SELECT r.*, c.nombre AS client_nombre_join, e.nombre AS equipo_nombre_join
    FROM reportes r
    LEFT JOIN clients c ON c.id = r.client_id
    LEFT JOIN equipos e ON e.id = r.equipo_id`);
  return rows.map((r) => ({
    id: r.id,
    client_id: r.client_id,
    client_nombre: r.client_nombre || r.client_nombre_join || '',
    equipo_nombre: r.equipo_nombre || r.equipo_nombre_join || '',
    descripcion: r.descripcion || '',
    fecha: r.fecha || '',
    estado: r.estado || 'abierto',
    prioridad: r.prioridad || 'normal',
    solucion: r.solucion || '',
    tecnico_id: r.tecnico_id || null,
    tecnico_nombre: r.tecnico_nombre || '',
    resuelto_at: r.resuelto_at || '',
    archivado: r.archivado ? 1 : 0,
    adjuntos: arrAdjuntos(r.adjuntos),
    lat: r.lat != null ? Number(r.lat) : null,
    lng: r.lng != null ? Number(r.lng) : null,
    asignado_at: r.asignado_at || '',
    grupo_id: r.grupo_id || '',
    grupo_nombre: r.grupo_nombre || '',
    enviar_grupo: r.enviar_grupo != null ? Number(r.enviar_grupo) : 1,
    updated_at: r.updated_at || (r.creado ? r.creado + 'T00:00:00Z' : new Date().toISOString())
  }));
}

function pushFotos() {
  const dir = adjuntosDir();
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const enviadas = new Set(db.all('SELECT nombre FROM fotos_enviadas').map((r) => r.nombre));
  for (const rp of db.all('SELECT id, adjuntos FROM reportes')) {
    for (const nombre of arrAdjuntos(rp.adjuntos)) {
      if (enviadas.has(nombre)) continue;
      if (!/^[A-Za-z0-9._@-]+$/.test(nombre)) continue;
      const p = path.join(dir, nombre);
      if (!fs.existsSync(p)) continue;
      let size = 0;
      try { size = fs.statSync(p).size; } catch (e) { continue; }
      if (size < 1 || size > 8 * 1024 * 1024) continue;
      out.push({ reporte_id: rp.id, nombre, tipo: adjuntosMime(nombre), datos: fs.readFileSync(p).toString('base64'), autor: 'NexAlert' });
    }
  }
  return out;
}

function marcarFotosEnviadas(fotos) {
  const ahora = db.nowDateTime();
  for (const f of fotos || []) {
    if (!f || !f.nombre) continue;
    db.run('INSERT OR IGNORE INTO fotos_enviadas (nombre, reporte_id, enviado_at) VALUES (?, ?, ?)',
      [String(f.nombre), Number(f.reporte_id) || null, ahora]);
  }
}

function pushTombstones() {
  return db.all('SELECT reporte_id, updated_at FROM sync_tombstones');
}

function aplicarCambios(cambios) {
  let aplicados = 0;
  const esperaIds = [];
  const asignadoIds = [];
  for (const c of cambios || []) {
    if (c.tipo === 'reporte_upsert' && c.reporte) {
      const rp = c.reporte;
      const existing = db.get('SELECT * FROM reportes WHERE id = ?', [rp.id]);
      if (!existing) {
        db.run(`INSERT INTO reportes (id, client_id, client_nombre, equipo_nombre, descripcion, fecha, estado, prioridad,
          solucion, tecnico_id, tecnico_nombre, resuelto_at, archivado, adjuntos, lat, lng, grupo_id, grupo_nombre, enviar_grupo, enviado, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          [rp.id, rp.client_id || 0, rp.client_nombre || '', rp.equipo_nombre || '', rp.descripcion || '',
           rp.fecha || '', rp.estado || 'abierto', rp.prioridad || 'normal', rp.solucion || '',
           rp.tecnico_id || null, rp.tecnico_nombre || '', rp.resuelto_at || null,
           rp.archivado ? 1 : 0, JSON.stringify(rp.adjuntos || []), rp.lat || null, rp.lng || null,
           rp.grupo_id || '', rp.grupo_nombre || '', rp.enviar_grupo != null ? (rp.enviar_grupo ? 1 : 0) : 1,
           rp.updated_at || '']);
        db.run('INSERT INTO reporte_eventos (reporte_id, tipo, detalle, creado) VALUES (?,?,?,?)',
          [rp.id, 'creado', 'Reporte creado desde móvil', rp.updated_at || new Date().toISOString()]);
        aplicados++;
      } else {
        const oldTec = existing.tecnico_id || null;
        const newTec = rp.tecnico_id || null;
        db.run(`UPDATE reportes SET client_id=?, client_nombre=?, equipo_nombre=?, descripcion=?, fecha=?, estado=?, prioridad=?,
          solucion=?, tecnico_id=?, tecnico_nombre=?, resuelto_at=?, archivado=?, adjuntos=?, lat=?, lng=?,
          grupo_id=?, grupo_nombre=?, enviar_grupo=?, updated_at=? WHERE id=?`,
          [rp.client_id || 0, rp.client_nombre || '', rp.equipo_nombre || '', rp.descripcion || '',
           rp.fecha || '', rp.estado || 'abierto', rp.prioridad || 'normal', rp.solucion || '',
           newTec, rp.tecnico_nombre || '', rp.resuelto_at || null,
           rp.archivado ? 1 : 0, JSON.stringify(rp.adjuntos || []), rp.lat || null, rp.lng || null,
           rp.grupo_id || '', rp.grupo_nombre || '', rp.enviar_grupo != null ? (rp.enviar_grupo ? 1 : 0) : 1,
           rp.updated_at || existing.updated_at || '', rp.id]);
        if (newTec && oldTec !== newTec) asignadoIds.push(rp.id);
        aplicados++;
      }
      continue;
    }
    if (!c || !c.reporte_id) continue;
    if (c.tipo === 'estado') {
      const label = ESTADO_LABEL[c.estado] || c.estado;
      const detalle = 'Estado → ' + label + '.';
      const rp = db.get('SELECT id, estado, resuelto_at FROM reportes WHERE id = ?', [c.reporte_id]);
      if (!rp) continue;
      let rAt = null;
      if (c.estado === 'resuelto') rAt = rp.estado === 'resuelto' ? rp.resuelto_at : db.shiftUtcToLocal(c.creado, 'dt');
      if (c.enviar_grupo != null) {
        db.run('UPDATE reportes SET estado = ?, resuelto_at = ?, enviar_grupo = ?, updated_at = ? WHERE id = ?', [c.estado, rAt, c.enviar_grupo ? 1 : 0, c.creado, c.reporte_id]);
      } else {
        db.run('UPDATE reportes SET estado = ?, resuelto_at = ?, updated_at = ? WHERE id = ?', [c.estado, rAt, c.creado, c.reporte_id]);
      }
      if (c.solucion) {
        db.run('UPDATE reportes SET solucion = ? WHERE id = ?', [c.solucion, c.reporte_id]);
      }
      const ya = db.get('SELECT id FROM reporte_eventos WHERE reporte_id = ? AND tipo = ? AND detalle = ?', [c.reporte_id, 'estado', detalle]);
      if (!ya) {
        db.run('INSERT INTO reporte_eventos (reporte_id, tipo, detalle, creado) VALUES (?,?,?,?)',
          [c.reporte_id, 'estado', detalle, db.shiftUtcToLocal(c.creado, 'dt')]);
      }
      if ((c.estado === 'espera_repuesto' || c.estado === 'espera_cliente') && c.enviar_grupo !== 0) {
        esperaIds.push(c.reporte_id);
      }
      aplicados++;
    } else if (c.tipo === 'nota') {
      const ya = db.get('SELECT id FROM reporte_eventos WHERE reporte_id = ? AND tipo = ? AND detalle = ?', [c.reporte_id, 'nota', c.texto]);
      if (!ya) {
        db.run('INSERT INTO reporte_eventos (reporte_id, tipo, detalle, creado) VALUES (?,?,?,?)',
          [c.reporte_id, 'nota', c.texto, db.shiftUtcToLocal(c.creado, 'dt')]);
        aplicados++;
      }
    } else if (c.tipo === 'foto') {
      const nombre = String(c.nombre || '');
      const reporte = db.get('SELECT id, adjuntos FROM reportes WHERE id = ?', [c.reporte_id]);
      if (!reporte || !nombre || !/^[A-Za-z0-9._@-]+$/.test(nombre)) { dbg('SKIP foto: ' + nombre + ' reporte: ' + !!reporte); continue; }
      const dir = adjuntosDir();
      try {
        fs.mkdirSync(dir, { recursive: true });
        const datosLen = String(c.datos || '').length;
        const buf = Buffer.from(String(c.datos || ''), 'base64');
        dbg('foto nombre: ' + nombre + ' datosLen: ' + datosLen + ' bufLen: ' + buf.length + ' first: ' + buf.slice(0, 10).toString('hex'));
        if (buf.length) {
          fs.writeFileSync(path.join(dir, nombre), buf);
          dbg('foto escrita en: ' + path.join(dir, nombre));
        }
        const names = arrAdjuntos(reporte.adjuntos);
        if (!names.includes(nombre)) {
          names.push(nombre);
          db.run('UPDATE reportes SET adjuntos = ?, updated_at = ? WHERE id = ?', [JSON.stringify(names), c.creado || new Date().toISOString(), c.reporte_id]);
          dbg('adjuntos actualizado: ' + JSON.stringify(names));
          aplicados++;
        }
      } catch (e) { dbg('foto error: ' + e.message); }
    } else if (c.tipo === 'foto_del') {
      const nombre = String(c.nombre || '');
      const reporte = db.get('SELECT id, adjuntos FROM reportes WHERE id = ?', [c.reporte_id]);
      if (!reporte || !nombre || !/^[A-Za-z0-9._@-]+$/.test(nombre)) continue;
      const dir = adjuntosDir();
      try {
        const p = path.join(dir, nombre);
        if (fs.existsSync(p)) fs.unlinkSync(p);
        const names = arrAdjuntos(reporte.adjuntos).filter((n) => n !== nombre);
        db.run('UPDATE reportes SET adjuntos = ?, updated_at = ? WHERE id = ?', [JSON.stringify(names), c.creado || new Date().toISOString(), c.reporte_id]);
        const ya = db.get('SELECT id FROM reporte_eventos WHERE reporte_id = ? AND tipo = ? AND detalle = ?', [c.reporte_id, 'foto_del', nombre]);
        if (!ya) {
          db.run('INSERT INTO reporte_eventos (reporte_id, tipo, detalle, creado) VALUES (?,?,?,?)',
            [c.reporte_id, 'foto_del', 'Foto eliminada: ' + nombre, new Date().toISOString()]);
        }
        aplicados++;
      } catch (e) { /* noop */ }
    } else if (c.tipo === 'ubicacion') {
      try {
        const extra = JSON.parse(c.detalle || '{}');
        if (extra.lat != null && extra.lng != null) {
          db.run('UPDATE reportes SET lat = ?, lng = ? WHERE id = ?', [extra.lat, extra.lng, c.reporte_id]);
          aplicados++;
        }
      } catch (e) { /* noop */ }
    } else if (c.tipo === 'reporte_delete') {
      try {
        db.run('DELETE FROM reporte_eventos WHERE reporte_id = ?', [c.reporte_id]);
        db.run('DELETE FROM reporte_equipos WHERE reporte_id = ?', [c.reporte_id]);
        db.run('DELETE FROM reportes WHERE id = ?', [c.reporte_id]);
        aplicados++;
      } catch (e) { /* noop */ }
    } else if (c.tipo === 'reporte_archive') {
      try {
        const now = db.nowDateTime();
        db.run('UPDATE reportes SET archivado = 1, archivado_at = ?, updated_at = ? WHERE id = ?', [now, now, c.reporte_id]);
        aplicados++;
      } catch (e) { /* noop */ }
    }
  }
  if (esperaIds.length) {
    setTimeout(() => triggerEsperaWhatsApp(esperaIds), 500);
  }
  if (asignadoIds.length) {
    setTimeout(() => triggerAsignadoWhatsApp(asignadoIds), 500);
  }
  return aplicados;
}

function triggerEsperaWhatsApp(ids) {
  try {
    if (typeof global.onEsperaDetectado !== 'function') return;
    for (const id of ids) {
      global.onEsperaDetectado(id);
    }
  } catch (e) { /* noop */ }
}

function triggerAsignadoWhatsApp(ids) {
  try {
    if (typeof global.onAsignadoDetectado !== 'function') return;
    for (const id of ids) {
      global.onAsignadoDetectado(id);
    }
  } catch (e) { /* noop */ }
}

async function registrarDispositivo(url) {
  const res = await fetch(url.replace(/\/+$/, '') + '/api/device/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'NexAlert' })
  });
  const data = await res.json();
  if (!res.ok || !data.ok || !data.deviceToken) throw new Error(data.error || 'No se pudo registrar el dispositivo');
  db.setSetting('sync_device_token', data.deviceToken);
  return data.deviceToken;
}

async function sincronizar(manual) {
  const s = settings();
  if (!s.enabled && !manual) return { ok: false, error: 'desactivado' };
  const url = (s.url || '').trim().replace(/\/+$/, '');
  if (!url) return { ok: false, error: 'Sin URL de servidor configurada' };
  if (STATE.corriendo) return { ok: false, error: 'ya en curso' };
  STATE.corriendo = true;
  try {
    let deviceToken = s.deviceToken;
    if (!deviceToken) deviceToken = await registrarDispositivo(url);
    const fotosPush = pushFotos();
    const doFetch = () => fetch(url + '/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceToken,
        sinceSeq: s.seq,
        push: { tecnicos: pushTecnicos(), reportes: pushReportes(), tombstones: pushTombstones(), fotos: fotosPush }
      })
    });
    let res = await doFetch();
    if (res.status === 401) {
      db.setSetting('sync_device_token', '');
      deviceToken = await registrarDispositivo(url);
      res = await doFetch();
    }
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Respuesta no válida del servidor');

    marcarFotosEnviadas(fotosPush);

    const aplicados = aplicarCambios(data.cambios);
    if (aplicados > 0 && data.seq > s.seq) {
      try {
        const changed = typeof global.changed === 'function' ? global.changed : null;
        if (changed) changed();
      } catch (e) { /* noop */ }
    }
    db.setSetting('sync_seq', String(data.seq || s.seq));
    const ahora = db.nowDateTime();
    db.setSetting('sync_last', ahora);
    STATE.ultimo = ahora;
    STATE.conectado = true;
    STATE.error = null;
    if (Array.isArray(data.applied && data.applied.borrados)) {
      for (const id of data.applied.borrados) db.run('DELETE FROM sync_tombstones WHERE reporte_id = ?', [Number(id)]);
    } else if (pushTombstones().length) {
      db.run('DELETE FROM sync_tombstones');
    }
    return { ok: true, cambios: (data.cambios || []).length, aplicados, seq: data.seq };
  } catch (e) {
    STATE.conectado = false;
    STATE.error = e.message;
    return { ok: false, error: e.message };
  } finally {
    STATE.corriendo = false;
  }
}

function iniciar() {
  if (STATE.timer) clearInterval(STATE.timer);
  const loop = async () => {
    try { await sincronizar(false); } catch (e) { /* noop */ }
  };
  STATE.timer = setInterval(loop, 10 * 1000);
  if (settings().enabled) setTimeout(loop, 5000);
}

module.exports = { sincronizar, estado, iniciar, pushReportes, pushTecnicos, pushTombstones, pushFotos, aplicarCambios };
