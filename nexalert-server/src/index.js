'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const d = require('./db');

const LOG_FILE = path.join(__dirname, '..', 'data', 'server-debug.log');
function sdbg(msg) { try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + String(msg) + '\n'); } catch (_) {} }

d.init();

const a = require('./jwt');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use('/updates', express.static(path.join(__dirname, '..', 'updates')));
app.use(express.static(path.join(__dirname, '..', 'app')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'app', 'index.html')));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'nexalert-server', seq: d.lastSeq() });
});

app.post('/api/auth/login', (req, res) => {
  const out = a.loginTecnico(String(req.body.usuario || '').trim(), String(req.body.pass || ''));
  if (!out) return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' });
  res.json({ ok: true, ...out });
});

app.get('/api/auth/me', a.requireAuth('tecnico'), (req, res) => {
  res.json({ ok: true, tecnico: { id: req.user.sub, nombre: req.user.nombre, rol: req.user.rol || 'tecnico' } });
});

app.post('/api/device/register', (req, res) => {
  const nombre = String(req.body.nombre || '').trim() || 'NexAlert';
  res.json({ ok: true, deviceToken: a.deviceToken(nombre) });
});

const ESTADOS_VALIDOS = ['abierto', 'en_proceso', 'resuelto', 'espera_repuesto', 'espera_cliente'];

app.get('/api/reportes', a.requireAuth('tecnico'), (req, res) => {
  const isGerente = (req.user.rol || 'tecnico') === 'gerente';
  let rows;
  if (isGerente) {
    rows = d.db.prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM fotos f WHERE f.reporte_id = r.id) AS fotos_count
      FROM reportes r
      WHERE r.deleted = 0 AND r.archivado = 0
      ORDER BY r.fecha DESC, r.id DESC
    `).all();
  } else {
    rows = d.db.prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM fotos f WHERE f.reporte_id = r.id) AS fotos_count
      FROM reportes r
      WHERE r.deleted = 0 AND r.archivado = 0 AND r.tecnico_id = ?
      ORDER BY r.fecha DESC, r.id DESC
    `).all(req.user.sub);
  }
  res.json({ ok: true, data: rows.map((r) => ({ ...d.reportePublico(r), fotos_count: Number(r.fotos_count || 0) })) });
});

function requireGerente(req, res, next) {
  if ((req.user.rol || 'tecnico') !== 'gerente') return res.status(403).json({ ok: false, error: 'Se requiere rol de gerente' });
  next();
}

app.get('/api/reportes/all', a.requireAuth('tecnico'), requireGerente, (req, res) => {
  try {
    res.json({ ok: true, data: d.getReportesAll() });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/tecnicos', a.requireAuth('tecnico'), requireGerente, (req, res) => {
  try {
    res.json({ ok: true, data: d.getTecnicosList() });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/tecnicos/:id/desactivar', a.requireAuth('tecnico'), requireGerente, (req, res) => {
  try {
    const id = Number(req.params.id);
    const t = d.db.prepare('SELECT id, nombre FROM tecnicos WHERE id = ?').get(id);
    if (!t) return res.status(404).json({ ok: false, error: 'Tecnico no encontrado' });
    const ahora = d.nowUTC();
    d.db.prepare('UPDATE tecnicos SET activo = 0, updated_at = ? WHERE id = ?').run(ahora, id);
    d.seq('tecnico', id, '');
    res.json({ ok: true, data: { id, nombre: t.nombre, activo: 0 } });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.delete('/api/reportes/:id', a.requireAuth('tecnico'), requireGerente, (req, res) => {
  try {
    const id = Number(req.params.id);
    const rp = d.db.prepare('SELECT id FROM reportes WHERE id = ? AND deleted = 0').get(id);
    if (!rp) return res.status(404).json({ ok: false, error: 'Reporte no encontrado' });
    d.marcarBorrado(id, d.nowUTC());
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/reportes/:id/asignar', a.requireAuth('tecnico'), requireGerente, (req, res) => {
  try {
    const id = Number(req.params.id);
    const tecnicoId = req.body.tecnico_id ? Number(req.body.tecnico_id) : null;
    const tecnicoNombre = String(req.body.tecnico_nombre || '').trim();
    const rp = d.db.prepare('SELECT id FROM reportes WHERE id = ? AND deleted = 0').get(id);
    if (!rp) return res.status(404).json({ ok: false, error: 'Reporte no encontrado' });
    const out = d.asignarReporte(id, tecnicoId, tecnicoNombre, req.user.nombre);
    const fullRp = d.db.prepare('SELECT client_nombre, equipo_nombre, descripcion FROM reportes WHERE id = ?').get(id);
    if (tecnicoId) {
      const tokens = d.getPushTokens(tecnicoId);
      if (tokens.length && fullRp) {
        const cliente = fullRp.client_nombre || 'Cliente';
        const equipo = fullRp.equipo_nombre || '';
        const desc = fullRp.descripcion ? ' - ' + fullRp.descripcion.slice(0, 60) : '';
        sendPush(tokens, 'Reporte asignado', cliente + (equipo ? ' - ' + equipo : '') + desc, { reporteId: String(id), tipo: 'asignado' }).catch((e) => console.log('PUSH ERR: ' + e.message));
      }
    }
    if (tecnicoId && fullRp) {
      const gerenteTokens = d.getGerentePushTokens();
      if (gerenteTokens.length) {
        const quien = req.user && req.user.nombre ? String(req.user.nombre) : 'Un gerente';
        const clienteGer = fullRp.client_nombre || 'Cliente';
        sendPush(gerenteTokens, 'Asignacion de tecnico',
          quien + ' asigno al tecnico ' + tecnicoNombre + ' el reporte #' + id + ' (' + clienteGer + ')',
          { reporteId: String(id), tipo: 'asignado-gerente' }).catch((e) => console.log('PUSH ERR: ' + e.message));
      }
    }
    res.json({ ok: true, data: out });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/reportes/archived', a.requireAuth('tecnico'), (req, res) => {
  try {
    const rows = d.db.prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM fotos f WHERE f.reporte_id = r.id) AS fotos_count
      FROM reportes r
      WHERE r.deleted = 0 AND r.archivado = 1
      ORDER BY r.resuelto_at DESC, r.id DESC
    `).all();
    res.json({ ok: true, data: rows.map((r) => ({ ...d.reportePublico(r), fotos_count: Number(r.fotos_count || 0) })) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/reportes/auto-archive', a.requireAuth('tecnico'), (req, res) => {
  try {
    const archived = d.autoArchiveResolved();
    res.json({ ok: true, archived });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/stats/global', a.requireAuth('tecnico'), requireGerente, (req, res) => {
  try {
    res.json({ ok: true, data: d.getStatsGlobal() });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

function findReportForUser(id, user) {
  if ((user.rol || 'tecnico') === 'gerente') {
    return d.db.prepare('SELECT * FROM reportes WHERE id = ? AND deleted = 0').get(id);
  }
  return d.db.prepare('SELECT * FROM reportes WHERE id = ? AND deleted = 0 AND archivado = 0 AND tecnico_id = ?').get(id, user.sub);
}

function findReportForUserNoArch(id, user) {
  if ((user.rol || 'tecnico') === 'gerente') {
    return d.db.prepare('SELECT id FROM reportes WHERE id = ? AND deleted = 0').get(id);
  }
  return d.db.prepare('SELECT id FROM reportes WHERE id = ? AND deleted = 0 AND archivado = 0 AND tecnico_id = ?').get(id, user.sub);
}

app.get('/api/reportes/:id', a.requireAuth('tecnico'), (req, res) => {
  const rp = findReportForUser(Number(req.params.id), req.user);
  if (!rp) return res.status(404).json({ ok: false, error: 'Reporte no encontrado o no asignado' });
  const notas = d.db.prepare('SELECT * FROM notas WHERE reporte_id = ? ORDER BY id ASC').all(rp.id);
  const fotos = d.fotosDeReporte(rp.id).map(d.fotoPublico);
  res.json({ ok: true, data: { ...d.reportePublico(rp), notas, fotos } });
});

app.post('/api/reportes/:id/estado', a.requireAuth('tecnico'), (req, res) => {
  const estado = String(req.body.estado || '');
  if (!ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ ok: false, error: 'Estado no válido' });
  const rp = findReportForUserNoArch(Number(req.params.id), req.user);
  if (!rp) return res.status(404).json({ ok: false, error: 'Reporte encontrado o no asignado' });
  const isGerente = (req.user.rol || 'tecnico') === 'gerente';
  if (rp.estado === 'resuelto' && !isGerente) return res.status(403).json({ ok: false, error: 'Reporte resuelto. Solo el gerente puede cambiar el estado.' });
  try {
    const solucion = String(req.body.solucion || '').trim();
    const enviarGrupo = req.body.enviar_grupo != null ? (req.body.enviar_grupo ? 1 : 0) : null;
    const out = d.setEstado(rp.id, estado, req.user.nombre, { solucion: solucion || null, enviar_grupo: enviarGrupo });
    const nota = String(req.body.nota || '').trim();
    if (nota) {
      d.addNota(rp.id, req.user.nombre, nota);
    }
    const fotosArr = [];
    const foto = req.body.foto;
    if (foto && foto.nombre && foto.datos) fotosArr.push(foto);
    if (Array.isArray(req.body.fotos)) {
      for (const f of req.body.fotos.slice(0, 10)) {
        if (f && f.nombre && f.datos) fotosArr.push(f);
      }
    }
    sdbg('[estado] reporte:' + rp.id + ' estado:' + estado + ' solucion:' + solucion + ' enviar_grupo:' + enviarGrupo + ' fotos:' + fotosArr.length);
    for (const ft of fotosArr) {
      const nombre = String(ft.nombre || '').trim();
      if (nombre && /^[A-Za-z0-9._@-]+$/.test(nombre)) {
        try { d.addFoto(rp.id, nombre, ft.tipo || 'image/jpeg', ft.datos, req.user.nombre); sdbg('[estado] Foto guardada: ' + nombre); } catch (e) { sdbg('[estado] Error guardando foto: ' + e.message); }
      } else {
        sdbg('[estado] Nombre foto invalido: ' + nombre);
      }
    }
    res.json({ ok: true, data: out });
    const ESTADO_LABELS = { en_proceso: 'En proceso', resuelto: 'Resuelto', espera_repuesto: 'En espera (repuesto)', espera_cliente: 'En espera (cliente)', abierto: 'Abierto' };
    const gerenteTokens = d.getGerentePushTokens();
    if (gerenteTokens.length) {
      sendPush(gerenteTokens, 'Cambio de estado',
        (rp.client_nombre || 'Cliente') + ' \u2014 ' + (ESTADO_LABELS[estado] || estado),
        { reporteId: String(rp.id), tipo: 'estado' }).catch(() => {});
    }
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/reportes/:id/notas', a.requireAuth('tecnico'), (req, res) => {
  const rp = findReportForUserNoArch(Number(req.params.id), req.user);
  if (!rp) return res.status(404).json({ ok: false, error: 'Reporte no encontrado o no asignado' });
  const texto = String(req.body.texto || '').trim();
  if (!texto) return res.status(400).json({ ok: false, error: 'Escribe el comentario' });
  try {
    const out = d.addNota(rp.id, req.user.nombre, texto);
    res.json({ ok: true, data: out });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/reportes/:id/fotos', a.requireAuth('tecnico'), (req, res) => {
  const rp = findReportForUserNoArch(Number(req.params.id), req.user);
  if (!rp) return res.status(404).json({ ok: false, error: 'Reporte no encontrado o no asignado' });
  const nombre = String(req.body.nombre || '').trim();
  if (!/^[A-Za-z0-9._@-]+$/.test(nombre)) return res.status(400).json({ ok: false, error: 'Nombre de foto no válido' });
  const datos = String(req.body.datos || '');
  if (!datos) return res.status(400).json({ ok: false, error: 'La foto no tiene datos' });
  try {
    const out = d.addFoto(rp.id, nombre, req.body.tipo, datos, req.user.nombre);
    res.json({ ok: true, data: out });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.delete('/api/reportes/:id/fotos/:nombre', a.requireAuth('tecnico'), (req, res) => {
  const rp = findReportForUserNoArch(Number(req.params.id), req.user);
  if (!rp) return res.status(404).json({ ok: false, error: 'Reporte no encontrado o no asignado' });
  const nombre = String(req.params.nombre || '').trim();
  if (!/^[A-Za-z0-9._@-]+$/.test(nombre)) return res.status(400).json({ ok: false, error: 'Nombre de foto no válido' });
  try {
    const out = d.deleteFoto(rp.id, nombre);
    res.json({ ok: true, data: out });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/reportes/:id/historial', a.requireAuth('tecnico'), (req, res) => {
  const rp = findReportForUserNoArch(Number(req.params.id), req.user);
  if (!rp) return res.status(404).json({ ok: false, error: 'Reporte no encontrado o no asignado' });
  const eventos = d.getHistorial(rp.id);
  res.json({ ok: true, data: eventos });
});

app.post('/api/reportes/:id/ubicacion', a.requireAuth('tecnico'), (req, res) => {
  const rp = findReportForUserNoArch(Number(req.params.id), req.user);
  if (!rp) return res.status(404).json({ ok: false, error: 'Reporte no encontrado o no asignado' });
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ ok: false, error: 'Coordenadas no válidas' });
  try {
    const out = d.setUbicacion(rp.id, lat, lng);
    res.json({ ok: true, data: out });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/reportes', a.requireAuth('tecnico'), (req, res) => {
  try {
    const clientNombre = String(req.body.client_nombre || '').trim();
    const descripcion = String(req.body.descripcion || '').trim();
    if (!clientNombre) return res.status(400).json({ ok: false, error: 'El nombre del cliente es obligatorio' });
    if (!descripcion) return res.status(400).json({ ok: false, error: 'La descripción es obligatoria' });
    const assignedId = req.body.tecnico_id ? Number(req.body.tecnico_id) : null;
    let assignedName = '';
    if (assignedId) {
      const tRow = d.db.prepare('SELECT id, nombre FROM tecnicos WHERE id = ? AND activo = 1').get(assignedId);
      if (tRow) assignedName = tRow.nombre;
    }
    const out = d.crearReporte({
      id: req.body.id || Date.now(),
      client_nombre: clientNombre,
      equipo_nombre: req.body.equipo_nombre || '',
      descripcion,
      prioridad: req.body.prioridad || 'normal',
      lat: req.body.lat != null ? Number(req.body.lat) : null,
      lng: req.body.lng != null ? Number(req.body.lng) : null,
      tecnico_id: assignedId || req.user.sub,
      tecnico_nombre: assignedName || req.user.nombre || ''
    });
    if (assignedId && assignedName) {
      const tokens = d.getPushTokens(assignedId);
      if (tokens.length) {
        sendPush(tokens, 'Reporte asignado', clientNombre + ' - ' + descripcion.slice(0, 60), { reporteId: String(out.id), tipo: 'asignado' }).catch(() => {});
      }
    }
    const rp = d.db.prepare('SELECT * FROM reportes WHERE id = ?').get(out.id);
    res.json({ ok: true, data: d.reportePublico(rp) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/stats', a.requireAuth('tecnico'), (req, res) => {
  try {
    const stats = d.getStats(req.user.sub);
    res.json({ ok: true, data: stats });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/sync', a.requireDevice, (req, res) => {
  try {
    const since = Number(req.body.sinceSeq) || 0;
    const push = req.body.push || {};
    const applied = { reportes: [], tecnicos: [], notas: [] };

    for (const t of Array.isArray(push.tecnicos) ? push.tecnicos : []) {
      const r = d.upsertTecnico(t);
      if (r.applied) applied.tecnicos.push({ id: r.id, usuario: r.usuario });
    }
    const reportesArr = Array.isArray(push.reportes) ? push.reportes : [];
    for (const rp of reportesArr) {
      const existed = rp.id ? d.db.prepare('SELECT tecnico_id, estado FROM reportes WHERE id = ?').get(rp.id) : null;
      const r = d.upsertReporte(rp);
      if (r.applied) applied.reportes.push(r.id);
      const oldTech = existed ? String(existed.tecnico_id || '') : 'N/A';
      const newTech = rp.tecnico_id ? String(rp.tecnico_id) : '';
      if (existed && r.applied && rp.tecnico_id && oldTech !== newTech) {
        console.log('PUSH TRIGGER: reporte ' + rp.id + ' tech ' + oldTech + ' -> ' + newTech);
        const tokens = d.getPushTokens(Number(rp.tecnico_id));
        console.log('PUSH TRIGGER: tokens=' + tokens.length + ' for tecnico_id=' + rp.tecnico_id);
        if (tokens.length) {
          const cliente = rp.client_nombre || 'Cliente';
          const equipo = rp.equipo_nombre || '';
          sendPush(tokens, 'Reporte asignado', cliente + (equipo ? ' - ' + equipo : ''), { reporteId: String(rp.id) }).catch((e) => console.log('PUSH ERR: ' + e.message));
        }
      }
      if (!existed && r.applied) {
        const cliente = rp.client_nombre || 'Cliente';
        const equipo = rp.equipo_nombre || '';
        const desc = rp.descripcion ? ' - ' + rp.descripcion.slice(0, 60) : '';
        const gerenteTokens = d.getGerentePushTokens();
        if (gerenteTokens.length) {
          console.log('PUSH GERENTE: nuevo reporte ' + rp.id + ' para ' + gerenteTokens.length + ' gerentes');
          sendPush(gerenteTokens, 'Nuevo reporte', cliente + (equipo ? ' - ' + equipo : '') + desc, { reporteId: String(rp.id), tipo: 'nuevo' }).catch((e) => console.log('PUSH ERR: ' + e.message));
        }
      }
      if (existed && r.applied && rp.estado && existed.estado && rp.estado !== existed.estado) {
        const cliente = rp.client_nombre || 'Cliente';
        const ESTADO_LABELS = { en_proceso: 'En proceso', resuelto: 'Resuelto', espera_repuesto: 'En espera (repuesto)', espera_cliente: 'En espera (cliente)', abierto: 'Abierto' };
        const gerenteTokens = d.getGerentePushTokens();
        if (gerenteTokens.length) {
          console.log('PUSH GERENTE: estado cambio reporte ' + rp.id + ' ' + existed.estado + '->' + rp.estado);
          sendPush(gerenteTokens, 'Cambio de estado', cliente + ' \u2014 ' + (ESTADO_LABELS[rp.estado] || rp.estado), { reporteId: String(rp.id), tipo: 'estado' }).catch((e) => console.log('PUSH ERR: ' + e.message));
        }
      }
    }
    for (const f of Array.isArray(push.fotos) ? push.fotos : []) {
      try {
        const r = d.addFoto(Number(f.reporte_id), f.nombre, f.tipo, f.datos, f.autor || 'NexAlert');
        if (r.applied) applied.fotos = (applied.fotos || []).concat([{ id: r.id, nombre: r.nombre }]);
      } catch (e) { /* noop */ }
    }
    for (const t of Array.isArray(push.tombstones) ? push.tombstones : []) {
      try {
        const r = d.marcarBorrado(Number(t.reporte_id), t.updated_at);
        if (r.applied) applied.borrados = (applied.borrados || []).concat([t.reporte_id]);
      } catch (e) { /* noop */ }
    }
    for (const n of Array.isArray(push.notas) ? push.notas : []) {
      try {
        const exist = d.db.prepare('SELECT id FROM notas WHERE reporte_id = ? AND autor = ? AND texto = ? AND creado = ?')
          .get(Number(n.reporte_id), n.autor || '', String(n.texto || '').trim(), d.fechaLocalUTC(n.creado));
        if (!exist) {
          const r = d.addNota(Number(n.reporte_id), n.autor, n.texto);
          applied.notas.push(r.id);
        }
      } catch (e) { /* reporte no existe aún */ }
    }

    const log = d.db.prepare('SELECT * FROM seq_log WHERE seq > ? ORDER BY seq ASC').all(since);
    const cambios = [];
    for (const l of log) {
      if (l.tipo === 'tecnico') continue;
      if (l.tipo === 'reporte_upsert') {
        const rp = d.db.prepare('SELECT * FROM reportes WHERE id = ? AND deleted = 0').get(l.ref_id);
        if (rp) cambios.push({ seq: l.seq, tipo: 'reporte_upsert', reporte: d.reportePublico(rp) });
        continue;
      }
if (l.tipo === 'estado') {
        const extra = JSON.parse(l.extra || '{}');
        const cb = { seq: l.seq, tipo: 'estado', reporte_id: l.ref_id, estado: extra.estado, autor: extra.autor, creado: extra.creado };
        if (extra.enviar_grupo != null) cb.enviar_grupo = extra.enviar_grupo;
        if (extra.solucion != null) cb.solucion = extra.solucion;
        cambios.push(cb);
      } else if (l.tipo === 'nota') {
        const extra = JSON.parse(l.extra || '{}');
        const n = d.db.prepare('SELECT * FROM notas WHERE id = ?').get(l.ref_id);
        if (n) cambios.push({ seq: l.seq, tipo: 'nota', reporte_id: extra.reporte_id, id: n.id, autor: n.autor, texto: n.texto, creado: n.creado });
      } else if (l.tipo === 'foto') {
        const f = d.db.prepare('SELECT * FROM fotos WHERE id = ?').get(l.ref_id);
        if (f) cambios.push({ seq: l.seq, ...d.fotoPublico(f), tipo: 'foto' });
      } else if (l.tipo === 'foto_del') {
        const extra = JSON.parse(l.extra || '{}');
        cambios.push({ seq: l.seq, tipo: 'foto_del', reporte_id: extra.reporte_id, nombre: extra.nombre });
      } else if (l.tipo === 'ubicacion') {
        const extra = JSON.parse(l.extra || '{}');
        cambios.push({ seq: l.seq, tipo: 'ubicacion', reporte_id: l.ref_id, detalle: l.extra || '{}' });
      } else if (l.tipo === 'reporte_delete') {
        cambios.push({ seq: l.seq, tipo: 'reporte_delete', reporte_id: l.ref_id });
      } else if (l.tipo === 'reporte_archive') {
        cambios.push({ seq: l.seq, tipo: 'reporte_archive', reporte_id: l.ref_id });
      }
    }
    const nuevoSeq = d.lastSeq();
    res.json({ ok: true, applied, seq: nuevoSeq, cambios });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

const FCM_URL = 'https://fcm.googleapis.com/fcm/send';

let fcmApp = null;
function getFcm() {
  if (fcmApp) return fcmApp;
  try {
    const admin = require('firebase-admin');
    const sa = require('../config/service-account.json');
    admin.initializeApp({ credential: admin.credential.cert(sa) });
    fcmApp = admin.messaging();
    console.log('Firebase Admin inicializado OK');
  } catch (e) {
    console.log('Firebase Admin error:', e.message);
  }
  return fcmApp;
}

async function sendPush(tokens, title, body, data) {
  const messaging = getFcm();
  if (!messaging || !tokens.length) return;
  for (const token of tokens) {
    try {
      await messaging.send({
        token,
        notification: { title, body },
        android: { priority: 'high', notification: { sound: 'default', channel_id: 'fcm_default_channel', click_action: 'OPEN_ACTIVITY_1' } },
        data: data || {}
      });
    } catch (e) {
      const code = (e.errorInfo && e.errorInfo.code) || '';
      if (/not-registered|invalid-registration|invalid-argument|sender-id-mismatch|unregistered/.test(code)) {
        d.removePushToken(token);
      } else {
        console.log('FCM send error:', code || e.message);
      }
    }
  }
}

app.post('/api/push/register', a.requireAuth('tecnico'), (req, res) => {
  try {
    const { pushToken, tecnicoId } = req.body || {};
    if (!pushToken) return res.status(400).json({ ok: false, error: 'pushToken requerido' });
    d.registerPushToken(pushToken, tecnicoId || req.user.sub);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/push/test', a.requireAuth('tecnico'), async (req, res) => {
  try {
    const tokens = d.getPushTokens(req.user.sub);
    if (!tokens.length) return res.json({ ok: true, msg: 'No hay tokens registrados' });
    await sendPush(tokens, 'NexAlert', 'Notificaciones activas!', { test: true });
    res.json({ ok: true, sent: tokens.length });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/push/notify-update', async (req, res) => {
  try {
    const tokens = d.getPushTokens();
    if (!tokens.length) return res.json({ ok: true, msg: 'No hay tokens', sent: 0 });
    const version = APP_VERSION;
    const url = APP_APK_URL;
    await sendPush(tokens, 'NexAlert - Actualizacion disponible', 'NexAlert v' + version + ' ya esta disponible. Toca para descargar.', { tipo: 'update', version, downloadUrl: url });
    res.json({ ok: true, sent: tokens.length, version });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

async function checkReminders() {
  try {
    const horaDR = (new Date().getUTCHours() - 4 + 24) % 24;
    if (horaDR < 6 || horaDR >= 18) return;
    const reportes = d.getReportesParaRecordatorio();
    if (!reportes.length) return;
    for (const rp of reportes) {
      try {
        const tokens = d.getPushTokens(Number(rp.tecnico_id));
        if (!tokens.length) continue;
        const cliente = rp.client_nombre || 'Cliente';
        const desc = rp.descripcion ? rp.descripcion.slice(0, 80) : '';
        const body = 'Reporte #' + rp.id + ' - ' + cliente + ' lleva tiempo sin actualización. Actualiza el estado.';
        await sendPush(tokens, '⏰ Recordatorio', body, { reporteId: String(rp.id), tipo: 'recordatorio' });
        d.logReminder(rp.id);
      } catch (e) { /* noop */ }
    }
    d.cleanupOldReminders();
  } catch (e) { console.log('REMINDER ERR: ' + e.message); }
}

const PORT = process.env.PORT || 3200;
const APP_VERSION = '1.5.17';
const APP_APK_URL = 'https://nexalert.duckdns.org/updates/app-latest.apk';

app.get('/api/app-version', (req, res) => {
  res.json({ ok: true, data: { version: APP_VERSION, downloadUrl: APP_APK_URL } });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('nexalert-server escuchando en http://0.0.0.0:' + PORT);
  console.log('Primer paso (NexAlert): registrar dispositivo en /api/device/register y guardar deviceToken en settings.');
  setInterval(checkReminders, 5 * 60 * 1000);
  setTimeout(checkReminders, 10 * 1000);
  const pruneTokens = () => { try { const n = d.pruneOldPushTokens(120); d.trimAllPushTokens(); if (n > 0) console.log('PRUNE PUSH TOKENS: quedan ' + n); } catch (e) { console.log('PRUNE ERR: ' + e.message); } };
  setTimeout(pruneTokens, 15 * 1000);
  setInterval(pruneTokens, 12 * 60 * 60 * 1000);
  setInterval(() => {
    try {
      const n = d.autoArchiveResolved();
      if (n > 0) console.log('AUTO-ARCHIVE: ' + n + ' reportes archivados');
    } catch (e) { console.log('AUTO-ARCHIVE ERR: ' + e.message); }
  }, 60 * 60 * 1000);
  setTimeout(() => {
    try { d.autoArchiveResolved(); } catch (e) { /* noop */ }
  }, 30 * 1000);
});





















