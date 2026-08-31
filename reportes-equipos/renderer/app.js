'use strict';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  tab: 'panel',
  clients: [],
  equipos: [],
  reportes: [],
  tecnicos: [],
  settings: { negocio: 'NexAlert' },
  wa: { status: 'off', detail: '', qr: null, groups: [] },
  modalAction: null,
  fotos: [],
  grupoSelId: '',
  grupoSelName: '',
  grupoData: [],
  mensajes: [],
  convId: '',
  mediaCache: {},
  msgSel: new Set(),
  replyTo: null,
  rec: null,
  recTimer: null,
  eqCliente: null,
  grupoMembres: {},
  mentMens: [],
  mentList: [],
  mentSel: -1
};

const WA_LABELS = {
  off: 'Desconectado',
  connecting: 'Conectando…',
  qr: 'Esperando escaneo del QR',
  ready: 'Conectado',
  failed: 'Error'
};

async function refreshAll() {
  const [c, e, r, t, s] = await Promise.all([
    window.api.clients.list(),
    window.api.equipos.list(),
    window.api.reportes.list(),
    window.api.tecnicos.list(),
    window.api.settings.get()
  ]);
  state.clients = c.data;
  state.equipos = e.data;
  state.reportes = r.data;
  state.tecnicos = t.data;
  state.settings = s.data;
  $('#negocio-top').textContent = state.settings.negocio || 'NexAlert';
  fillReportFilters();
  renderClients();
  renderEquipos();
  renderReportes();
  renderTecnicos();
  renderPanel();
  updatePendingBar();
}

function activarTab(name) {
  state.tab = name;
  $$('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'mensajes') {
    refreshMensajes();
  }
}

function updatePendingBar() {
  const n = state.reportes.filter((r) => !r.enviado && !r.archivado).length;
  const bar = $('#pending-bar');
  if (n > 0) {
    $('#pending-text').textContent = '⚠️ Tienes ' + n + ' reporte(s) sin enviar al grupo de WhatsApp.';
    bar.classList.remove('hidden');
  } else {
    bar.classList.add('hidden');
  }
}

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function fmtFecha(f) {
  return String(f || '—').slice(0, 10);
}

function fechaLocal() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function fmtFechaHora(f) {
  if (!f) return '—';
  const s = String(f).replace('T', ' ');
  return s.length > 16 ? s.slice(0, 16) : s;
}

function fmtHoraChat(f) {
  if (!f) return '';
  const s = String(f).replace('T', ' ');
  const m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const mm = m[2];
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12; if (h === 0) h = 12;
  return h + ':' + mm + ' ' + ampm;
}

function fmtDia(f) {
  if (!f) return '';
  const s = String(f).replace('T', ' ');
  const fecha = new Date(s.replace(' ', 'T'));
  if (isNaN(fecha.getTime())) return '';
  const hoy = new Date();
  const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
  const esMismo = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (esMismo(fecha, hoy)) return 'Hoy';
  if (esMismo(fecha, ayer)) return 'Ayer';
  return fecha.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
}

function fmtDiaGrupo(dia) {
  if (!dia) return 'Sin fecha';
  const hoy = new Date();
  const hoyS = fechaLocal();
  const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
  const ayerS = ayer.getFullYear() + '-' + String(ayer.getMonth() + 1).padStart(2, '0') + '-' + String(ayer.getDate()).padStart(2, '0');
  if (dia === hoyS) return 'Hoy · ' + hoy.toLocaleDateString('es', { day: 'numeric', month: 'long' });
  if (dia === ayerS) return 'Ayer · ' + ayer.toLocaleDateString('es', { day: 'numeric', month: 'long' });
  const d = new Date(dia + 'T12:00:00');
  if (isNaN(d.getTime())) return dia;
  const s = d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtMes(m) {
  const d = new Date(m + '-01T12:00:00');
  if (isNaN(d.getTime())) return m;
  const s = d.toLocaleDateString('es', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseAdjuntos(v) {
  try {
    const a = JSON.parse(v || '[]');
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
  } catch (e) { return []; }
}

/* ---------------- Licencia ---------------- */
let licState = null;

async function loadLicense() {
  try {
    const res = await window.api.license.status();
    licState = res && res.ok ? res.data : null;
  } catch (e) { licState = null; }
  renderLicense();
}

function diasParaVencimiento(expires) {
  if (!expires) return null;
  const d = parseFechaLocal(String(expires) + 'T23:59:59');
  if (!d) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function renderLicense() {
  const s = licState;
  const bar = $('#lic-bar');
  const txt = $('#lic-text');
  const btn = $('#btn-lic');
  const gate = $('#license-gate');
  const canUse = s && (s.valid || (s.trial && !s.trial.expired));

  if (s && s.valid && s.license) {
    const progs = (s.license.programs && s.license.programs.length)
      ? s.license.programs.map((p) => String(p).toUpperCase()).join(' + ')
      : '—';
    const diasV = diasParaVencimiento(s.license.expires);
    const casiExpira = s.license.expires && diasV !== null && diasV <= 5;
    if (casiExpira) {
      bar.className = 'lic-bar trial';
      bar.classList.remove('hidden');
      txt.textContent = '⚠️ Tu suscripción vence en ' + Math.max(0, diasV) + ' día(s) (' + s.license.expires + '). Solicita tu clave renovada.';
    } else {
      bar.classList.add('hidden');
    }
    btn.textContent = 'Ver licencia';
    gate.classList.add('hidden');
    return;
  }

  bar.classList.remove('hidden');
  if (!s) {
    bar.className = 'lic-bar err';
    txt.textContent = 'Licencia: no se pudo verificar';
    btn.textContent = 'Reintentar';
  } else if (s && s.trial && !s.trial.expired) {
    bar.className = 'lic-bar trial';
    txt.textContent = 'Versión de prueba · ' + s.trial.daysLeft + ' día(s) restante(s)';
    btn.textContent = 'Activar licencia';
  } else {
    bar.className = 'lic-bar err';
    txt.textContent = 'Licencia no válida: ' + (s.reason || 'error');
    btn.textContent = 'Activar licencia';
  }

  if (canUse) {
    gate.classList.add('hidden');
  } else {
    $('#gate-msg').textContent = (s && s.reason) || 'La licencia de NEXALERT no es válida.';
    gate.classList.remove('hidden');
  }
}

async function openLicModal() {
  try {
    const s = licState;
    const cur = $('#lic-current');
    $('#lic-result').className = 'lic-result hidden';
    $('#lic-result').textContent = '';
    $('#lic-key').value = '';
    $('#btn-lic-deactivate').classList.add('hidden');
    $('#lic-machine').textContent = 'ID de esta computadora: ' + (s ? s.machineId : '—');
    if (s && s.valid && s.license) {
      const progs = (s.license.programs && s.license.programs.length)
        ? s.license.programs.map((p) => String(p).toUpperCase()).join(' + ')
        : '—';
      cur.innerHTML = '<div class="ok-box">Licencia activa<br/><b>' + esc(s.license.company) + '</b> · ' + progs +
        (s.license.expires
          ? ' · vence ' + esc(s.license.expires) + ' (en ' + Math.max(0, diasParaVencimiento(s.license.expires)) + ' día(s))'
          : ' · perpetua') +
        (s.license.machine ? ' · vinculada a esta PC' : '') + '</div>';
      $('#btn-lic-deactivate').classList.remove('hidden');
    } else if (s && s.activated) {
      cur.innerHTML = '<div class="err-box">Licencia guardada pero no válida: ' + esc(s.reason || 'error') + '</div>';
    } else if (s && s.trial) {
      cur.innerHTML = '<div class="trial-box">Modo prueba · ' + s.trial.daysLeft + ' día(s) restante(s).</div>';
    } else {
      cur.innerHTML = '';
    }
  } catch (e) { /* noop */ }
  $('#lic-mask').classList.remove('hidden');
  $('#lic-key').focus();
}

async function activateLic() {
  const box = $('#lic-result');
  box.className = 'lic-result err';
  const key = $('#lic-key').value.trim();
  if (!key) { box.textContent = 'Pega la clave de licencia primero.'; return; }
  box.textContent = 'Activando…';
  try {
    const res = await window.api.license.activate(key);
    if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'Error');
    box.className = 'lic-result ok';
    box.textContent = '¡Licencia activada correctamente!';
    await loadLicense();
    setTimeout(() => { $('#lic-mask').classList.add('hidden'); }, 1200);
  } catch (e) {
    box.textContent = (e && e.message) || 'La licencia no es válida';
  }
}

/* ---------------- Panel ---------------- */
const PRIO_LABEL = { baja: 'Baja', normal: 'Normal', urgente: 'Urgente' };

function filtrarReportes() {
  const f = $('#rp-filter').value;
  const cid = Number($('#rp-client-filter').value) || 0;
  const eid = Number($('#rp-equipo-filter').value) || 0;
  const m = $('#rp-month-filter').value;
  const q = ($('#rp-search').value || '').trim().toLowerCase();
  let rows = state.reportes;
  if (f === 'archivados') rows = rows.filter((r) => r.archivado);
  else {
    rows = rows.filter((r) => !r.archivado);
    if (f === 'urgentes') rows = rows.filter((r) => r.prioridad === 'urgente');
    else if (f === 'abierto') rows = rows.filter((r) => r.estado === 'abierto');
    else if (f === 'en_proceso') rows = rows.filter((r) => r.estado === 'en_proceso');
    else if (f === 'en_espera') rows = rows.filter((r) => r.estado === 'espera_repuesto' || r.estado === 'espera_cliente');
    else if (f === 'resuelto') rows = rows.filter((r) => r.estado === 'resuelto');
    else if (f === 'pendientes') rows = rows.filter((r) => !r.enviado);
    else if (f === 'sin_asignar') rows = rows.filter((r) => !r.tecnico_id);
  }
  if (q) {
    rows = rows.filter((r) => {
      const eqTxt = ((r.equipos || []).map((x) => x.nombre).join(' ') + ' ' + (r.equipo_nombre || '')).toLowerCase();
      const hay = ((r.descripcion || '') + ' ' + (r.solucion || '') + ' ' + (r.cliente_nombre || '') + ' ' + eqTxt + ' ' + (r.tecnico_nombre || '') + ' ' + (r.grupo_nombre || '')).toLowerCase();
      return hay.includes(q);
    });
  }
  if (m) rows = rows.filter((r) => String(r.fecha || '').slice(0, 7) === m);
  if (cid) rows = rows.filter((r) => r.client_id === cid);
  if (eid) rows = rows.filter((r) => (r.equipos || []).some((x) => x.id === eid) || r.equipo_id === eid);
  return rows;
}

function fillReportFilters() {
  const csel = $('#rp-client-filter'), esel = $('#rp-equipo-filter');
  const cprev = csel.value, eprev = esel.value;
  csel.innerHTML = '<option value="">Todos los clientes</option>' + state.clients.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  if (cprev) csel.value = cprev;
  esel.innerHTML = '<option value="">Todos los equipos</option>' + state.equipos.map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('');
  if (eprev) esel.value = eprev;
  const msel = $('#rp-month-filter');
  if (msel) {
    const mprev = msel.value;
    const meses = [];
    for (const r of state.reportes) {
      const k = String(r.fecha || '').slice(0, 7);
      if (k && !meses.includes(k)) meses.push(k);
    }
    const esteMes = fechaLocal().slice(0, 7);
    if (!meses.includes(esteMes)) meses.unshift(esteMes);
    meses.sort().reverse();
    msel.innerHTML = '<option value="">Todos los meses</option>'
      + (meses.includes(esteMes) ? '<option value="' + esteMes + '">📅 Este mes</option>' : '')
      + meses.filter((m2) => m2 !== esteMes).map((m2) => '<option value="' + m2 + '">' + esc(fmtMes(m2)) + '</option>').join('');
    if (mprev) msel.value = mprev;
  }
}

function goReportes(filter, clientId, equipoId) {
  $('#rp-filter').value = filter || '';
  $('#rp-client-filter').value = clientId || '';
  $('#rp-equipo-filter').value = equipoId || '';
  const sr = $('#rp-search');
  if (sr) sr.value = '';
  activarTab('reportes');
  renderReportes();
}

function statCard(n, label, filtro, color) {
  return '<div class="stat ' + color + '" data-filter="' + filtro + '"><div class="stat-n">' + n + '</div><div class="stat-l">' + label + '</div></div>';
}

function renderPanel() {
  const activos = state.reportes.filter((r) => !r.archivado);
  $('#panel-stats').innerHTML =
    statCard(activos.filter((r) => r.estado === 'abierto').length, 'Abiertos', 'abierto', 's-red')
    + statCard(activos.filter((r) => r.estado === 'en_proceso').length, 'En proceso', 'en_proceso', 's-yellow')
    + statCard(activos.filter((r) => r.estado === 'espera_repuesto' || r.estado === 'espera_cliente').length, 'En espera', 'en_espera', 's-purple')
    + statCard(activos.filter((r) => r.prioridad === 'urgente').length, 'Urgentes', 'urgentes', 's-orange')
    + statCard(activos.filter((r) => !r.enviado).length, 'Sin enviar', 'pendientes', 's-blue')
    + statCard(activos.filter((r) => !r.tecnico_id).length, 'Sin técnico', 'sin_asignar', 's-purple')
    + statCard(activos.filter((r) => r.estado === 'resuelto').length, 'Resueltos', 'resuelto', 's-green');

  const porTecnico = state.tecnicos.map((t) => {
    const a = activos.filter((r) => r.tecnico_id === t.id);
    return { t, abiertos: a.filter((r) => r.estado !== 'resuelto').length, resueltos: a.filter((r) => r.estado === 'resuelto').length };
  });
  const sinAsignar = activos.filter((r) => !r.tecnico_id).length;

  const porCliente = {};
  for (const r of activos.filter((x) => x.estado !== 'resuelto')) {
    const k = r.client_id || 0;
    porCliente[k] = porCliente[k] || { nom: r.cliente_nombre || 'Sin cliente', n: 0 };
    porCliente[k].n++;
  }
  const topClientes = Object.values(porCliente).sort((a, b) => b.n - a.n).slice(0, 6);

  const urgentes = activos.filter((r) => r.prioridad === 'urgente');

  const viejos = activos.filter((r) => r.estado !== 'resuelto').map((r) => {
    const t = parseFechaLocal(r.creado);
    return { r, dias: t ? (Date.now() - t.getTime()) / 86400000 : null };
  }).filter((x) => x.dias !== null && x.dias >= 7).sort((a, b) => b.dias - a.dias);

  const resueltos = state.reportes.filter((r) => r.estado === 'resuelto');
  const diasT = resueltos.map((r) => {
    const a = parseFechaLocal(r.creado), b = parseFechaLocal(r.resuelto_at);
    return a && b ? (b.getTime() - a.getTime()) / 86400000 : null;
  }).filter((x) => x !== null && x >= 0);
  const promGlobal = diasT.length ? diasT.reduce((a, b) => a + b, 0) / diasT.length : null;
  const porTecRes = {};
  for (const r of resueltos) {
    const k = (r.tecnico_nombre || '').trim() || 'Sin técnico';
    porTecRes[k] = porTecRes[k] || { dias: [] };
    const a = parseFechaLocal(r.creado), b = parseFechaLocal(r.resuelto_at);
    if (a && b) porTecRes[k].dias.push((b.getTime() - a.getTime()) / 86400000);
  }
  const promTec = Object.keys(porTecRes).map((k) => {
    const ds = porTecRes[k].dias.filter((x) => x >= 0);
    return { k, n: ds.length, p: ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null };
  }).sort((a, b) => (b.p || 0) - (a.p || 0));

  const porMes = {};
  for (const r of state.reportes) {
    const ck = String(r.creado || '').slice(0, 7);
    if (ck) {
      porMes[ck] = porMes[ck] || { creados: 0, resueltos: 0 };
      porMes[ck].creados++;
    }
    if (r.estado === 'resuelto' && r.resuelto_at) {
      const rk = String(r.resuelto_at).slice(0, 7);
      porMes[rk] = porMes[rk] || { creados: 0, resueltos: 0 };
      porMes[rk].resueltos++;
    }
  }
  const mesesUlt = Object.keys(porMes).sort().reverse().slice(0, 6).reverse();
  const maxMes = Math.max(1, ...Object.values(porMes).map((m) => Math.max(m.creados, m.resueltos)));

  const porEquipo = {};
  for (const r of state.reportes) {
    const eqs = (r.equipos && r.equipos.length) ? r.equipos : (r.equipo_id ? [{ nombre: r.equipo_nombre || '' }] : []);
    for (const x of eqs) {
      const k = (x.nombre || '').trim();
      if (!k) continue;
      porEquipo[k] = porEquipo[k] || { n: 0, cliente: r.cliente_nombre || '' };
      porEquipo[k].n++;
    }
  }
  const topEquipos = Object.entries(porEquipo).sort((a, b) => b[1].n - a[1].n).slice(0, 6);

  $('#panel-body').innerHTML = `
    <div class="panel-grid">
      <div class="panel-card">
        <h4>👷 Carga por técnico</h4>
        ${porTecnico.map((x) => `
          <div class="panel-row">
            <span class="panel-name">${esc(x.t.nombre)}</span>
            <span class="panel-val">${x.abiertos} en curso · ${x.resueltos} resueltos</span>
          </div>`).join('')}
        ${porTecnico.length ? '' : '<div class="hint">Sin técnicos registrados todavía.</div>'}
        ${sinAsignar ? '<div class="panel-row"><span class="panel-name">🚨 Sin asignar</span><span class="panel-val"><b>' + sinAsignar + '</b> reporte(s)</span></div>' : ''}
      </div>
      <div class="panel-card">
        <h4>🏢 Reportes activos por cliente</h4>
        ${topClientes.map((c) => `<div class="panel-row"><span class="panel-name">${esc(c.nom)}</span><span class="panel-val"><b>${c.n}</b></span></div>`).join('')}
        ${topClientes.length ? '' : '<div class="hint">Sin reportes activos.</div>'}
      </div>
      <div class="panel-card">
        <h4>⚡ Reportes urgentes</h4>
        ${urgentes.slice(0, 6).map((r) => `
          <div class="panel-row"><span class="panel-name">${esc(r.cliente_nombre || 'Cliente')}${rpEquiposTxt(r) ? ' · ' + esc(rpEquiposTxt(r)) : ''}</span><span class="panel-val">${ESTADO_LABEL[r.estado] || ''}</span></div>`).join('')}
        ${urgentes.length ? '' : '<div class="hint">Sin reportes urgentes.</div>'}
      </div>
      <div class="panel-card">
        <h4>🖥️ Equipos que más fallan</h4>
        ${topEquipos.map((q) => `<div class="panel-row"><span class="panel-name">${esc(q[0])}</span><span class="panel-val"><b>${q[1].n}</b> falla(s)</span></div>`).join('')}
        ${topEquipos.length ? '' : '<div class="hint">Sin reportes con equipo.</div>'}
      </div>
      <div class="panel-card">
        <h4>⏱️ Promedio de días para resolver</h4>
        <div class="panel-row"><span class="panel-name">Global</span><span class="panel-val"><b>${fmtDias(promGlobal)}</b></span></div>
        ${promTec.slice(0, 6).map((x) => `<div class="panel-row"><span class="panel-name">${esc(x.k)}</span><span class="panel-val">${x.n} · <b>${fmtDias(x.p)}</b></span></div>`).join('')}
        ${promTec.length ? '' : '<div class="hint">Sin reportes resueltos todavía.</div>'}
      </div>
      <div class="panel-card">
        <h4>📈 Actividad por mes</h4>
        ${mesesUlt.length ? mesesUlt.map((mk) => {
          const m = porMes[mk];
          const bh = Math.max(2, Math.round((m.resueltos / maxMes) * 60));
          const bg = Math.max(2, Math.round((m.creados / maxMes) * 60));
          return `<div class="panel-row">` + '<span class="panel-name">' + esc(fmtMes(mk)) + '</span><span class="bar-stack">'
            + '<span class="bar bar-blue" style="width:' + bg + 'px" title="Creados: ' + m.creados + '"></span>'
            + '<span class="bar bar-green" style="width:' + bh + 'px" title="Resueltos: ' + m.resueltos + '"></span>'
            + '</span><span class="panel-val">' + m.creados + ' / ' + m.resueltos + '</span></div>';
        }).join('') : '<div class="hint">Sin actividad todavía.</div>'}
      </div>
      <div class="panel-card">
        <h4>⏰ Antiguos +7 días</h4>
        ${viejos.slice(0, 8).map((x) => `<div class="panel-row"><span class="panel-name">${esc(x.r.cliente_nombre || 'Cliente')}${rpEquiposTxt(x.r) ? ' · ' + esc(rpEquiposTxt(x.r)) : ''}</span><span class="panel-val">${ESTADO_LABEL[x.r.estado] || ''} · <b>${Math.round(x.dias)}d</b></span></div>`).join('')}
        ${viejos.length ? '' : '<div class="hint">Nada con más de 7 días 🎉</div>'}
      </div>
    </div>`;
}

/* ---------------- WhatsApp ---------------- */
let qrShownOnce = false;

function applyWa(s) {
  const prev = state.wa.status;
  state.wa = { ...state.wa, ...s };
  const bar = $('#wa-bar');
  bar.className = 'wa-bar ' + state.wa.status;
  bar.classList.toggle('hidden', state.wa.status === 'ready');
  $('#wa-text').textContent = 'WhatsApp: ' + (WA_LABELS[state.wa.status] || state.wa.status) + (state.wa.detail && state.wa.status !== 'ready' ? ' · ' + state.wa.detail : '');
  const btn = $('#btn-wa-connect');
  if (state.wa.status === 'ready') {
    btn.textContent = 'WhatsApp conectado ✓';
    btn.disabled = true;
  } else if (state.wa.status === 'connecting') {
    btn.textContent = 'Conectando…';
    btn.disabled = true;
  } else if (state.wa.status === 'qr') {
    btn.textContent = 'Ver QR';
    btn.disabled = false;
    btn.title = 'Mostrar el código QR para escanear';
  } else {
    btn.textContent = 'Conectar WhatsApp';
    btn.disabled = false;
  }
  const waTop = $('#btn-wa-top');
  if (state.wa.status === 'ready') {
    waTop.title = 'WhatsApp conectado';
    waTop.classList.add('wa-ok');
  } else {
    waTop.title = 'Conectar WhatsApp';
    waTop.classList.remove('wa-ok');
  }
  const qrImg = $('#qr-img'), qrMsg = $('#qr-msg');
  if (state.wa.status === 'qr') {
    if (prev !== 'qr' && !qrShownOnce) { qrShownOnce = true; showQr(); }
    else if (qrShownOnce && !$('#qr-mask').classList.contains('hidden')) showQr();
  } else {
    qrShownOnce = false;
    if (qrImg && qrMsg) {
      qrImg.classList.add('hidden');
      qrMsg.textContent = state.wa.status === 'ready' ? 'Conectado. Puedes cerrar esta ventana.' : (WA_LABELS[state.wa.status] || '');
    }
  }
}

function showQr() {
  $('#qr-mask').classList.remove('hidden');
  const img = $('#qr-img'), msg = $('#qr-msg');
  if (state.wa.qr) {
    img.src = state.wa.qr;
    img.classList.remove('hidden');
    msg.textContent = 'Abre WhatsApp en tu teléfono → Ajustes → Dispositivos vinculados → Vincular dispositivo y escanea este código.';
  } else {
    img.classList.add('hidden');
    msg.textContent = 'Generando código QR…';
  }
}

async function connectWa() {
  qrShownOnce = true;
  $('#btn-wa-connect').disabled = true;
  await window.api.wa.connect();
}

function updateMensajesBadge() {
  const unread = state.mensajes.filter((m) => !m.leido && !m.fromMe && m.tipo !== 'out').length;
  const b = $('#tab-mensajes-badge');
  if (unread > 0 && state.tab !== 'mensajes') {
    b.textContent = unread > 99 ? '99+' : String(unread);
    b.classList.remove('hidden');
  } else {
    b.classList.add('hidden');
  }
}

const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#4f46e5', '#9333ea'];
function colorDe(nombre) {
  let h = 0;
  const s = String(nombre || '?');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function avatarHtml(file, nombre) {
  if (file) return '<img class="ms-ava-img" data-avatar="' + esc(file) + '" alt="">';
  const ini = (String(nombre || '?').trim().charAt(0) || '?').toUpperCase();
  return '<span class="ms-ava-txt" style="background:' + colorDe(nombre) + '">' + esc(ini) + '</span>';
}
function loadAvatars() {
  $$('.ms-ava-img[data-avatar]').forEach((img) => {
    const f = img.dataset.avatar;
    if (state.mediaCache[f]) { img.src = state.mediaCache[f]; img.classList.add('ok'); return; }
    if (img.dataset.loaded) return;
    img.dataset.loaded = '1';
    window.api.wa.mensajesMedia(f).then((r) => {
      if (r && r.ok) { state.mediaCache[f] = r.data; img.src = r.data; img.classList.add('ok'); }
      else img.classList.add('ava-missing');
    }).catch(() => { img.classList.add('ava-missing'); });
  });
}

function mediaLabel(m) {
  const map = { imagen: '📷 Imagen', video: '🎥 Video', audio: '🎵 Nota de voz', sticker: '😀 Sticker', documento: '📄 Documento' };
  if (!m.media) return m.texto || '';
  let l = map[m.media] || ('📎 ' + m.media);
  if (m.texto && m.texto !== '[Audio]' && m.texto !== '[Sticker]') l += ' · ' + m.texto;
  return l;
}

function conversaciones() {
  const map = {};
  for (const m of state.mensajes) {
    const jid = m.jid || '';
    if (!jid) continue;
    if (!map[jid]) map[jid] = { jid, nombre: '', telefono: m.telefono, esGrupo: m.es_grupo, unread: 0, ultimo: '', ultimoHora: '', avatar: '', miembros: 0 };
    const c = map[jid];
    if (m.nombre && m.nombre !== 'Yo') c.nombre = m.nombre;
    if (m.telefono) c.telefono = m.telefono;
    if (m.avatar) c.avatar = m.avatar;
    if (m.miembros) c.miembros = m.miembros;
    if (!m.leido && !m.fromMe && m.tipo !== 'out') c.unread += 1;
    if (!c.ultimoHora || (m.creado || '') > c.ultimoHora) {
      c.ultimo = m.media ? mediaLabel(m) : (m.texto || '(sin texto)');
      c.ultimoHora = m.creado || '';
    }
  }
  return Object.values(map).sort((a, b) => (b.ultimoHora || '').localeCompare(a.ultimoHora || ''));
}

function fmtTelefono(t) {
  t = String(t || '').replace(/\D/g, '');
  return t.length >= 11 ? '+' + t : t;
}

const EMOJIS = [
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😴','🤤','😪','😮','😲','🥱','😷','🤒','🤕','🤢','🤮','🥴','🤧','😈','👻','👽','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾','💀','💩','👶','🧒','👦','👧','🧑','👨','👩','👴','👵','🧔',
  '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','🧠','👀','👁️','👅','👄','💋',
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','💌','💍','💎','👑','🎁','🎉','🎊','🎈','🏆','🥇','⭐','🌟','✨','🔥','💯','✅','❌','❗','❓','💤','💦','💢','💥','💫',
  '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🐺','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐢','🐍','🐙','🐡','🐠','🐟','🐬','🐳','🦈','🐊','🦓','🐘','🦒','🦘','🦜','🦩','🦔',
  '🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🥦','🌽','🥕','🍠','🥐','🍞','🥖','🧀','🥚','🍳','🧈','🥞','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🌮','🌯','🥗','🍝','🍜','🍣','🍱','🍤','🍚','🍥','🍧','🍨','🍦','🧁','🍰','🎂','🍭','🍬','🍫','🍿','🍩','🍪','🍯','🥜','🍼','☕','🍵','🧃','🥤','🧋','🍺','🍻','🥂','🍷','🥃','🍹',
  '⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🏸','🥅','🎳','⛳','🎣','🎽','🎿','🛷','🥌','🎯','🛹','🚴','🏋️','🤸','🤺','🏇','🏆','🥇','🥈','🥉','🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚜','🏍️','🛵','🚲','🛴','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','✈️','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢','⚓','🚧','⛽','🚏','🗺️','🏠','🏡','🏢','🏬','🏭','🏨','🏦','🏥','🏪','🌆','🌃','🌇','🌉','🌌','⛰️','🏔️','🗻','🌋','🗾','🏕️','🏖️','🏜️','🏝️','🏞️','🌅','🌄','🌠','🎇','🎆','🌈','☀️','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','☃️','⛄','🌬️','💨','💧','☔','☂️','🌊','🌫️'
];

function renderEmojiGrid() {
  const grid = $('#ms-emoji-grid');
  if (!grid || grid.dataset.built) return;
  grid.dataset.built = '1';
  grid.innerHTML = EMOJIS.map((e) => '<button class="emoji-item" data-e="' + esc(e) + '">' + e + '</button>').join('');
}

function autoGrowInput() {
  const ta = $('#ms-reply-input');
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}

function insertarEmoji(emoji) {
  const input = $('#ms-reply-input');
  const s = input.selectionStart != null ? input.selectionStart : input.value.length;
  const en = input.selectionEnd != null ? input.selectionEnd : input.value.length;
  input.value = input.value.slice(0, s) + emoji + input.value.slice(en);
  const p = s + emoji.length;
  input.focus();
  input.setSelectionRange(p, p);
  autoGrowInput();
}

function ocultarPanelMenciones() {
  const p = $('#ms-mention-panel');
  if (p) p.classList.add('hidden');
  state.mentList = [];
  state.mentSel = -1;
}

async function obtenerGrupoMembres(jid) {
  if (!jid) return [];
  if (state.grupoMembres[jid]) return state.grupoMembres[jid];
  const fromMsgs = {};
  for (const m of state.mensajes) {
    if (m.jid === jid && m.participant && m.remitente && !fromMsgs[m.participant]) fromMsgs[m.participant] = m.remitente;
  }
  let list = [];
  try {
    const r = await window.api.wa.mensajesGrupo(jid);
    if (r && r.ok && Array.isArray(r.data)) {
      list = r.data.map((p) => ({
        jid: p.jid || '',
        pn: p.pn || p.jid || '',
        telefono: p.telefono || '',
        nombre: p.nombre || fromMsgs[p.jid] || fromMsgs[p.pn] || ''
      })).filter((p) => p.jid);
    }
  } catch (e) { /* noop */ }
  if (!list.length) {
    list = Object.keys(fromMsgs).map((j) => ({
      jid: j, pn: j, telefono: String(j).replace(/\D/g, ''), nombre: fromMsgs[j]
    }));
  }
  state.grupoMembres[jid] = list;
  if (state.convId === jid && $('#ms-chat-msgs') && !$('#ms-chat-msgs').classList.contains('hidden')) renderChat(true);
  return list;
}

function manejarMencionInput() {
  const ta = $('#ms-reply-input');
  const panel = $('#ms-mention-panel');
  const c = conversaciones().find((x) => x.jid === state.convId);
  if (!c || !c.esGrupo) { ocultarPanelMenciones(); return; }
  const v = ta.value;
  const pos = ta.selectionStart != null ? ta.selectionStart : v.length;
  const antes = v.slice(0, pos);
  const m = antes.match(/(?:^|\s)@([\p{L}\p{N}_\-]*)$/u);
  if (!m) { ocultarPanelMenciones(); return; }
  const q = m[1] || '';
  const membres = state.grupoMembres[state.convId] || [];
  const filt = membres.filter((mb) => !q || (mb.nombre + ' ' + mb.telefono).toLowerCase().includes(q.toLowerCase()));
  if (!filt.length) { ocultarPanelMenciones(); return; }
  state.mentList = filt;
  state.mentSel = 0;
  panel.innerHTML = filt.map((mb, i) => {
    const nombre = mb.nombre || fmtTelefono(mb.telefono);
    const sub = mb.nombre ? fmtTelefono(mb.telefono) : '';
    return '<div class="ms-mention-item' + (i === 0 ? ' sel' : '') + '" data-i="' + i + '"><span class="ms-mention-ava">' + esc(nombre[0] || '👤') + '</span><div class="ms-mention-info"><div class="ms-mention-name">' + esc(nombre) + '</div>' + (sub ? '<div class="ms-mention-sub">' + esc(sub) + '</div>' : '') + '</div></div>';
  }).join('');
  panel.classList.remove('hidden');
}

function pintarMentSel() {
  $$('#ms-mention-panel .ms-mention-item').forEach((el, i) => el.classList.toggle('sel', i === state.mentSel));
  const sel = $('#ms-mention-panel .ms-mention-item.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function mencionarMiembro(mb) {
  const ta = $('#ms-reply-input');
  const v = ta.value;
  const pos = ta.selectionStart != null ? ta.selectionStart : v.length;
  const antes = v.slice(0, pos);
  const m = antes.match(/(?:^|\s)@([\p{L}\p{N}_\-]*)$/u);
  const num = String(mb.telefono || String(mb.pn || '').replace(/\D/g, '') || String(mb.jid || '').replace(/\D/g, ''));
  const ins = '@' + num + ' ';
  let nv;
  if (m) nv = v.slice(0, m.index) + ins + v.slice(pos);
  else nv = v + ins;
  ta.value = nv;
  const np = (m ? m.index : nv.length - ins.length) + ins.length;
  ta.focus();
  ta.setSelectionRange(np, np);
  const jidM = String(mb.pn || mb.jid || '');
  if (!state.mentMens.some((x) => x.jid === jidM)) state.mentMens.push({ jid: jidM, num, nombre: mb.nombre || num });
  ocultarPanelMenciones();
  autoGrowInput();
}

function textoMenciones(m) {
  const txt = String(m.texto || '');
  let html = esc(txt);
  html = html.replace(/(https?:\/\/|www\.)[^\s<>"']+/g, (u) => {
    const href = u.indexOf('http') === 0 ? u : 'http://' + u;
    return '<a class="msg-link" href="' + href + '" target="_blank" rel="noopener">' + u + '</a>';
  });
  if (html.includes('@')) {
    const memb = state.grupoMembres[state.convId] || [];
    html = html.replace(/@(\d+)/g, (full, num) => {
      const mb = memb.find((x) => x.telefono === num || String(x.pn || '').replace(/\D/g, '') === num || String(x.jid || '').replace(/\D/g, '') === num);
      return mb && mb.nombre
        ? '<span class="msg-mention">@' + esc(mb.nombre) + '</span>'
        : '<span class="msg-mention">' + esc(full) + '</span>';
    });
  }
  return html;
}

function nombreCita(m) {
  const nom = String(m.reply_remitente || '');
  if (nom && /^\+?\d+$/.test(nom)) {
    const membres = state.grupoMembres[m.jid] || [];
    const num = nom.replace(/\D/g, '');
    const mb = membres.find((x) => {
      const t = String(x.telefono || x.pn || '').replace(/\D/g, '');
      return t && (t.endsWith(num) || num.endsWith(t));
    });
    if (mb && mb.nombre) return mb.nombre;
  }
  return nom || 'Mensaje citado';
}

function quoteHtml(m) {
  const qid = String(m.reply_id || '');
  if (!qid && !m.reply_texto && !m.reply_media) return '';
  const qnom = nombreCita(m);
  let qprev = String(m.reply_texto || '');
  if (!qprev && m.reply_media) qprev = m.reply_media === 'audio' ? '[Audio]' : m.reply_media === 'sticker' ? '[Sticker]' : m.reply_media === 'imagen' ? '[Imagen]' : m.reply_media === 'video' ? '[Video]' : '[Adjunto]';
  if (!qprev) qprev = '(mensaje original no disponible)';
  const icono = m.reply_media ? (m.reply_media === 'audio' ? '🎤 ' : m.reply_media === 'sticker' ? '🖼 ' : m.reply_media === 'imagen' ? '📷 ' : m.reply_media === 'video' ? '🎬 ' : '📎 ') : '';
  return '<div class="msg-quote" title="Respondió a ' + esc(qnom) + '"' + (qid ? ' data-replyto="' + esc(qid) + '"' : '') + '>'
    + '<div class="msg-quote-nombre">↩ ' + esc(qnom) + '</div>'
    + '<div class="msg-quote-text">' + icono + esc(qprev) + '</div></div>';
}

function scrollToReply(rid) {
  const el = document.querySelector('.msg[data-msgid="' + CSS.escape(String(rid)) + '"]');
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('quote-flash');
  setTimeout(() => el.classList.remove('quote-flash'), 1400);
}

function renderStickerGrid() {
  const grid = $('#ms-sticker-grid');
  if (!grid) return;
  if (!state.stickersImp) {
    try { state.stickersImp = JSON.parse(localStorage.getItem('nex_stickers') || '[]'); } catch (e) { state.stickersImp = []; }
  }
  const vistos = new Set();
  const archivos = [];
  for (const a of state.stickersImp) {
    if (a && !vistos.has(a)) { vistos.add(a); archivos.push(a); }
  }
  for (const m of state.mensajes) {
    if (m.media === 'sticker' && m.media_archivo && !vistos.has(m.media_archivo)) {
      vistos.add(m.media_archivo);
      archivos.push(m.media_archivo);
    }
  }
  if (!archivos.length) {
    grid.innerHTML = '<div class="ms-sticker-empty">Aún no hay stickers aquí.<br>Usa el botón ➕ para importar tu paquete (.webp).</div>';
    return;
  }
  grid.innerHTML = archivos.map((a) => '<div class="ms-sticker-item" data-file="' + esc(a) + '"><img data-file="' + esc(a) + '" alt="sticker" loading="lazy"></div>').join('');
  grid.querySelectorAll('img').forEach((img) => {
    const f = img.dataset.file;
    if (state.mediaCache[f]) { img.src = state.mediaCache[f]; return; }
    window.api.wa.mensajesMedia(f, 'image/webp').then((r) => {
      if (r && r.ok) { state.mediaCache[f] = r.data; img.src = r.data; }
      else {
        state.stickersImp = (state.stickersImp || []).filter((a) => a !== f);
        try { localStorage.setItem('nex_stickers', JSON.stringify(state.stickersImp)); } catch (e) { /* noop */ }
        const item = img.closest('.ms-sticker-item');
        if (item) item.remove();
      }
    }).catch(() => {});
  });
}

async function importarStickersArchivos(files) {
  if (!files || !files.length) return;
  const items = [];
  for (const f of files) {
    try {
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result || ''));
        r.onerror = () => rej(new Error('No se pudo leer ' + f.name));
        r.readAsDataURL(f);
      });
      const comma = dataUrl.indexOf(',');
      const dataBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
      const ext = (f.name.split('.').pop() || 'webp').toLowerCase();
      items.push({ dataBase64, ext });
    } catch (e) { /* noop */ }
  }
  if (!items.length) return;
  const r = await window.api.wa.importarStickers(items);
  if (!r || !r.ok) { alert((r && r.error) || 'No se pudieron importar los stickers.'); return; }
  if (r.archivos && r.archivos.length) {
    const set = new Set(state.stickersImp || []);
    r.archivos.forEach((a) => set.add(a));
    state.stickersImp = [...set];
    try { localStorage.setItem('nex_stickers', JSON.stringify(state.stickersImp)); } catch (e) { /* noop */ }
    renderStickerGrid();
  }
}

async function sendSticker(archivo) {
  if (!state.convId) return;
  if (state.wa.status !== 'ready') { alert('WhatsApp no está conectado. Conéctalo primero.'); return; }
  try {
    let dataUrl = state.mediaCache[archivo];
    if (!dataUrl) {
      const r = await window.api.wa.mensajesMedia(archivo, 'image/webp');
      if (!r || !r.ok) { alert('No se pudo cargar el sticker.'); return; }
      dataUrl = r.data;
      state.mediaCache[archivo] = r.data;
    }
    const comma = dataUrl.indexOf(',');
    const dataBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
    const r = await window.api.wa.mensajesEnviar({
      jid: state.convId,
      texto: '',
      media: { tipo: 'sticker', nombre: 'sticker.webp', ext: 'webp', dataBase64 },
      reply: replyPayload()
    });
    if (!r.ok) { alert(r.error); return; }
    $('#ms-sticker-panel').classList.add('hidden');
    cancelReply();
    if (r.data) {
      state.mensajes = state.mensajes.filter((x) => x.id !== r.data.id).concat([r.data]);
      renderChat();
      renderConversaciones();
    }
  } catch (e) {
    alert('No se pudo enviar el sticker: ' + e.message);
  }
}

function closeMsPanels() {
  $('#ms-attach-menu').classList.add('hidden');
  $('#ms-emoji-panel').classList.add('hidden');
  $('#ms-sticker-panel').classList.add('hidden');
}

function renderConversaciones() {
  const q = ($('#ms-search').value || '').trim().toLowerCase();
  const list = conversaciones().filter((c) => !q || (c.nombre + ' ' + c.telefono + ' ' + c.ultimo).toLowerCase().includes(q));
  $('#ms-chats').innerHTML = list.map((c) => {
    const nombre = c.nombre || fmtTelefono(c.telefono) || 'Desconocido';
    const sub = c.esGrupo ? (c.miembros ? c.miembros + ' participantes' : 'grupo') : fmtTelefono(c.telefono);
    return `
    <div class="ms-chat ${state.convId === c.jid ? 'sel' : ''} ${c.unread ? 'unread' : ''}" data-jid="${esc(c.jid)}">
      <div class="ms-chat-avatar">${c.esGrupo && !c.avatar ? '<span class="ms-ava-txt ms-ava-grupo">👥</span>' : avatarHtml(c.avatar, nombre)}</div>
      <div class="ms-chat-info">
        <div class="ms-chat-name">${esc(nombre)}${c.esGrupo ? ' <span class="ms-grupo-tag">grupo</span>' : ''}</div>
        <div class="ms-chat-preview">${esc(c.ultimo)}</div>
      </div>
      <div class="ms-chat-side">
        <div class="ms-chat-time">${fmtDia(c.ultimoHora) || ''}</div>
        ${c.unread ? '<div class="ms-chat-badge">' + c.unread + '</div>' : ''}
      </div>
    </div>`;
  }).join('') || '<div class="empty">Sin conversaciones todavía.</div>';
  const subEl = $('#ms-side-sub');
  if (subEl) subEl.textContent = list.length ? (list.length + ' chats') : '';
  loadAvatars();
}

function mediaHtml(m) {
  if (!m.media) return '';
  if (!m.media_archivo) {
    return '<div class="msg-media-file"><button class="btn small" data-action="ms-abrir-media" data-file="">📎 ' + esc(m.media) + '</button></div>';
  }
  const f = esc(m.media_archivo);
  const mime = m.media_mime ? ' data-mime="' + esc(m.media_mime) + '"' : '';
  if (m.media === 'imagen') return '<div class="msg-media"><img class="msg-img" data-file="' + f + '" alt="imagen" loading="lazy"></div>';
  if (m.media === 'sticker') return '<div class="msg-media"><img class="msg-img msg-sticker" data-file="' + f + '" alt="sticker" loading="lazy"></div>';
  if (m.media === 'video') return '<div class="msg-media msg-media-video"><video class="msg-video" data-file="' + f + '"' + mime + ' playsinline preload="metadata"></video><div class="msg-video-play">▶</div></div>';
  if (m.media === 'audio') return '<div class="msg-media"><audio class="msg-audio" data-file="' + f + '"' + mime + ' controls preload="none"></audio></div>';
  return '<div class="msg-media-file"><button class="btn small" data-action="ms-abrir-media" data-file="' + f + '">📎 ' + esc(m.media === 'documento' ? (m.texto || 'Documento') : m.media) + '</button></div>';
}

function loadMediaImgs() {
  $$('.msg-img[data-file], .msg-video[data-file], .msg-audio[data-file]').forEach((el) => {
    if (el.dataset.mload) return;
    el.dataset.mload = '1';
    const f = el.dataset.file;
    if (!f) return;
    const mime = el.dataset.mime || '';
    const aplicar = (data) => {
      if (el.tagName === 'IMG') { el.src = data; el.classList.add('ok'); }
      else el.src = data;
    };
    if (state.mediaCache[f]) { aplicar(state.mediaCache[f]); return; }
    window.api.wa.mensajesMedia(f, mime).then((r) => {
      if (r && r.ok) { state.mediaCache[f] = r.data; aplicar(r.data); }
      else if (el.tagName === 'IMG') el.alt = 'No disponible';
    }).catch(() => { if (el.tagName === 'IMG') el.alt = 'No disponible'; });
  });
}

function renderChat(keepScroll) {
  const msgs = state.mensajes.filter((m) => m.jid === state.convId).sort((a, b) => (a.creado || '').localeCompare(b.creado || ''));
  const box = $('#ms-chat-msgs');
  const sc = box.scrollTop;
  const esGrupo = !!msgs[0] && !!msgs[0].es_grupo;
  let ultDia = '';
  box.innerHTML = msgs.map((m) => {
    const dia = fmtDia(m.creado);
    const sep = dia && dia !== ultDia ? '<div class="ms-daysep"><span>' + esc(dia) + '</span></div>' : '';
    ultDia = dia || ultDia;
    const fromMe = !!m.fromMe || m.tipo === 'out';
    const remitente = m.remitente || (fromMe ? 'Yo' : (m.nombre || fmtTelefono(m.telefono) || 'Contacto'));
    const muestraRemitente = esGrupo && !fromMe;
    const sel = state.msgSel.has(m.id);
    const esPlaceholder = (m.media === 'audio' && m.texto === '[Audio]') || (m.media === 'sticker' && m.texto === '[Sticker]');
    const cuerpo = m.texto && !esPlaceholder ? '<div class="msg-text">' + textoMenciones(m) + '</div>' : '';
    const qhtml = quoteHtml(m);
    return `
      ${sep}
      <div class="msg ${fromMe ? 'out' : 'in'} ${sel ? 'sel' : ''}" data-id="${m.id}" data-msgid="${esc(m.mensaje_id || '')}">
        <div class="msg-check" data-check="${m.id}" title="Seleccionar">${sel ? '✓' : ''}</div>
        <div class="msg-bubble">
          ${muestraRemitente && (m.texto || qhtml) ? '<div class="msg-remitente">' + esc(remitente) + '</div>' : ''}
          ${qhtml}
          ${mediaHtml(m)}
          ${cuerpo}
          <div class="msg-meta">${fmtHoraChat(m.creado)}${fromMe ? ' <span class="msg-check-ok" title="Enviado">✓✓</span>' : ''}</div>
        </div>
        ${!fromMe ? '<div class="msg-actions"><button class="btn small" data-action="ms-reporte" data-id="' + m.id + '" title="Crear reporte">➡️</button><button class="btn small danger" data-action="ms-borrar" data-id="' + m.id + '" title="Eliminar">🗑️</button></div>' : ''}
      </div>`;
  }).join('') || '<div class="empty">Sin mensajes en esta conversación.</div>';
  if (keepScroll) box.scrollTop = sc; else box.scrollTop = box.scrollHeight;
  loadMediaImgs();
}

function renderMsSelbar() {
  const bar = $('#ms-selbar');
  const box = $('#ms-chat-msgs');
  const n = state.msgSel.size;
  if (!n) {
    bar.classList.add('hidden');
    box.classList.remove('sel-mode');
    return;
  }
  bar.classList.remove('hidden');
  box.classList.add('sel-mode');
  $('#ms-sel-count').textContent = n + ' seleccionado' + (n === 1 ? '' : 's');
  $('#btn-ms-sel-reporte').textContent = '➡️ Crear reporte (' + n + ')';
}

function toggleMsgSel(id) {
  if (state.msgSel.has(id)) state.msgSel.delete(id); else state.msgSel.add(id);
  renderMsSelbar();
  renderChat(true);
}

function cancelMsgSel() {
  state.msgSel.clear();
  renderMsSelbar();
  renderChat(true);
}

function openConversacion(jid) {
  state.convId = jid;
  if (state.rec) detenerGrabacion(false);
  cancelMsgSel();
  cancelReply();
  closeMsPanels();
  ocultarPanelMenciones();
  state.mentMens = [];
  renderConversaciones();
  const c = conversaciones().find((x) => x.jid === jid);
  const nombre = (c && (c.nombre || fmtTelefono(c.telefono))) || 'Desconocido';
  $('#ms-chat-head').classList.remove('hidden');
  const sub = c && c.esGrupo
    ? (c.miembros ? c.miembros + ' participantes' : 'grupo')
    : (c && c.telefono && c.nombre ? fmtTelefono(c.telefono) : '');
  $('#ms-chat-head').innerHTML = '<div class="ms-chat-avatar">' + (c && c.esGrupo && !c.avatar ? '<span class="ms-ava-txt ms-ava-grupo">👥</span>' : avatarHtml((c && c.avatar) || '', nombre)) + '</div>'
    + '<div class="ms-chat-info"><div class="ms-chat-name"><b>' + esc(nombre) + '</b>'
    + (c && c.esGrupo ? ' <span class="ms-grupo-tag">grupo</span>' : '')
    + '</div><div class="ms-chat-sub">' + esc(sub) + '</div></div>';
  loadAvatars();
  $('#ms-reply').classList.remove('hidden');
  if (c && c.esGrupo) obtenerGrupoMembres(jid);
  const ph = $('#ms-chat-msgs .ms-placeholder');
  if (ph) ph.remove();
  renderChat();
  const inIds = state.mensajes.filter((m) => m.jid === jid && !m.leido && !m.fromMe && m.tipo !== 'out').map((m) => m.id);
  if (inIds.length) {
    window.api.wa.mensajesLeer(inIds).then(() => {
      for (const m of state.mensajes) if (m.jid === jid) m.leido = 1;
      updateMensajesBadge();
      renderConversaciones();
    });
  } else {
    updateMensajesBadge();
  }
  const input = $('#ms-reply-input');
  input.disabled = state.wa.status !== 'ready';
  input.placeholder = state.wa.status === 'ready' ? 'Escribe un mensaje' : 'Conecta WhatsApp para responder';
  $('#btn-ms-mic').disabled = input.disabled;
  input.focus();
}

async function enviarRespuesta() {
  if (!state.convId) return;
  const input = $('#ms-reply-input');
  const txt = input.value.trim();
  if (!txt) return;
  if (state.wa.status !== 'ready') { alert('WhatsApp no está conectado. Conéctalo primero.'); return; }
  input.disabled = true;
  const r = await window.api.wa.mensajesEnviar({ jid: state.convId, texto: txt, mentions: state.mentMens.length ? state.mentMens.map((x) => x.jid) : [], reply: replyPayload() });
  input.disabled = false;
  if (!r.ok) return alert(r.error);
  input.value = '';
  autoGrowInput();
  cancelReply();
  state.mentMens = [];
  ocultarPanelMenciones();
  if (r.data) {
    state.mensajes = state.mensajes.filter((x) => x.id !== r.data.id).concat([r.data]);
    renderChat();
    renderConversaciones();
  }
}

function replyPayload() {
  if (!state.replyTo) return null;
  return {
    id: state.replyTo.id,
    fromMe: state.replyTo.fromMe,
    participant: state.replyTo.participant,
    texto: state.replyTo.texto,
    media: state.replyTo.media
  };
}

function renderReplyBar() {
  const bar = $('#ms-reply-bar');
  if (!state.replyTo) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const r = state.replyTo;
  $('#ms-reply-nombre').textContent = r.nombre || (r.fromMe ? 'Yo' : 'Contacto');
  $('#ms-reply-preview').textContent = r.media ? mediaLabel(r) : (r.texto || '(sin texto)');
}

function setReplyTo(id) {
  const m = state.mensajes.find((x) => x.id === Number(id));
  if (!m) return;
  state.replyTo = {
    id: m.mensaje_id || m.id,
    fromMe: !!m.fromMe || m.tipo === 'out',
    participant: m.participant || '',
    nombre: m.remitente || (m.fromMe || m.tipo === 'out' ? 'Yo' : (m.nombre || m.telefono || 'Contacto')),
    texto: m.texto || '',
    media: m.media || ''
  };
  renderReplyBar();
  $('#ms-reply-input').focus();
}

function cancelReply() {
  state.replyTo = null;
  renderReplyBar();
}

async function enviarMedia(tipo, file) {
  if (!state.convId) return;
  if (state.wa.status !== 'ready') { alert('WhatsApp no está conectado. Conéctalo primero.'); return; }
  if (!file) return;
  const maxMB = tipo === 'video' ? 60 : 25;
  if (file.size > maxMB * 1024 * 1024) { alert('El archivo supera ' + maxMB + ' MB. Elige uno más pequeño.'); return; }
  const input = $('#ms-reply-input');
  const caption = input.value.trim();
  const btn = $('#btn-ms-send');
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    const dataUrl = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(String(reader.result || ''));
      reader.onerror = () => rej(new Error('No se pudo leer el archivo.'));
      reader.readAsDataURL(file);
    });
    const comma = dataUrl.indexOf(',');
    const dataBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const r = await window.api.wa.mensajesEnviar({
      jid: state.convId,
      texto: caption,
      media: { tipo, nombre: file.name, ext, dataBase64 },
      mentions: state.mentMens.length ? state.mentMens.map((x) => x.jid) : [],
      reply: replyPayload()
    });
    if (!r.ok) { alert(r.error); return; }
    input.value = '';
    autoGrowInput();
    cancelReply();
    state.mentMens = [];
    ocultarPanelMenciones();
    if (r.data) {
      state.mensajes = state.mensajes.filter((x) => x.id !== r.data.id).concat([r.data]);
      renderChat();
      renderConversaciones();
    }
  } catch (e) {
    alert('No se pudo enviar el archivo: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '➤';
  }
}

function mejorMimeAudio() {
  const opciones = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  if (window.MediaRecorder) {
    for (const m of opciones) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* noop */ }
    }
  }
  return 'audio/webm';
}

async function toggleGrabacion() {
  if (state.rec) { await detenerGrabacion(true); return; }
  if (!state.convId) return;
  if (state.wa.status !== 'ready') { alert('WhatsApp no está conectado. Conéctalo primero.'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = mejorMimeAudio();
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    state.rec = { rec, chunks, stream, mime, startedAt: Date.now() };
    rec.start(250);
    $('#ms-rec').classList.remove('hidden');
    $('#btn-ms-mic').classList.add('recording');
    $('#ms-rec-time').textContent = '0:00';
    state.recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - state.rec.startedAt) / 1000);
      $('#ms-rec-time').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }, 500);
  } catch (e) {
    alert('No se pudo acceder al micrófono: ' + (e.message || 'Permiso denegado o sin micrófono disponible.'));
  }
}

async function detenerGrabacion(enviar) {
  const r = state.rec;
  if (!r) return;
  clearInterval(state.recTimer);
  state.recTimer = null;
  $('#ms-rec').classList.add('hidden');
  $('#btn-ms-mic').classList.remove('recording');
  state.rec = null;
  try { r.rec.stop(); } catch (e) { /* noop */ }
  r.stream.getTracks().forEach((t) => t.stop());
  if (!enviar) return;
  const blob = new Blob(r.chunks, { type: r.mime });
  if (!blob.size) { alert('No se grabó ningún audio.'); return; }
  const secs = Math.max(1, Math.round((Date.now() - r.startedAt) / 1000));
  const dataUrl = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result || ''));
    fr.onerror = () => rej(new Error('No se pudo leer el audio grabado.'));
    fr.readAsDataURL(blob);
  });
  const comma = dataUrl.indexOf(',');
  const dataBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
  const btn = $('#btn-ms-send');
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    const resp = await window.api.wa.mensajesEnviar({
      jid: state.convId,
      texto: '',
      media: { tipo: 'audio', nombre: 'nota-' + secs + 's.webm', ext: 'webm', mime: r.mime, dataBase64 },
      reply: replyPayload()
    });
    if (!resp.ok) { alert(resp.error); return; }
    cancelReply();
    if (resp.data) {
      state.mensajes = state.mensajes.filter((x) => x.id !== resp.data.id).concat([resp.data]);
      renderChat();
      renderConversaciones();
    }
  } catch (e) {
    alert('No se pudo enviar la nota de voz: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '➤';
  }
}

async function refreshMensajes() {
  try {
    const r = await window.api.wa.mensajesList();
    if (r && r.ok) state.mensajes = r.data;
  } catch (e) { /* noop */ }
  renderConversaciones();
  if (state.convId) {
    const exists = state.mensajes.some((m) => m.jid === state.convId);
    if (exists) renderChat();
    else {
      state.convId = '';
      cancelMsgSel();
      $('#ms-chat-head').classList.add('hidden');
      $('#ms-reply').classList.add('hidden');
      $('#ms-chat-msgs').innerHTML = '<div class="ms-placeholder"><div class="ms-placeholder-icon">💬</div><p>Selecciona una conversación<br>para ver sus mensajes</p></div>';
    }
  }
  updateMensajesBadge();
  const help = $('#ms-help');
  if (help) {
    if (!state.mensajes.length) {
      help.textContent = state.wa.status === 'ready'
        ? 'Aún no hay mensajes. Cuando alguien te escriba a tu WhatsApp, la conversación aparecerá aquí automáticamente.'
        : 'Conecta WhatsApp (barra superior) para recibir aquí los mensajes de tus clientes.';
      help.classList.remove('hidden');
    } else {
      help.classList.add('hidden');
    }
  }
}

async function borrarMensaje(id) {
  if (!confirm('¿Eliminar este mensaje?')) return;
  await window.api.wa.mensajesBorrar(id);
  state.msgSel.delete(id);
  renderMsSelbar();
  await refreshMensajes();
}

async function borrarTodosChats() {
  if (!confirm('¿Borrar TODOS los chats y mensajes de WhatsApp?\nEsta acción no se puede deshacer.')) return;
  const r = await window.api.wa.mensajesBorrarTodos();
  if (!r || !r.ok) return alert('No se pudieron borrar los chats.');
  state.mensajes = [];
  state.convId = null;
  state.msgSel.clear();
  state.grupoMembres = {};
  state.mentMens = [];
  ocultarPanelMenciones();
  cancelReply();
  closeMsPanels();
  renderMsSelbar();
  $('#ms-chat-head').classList.add('hidden');
  $('#ms-reply').classList.add('hidden');
  $('#ms-chat-msgs').innerHTML = '<div class="ms-placeholder"><div class="ms-placeholder-icon">💬</div><p>Selecciona una conversación<br>para ver sus mensajes</p></div>';
  updateMensajesBadge();
  renderConversaciones();
}

async function nuevoReporteDesdeMensaje(id) {
  const m = state.mensajes.find((x) => x.id === Number(id));
  if (!m) return;
  nuevoReporteDesdeMensajes([m.id]);
}

async function nuevoReporteDesdeMensajes(ids) {
  const sel = state.mensajes.filter((m) => ids.includes(m.id))
    .sort((a, b) => (a.creado || '').localeCompare(b.creado || ''));
  if (!sel.length) return;
  const ref = sel.find((m) => !m.fromMe && m.tipo !== 'out' && (m.telefono || m.remitente))
    || sel.find((m) => m.telefono)
    || sel[sel.length - 1];
  const r = await window.api.wa.mensajesCliente({
    telefono: ref && ref.telefono,
    nombre: ref ? (ref.remitente || ref.nombre) : ''
  });
  if (!r.ok) return alert(r.error);
  await refreshAll();
  const cid = r.data.client_id;
  const cl = state.clients.find((c) => c.id === cid) || r.data.client;
  const lineas = sel.map((m) => {
    const fromMe = !!m.fromMe || m.tipo === 'out';
    const rem = m.remitente || (fromMe ? 'Yo' : (m.nombre || m.telefono || 'Contacto'));
    const cuerpo = (m.media ? '📎 ' + m.media + '\n' : '') + (m.texto || '');
    return '[' + fmtFechaHora(m.creado) + '] ' + rem + ':\n' + cuerpo;
  }).join('\n\n');
  const rp = {
    client_id: cid,
    descripcion: (cl && cl.nombre ? 'Mensajes de ' + cl.nombre + (cl.telefono ? ' (' + cl.telefono + ')' : '') + ':\n' : '') + lineas,
    fecha: fechaLocal(),
    prioridad: 'normal'
  };
  state.reportesSel = rp;
  openModal('Nuevo reporte desde WhatsApp (' + sel.length + ' mensaje' + (sel.length === 1 ? '' : 's') + ')', reporteForm(rp), async () => {
    const x = {
      client_id: Number($('#f-rp-client').value),
      equipos_ids: recEquiposIds(),
      descripcion: $('#f-rp-desc').value,
      fecha: $('#f-rp-fecha').value,
      estado: 'abierto',
      prioridad: $('#f-rp-prioridad').value,
      solucion: $('#f-rp-sol').value,
      grupo_id: state.grupoSelId || '',
      grupo_nombre: state.grupoSelName || '',
      adjuntos: [],
      adjuntosNuevos: [],
      adjuntosEliminados: []
    };
    const res = await window.api.reportes.save(x);
    if (!res.ok) return alert(res.error);
    await refreshAll();
  });
  fillEquiposGrid(cid, []);
  fillGrupoSelect((cl && cl.grupo_id) || '', (cl && cl.grupo_nombre) || '');
  initFotos([], []);
}

/* ---------------- Modales ---------------- */
function openModal(title, bodyHtml, action) {
  state.modalAction = action;
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-mask').classList.remove('hidden');
}

function closeModal() {
  $('#modal-mask').classList.add('hidden');
  state.modalAction = null;
}

function field(name, label, value, type, extra) {
  const t = type || 'text';
  const opts = t === 'textarea'
    ? '<textarea id="f-' + name + '" rows="4">' + esc(value) + '</textarea>'
    : '<input id="f-' + name + '" type="' + t + '" value="' + esc(value) + '" ' + (extra || '') + '>';
  return '<label>' + label + opts + '</label>';
}

/* ---------------- Clientes ---------------- */
function clienteCard(c) {
  const nRpt = state.reportes.filter((r) => r.client_id === c.id && !r.archivado).length;
  const init = (c.nombre || '?').trim().charAt(0).toUpperCase();
  return `
    <div class="card cl-card">
      <div class="cl-head">
        <div class="cl-avatar">${esc(init)}</div>
        <div class="card-main">
          <div class="card-title">${esc(c.nombre)}</div>
          <div class="card-sub">
            ${c.contacto ? '👤 ' + esc(c.contacto) : ''}
            ${c.telefono ? '📞 ' + esc(c.telefono) : ''}
          </div>
        </div>
      </div>
      <div class="cl-meta">
        <span class="badge">🖥️ ${c.equipos} equipo(s)</span>
        <span class="badge badge-cl-rpt">📋 ${nRpt} activo(s)</span>
      </div>
      <div class="cl-actions">
        <button class="btn small" data-action="reps-cliente" data-id="${c.id}" title="Ver reportes del cliente">📋 Reportes</button>
        <button class="btn small primary" data-action="eq-ver-cliente" data-id="${c.id}" title="Ver equipos">🖥️ Equipos</button>
        <button class="btn small" data-action="edit-client" data-id="${c.id}" title="Editar">✏️</button>
        <button class="btn small danger" data-action="del-client" data-id="${c.id}" title="Eliminar">🗑️</button>
      </div>
    </div>`;
}

function renderClients() {
  const q = ($('#cl-search').value || '').trim().toLowerCase();
  const rows = state.clients.filter((c) => !q || (c.nombre + ' ' + c.contacto + ' ' + c.telefono).toLowerCase().includes(q));
  $('#cl-count').textContent = rows.length + ' cliente(s)';
  $('#cl-list').className = 'cards grid';
  $('#cl-list').innerHTML = rows.map(clienteCard).join('') || '<div class="empty">Sin clientes todavía.</div>';
}

function clientForm(c) {
  return field('nombre', 'Nombre de la empresa o cliente *', c.nombre)
    + field('contacto', 'Contacto', c.contacto)
    + field('telefono', 'Teléfono', c.telefono)
    + field('email', 'Email', c.email, 'email')
    + field('direccion', 'Dirección', c.direccion)
    + field('notas', 'Notas', c.notas, 'textarea');
}

function nuevoCliente() {
  openModal('Nuevo cliente', clientForm({}), async () => {
    const c = { nombre: $('#f-nombre').value, contacto: $('#f-contacto').value, telefono: $('#f-telefono').value, email: $('#f-email').value, direccion: $('#f-direccion').value, notas: $('#f-notas').value };
    const r = await window.api.clients.save(c);
    if (!r.ok) return alert(r.error);
    await refreshAll();
  });
}

function editClient(id) {
  const c = state.clients.find((x) => x.id === id);
  openModal('Editar cliente', clientForm(c), async () => {
    const c2 = { id, nombre: $('#f-nombre').value, contacto: $('#f-contacto').value, telefono: $('#f-telefono').value, email: $('#f-email').value, direccion: $('#f-direccion').value, notas: $('#f-notas').value };
    const r = await window.api.clients.save(c2);
    if (!r.ok) return alert(r.error);
    await refreshAll();
  });
}

async function delClient(id) {
  if (!confirm('¿Eliminar cliente y todos sus equipos y reportes?')) return;
  await window.api.clients.remove(id);
  await refreshAll();
}

/* ---------------- Equipos ---------------- */
function equipoCard(e, conCliente) {
  const c = conCliente ? state.clients.find((x) => x.id === e.client_id) : null;
  const reps = state.reportes.filter((r) => (r.equipos || []).some((x) => x.id === e.id) || r.equipo_id === e.id);
  const activos = reps.filter((r) => !r.archivado);
  return `
    <div class="card">
      <div class="card-main">
        <div class="card-title">🖥️ ${esc(e.nombre)}</div>
        <div class="card-sub">
          ${c ? '🏢 ' + esc(c.nombre) + ' · ' : ''}
          ${e.marca || e.modelo ? esc(e.marca) + ' ' + esc(e.modelo) + ' · ' : ''}
          ${e.serial ? '🔢 ' + esc(e.serial) + ' · ' : ''}
          ${e.ubicacion ? '📍 ' + esc(e.ubicacion) : ''}
        </div>
        ${e.notas ? '<div class="problem">' + esc(e.notas) + '</div>' : ''}
        <div class="badge">${reps.length} reporte(s)${activos.length ? ' · ' + activos.length + ' activo(s)' : ''}</div>
        ${reps.length ? '<div class="eq-reps"><div class="eq-reps-t">📋 Últimas fallas</div>' + reps.slice(0, 3).map((r) => `
          <div class="eq-rep-row">
            <span class="pill pill-${esc(r.estado)}">${ESTADO_LABEL[r.estado] || r.estado}</span>
            <span class="eq-rep-tx">${esc(String(r.descripcion).slice(0, 80))}${r.descripcion && r.descripcion.length > 80 ? '…' : ''}</span>
            <span class="eq-rep-f">${fmtFecha(r.fecha)}</span>
          </div>`).join('') + '</div>' : ''}
      </div>
      <div class="card-actions">
        <button class="btn small" data-action="reps-equipo" data-id="${e.id}" title="Ver reportes de este equipo">📋</button>
        <button class="btn small" data-action="edit-equipo" data-id="${e.id}">✏️ Editar</button>
        <button class="btn small danger" data-action="del-equipo" data-id="${e.id}">🗑️</button>
      </div>
    </div>`;
}

function clienteEqCard(c) {
  const nEq = state.equipos.filter((e) => e.client_id === c.id).length;
  const nRpt = state.reportes.filter((r) => r.client_id === c.id && !r.archivado).length;
  return `
    <div class="card clickable" data-action="eq-ver-cliente" data-id="${c.id}">
      <div class="card-main">
        <div class="card-title">🏢 ${esc(c.nombre)}</div>
        <div class="card-sub">
          ${c.contacto ? '👤 ' + esc(c.contacto) + ' · ' : ''}
          ${c.telefono ? '📞 ' + esc(c.telefono) : ''}
        </div>
        <div class="badge">🖥️ ${nEq} equipo(s) · ${nRpt} reporte(s) activos</div>
      </div>
      <div class="card-actions">
        <button class="btn small primary" data-action="eq-ver-cliente" data-id="${c.id}">Ver equipos →</button>
      </div>
    </div>`;
}

function renderEquipos() {
  const cid = Number(state.eqCliente) || 0;
  const c = cid ? state.clients.find((x) => x.id === cid) : null;
  if (cid && !c) { state.eqCliente = null; return renderEquipos(); }
  const search = $('#eq-search');
  if (search) search.placeholder = cid ? 'Buscar equipo…' : 'Buscar cliente…';
  const q = (($('#eq-search').value) || '').trim().toLowerCase();
  $('#eq-detail-head').classList.toggle('hidden', !c);
  $('#eq-detail-title').textContent = c ? 'Equipos de ' + c.nombre : '';
  if (c) {
    const rows = state.equipos.filter((e) => e.client_id === cid && (!q || (e.nombre + ' ' + (e.marca || '') + ' ' + (e.modelo || '') + ' ' + (e.serial || '') + ' ' + (e.ubicacion || '')).toLowerCase().includes(q)));
    $('#eq-count').textContent = rows.length + ' equipo(s)';
    $('#eq-list').className = 'cards';
    $('#eq-list').innerHTML = rows.map((e) => equipoCard(e)).join('') || '<div class="empty">Este cliente no tiene equipos todavía. Usa "➕ Nuevo equipo".</div>';
  } else {
    const rows = state.clients.filter((cl) => !q || (cl.nombre + ' ' + (cl.contacto || '') + ' ' + (cl.telefono || '')).toLowerCase().includes(q));
    $('#eq-count').textContent = rows.length + ' cliente(s)';
    $('#eq-list').className = 'cards grid';
    $('#eq-list').innerHTML = rows.map(clienteEqCard).join('') || '<div class="empty">Sin clientes todavía.</div>';
  }
}

function verEquiposCliente(id) {
  state.eqCliente = id;
  $('#eq-search').value = '';
  renderEquipos();
}

function volverEquipos() {
  state.eqCliente = null;
  $('#eq-search').value = '';
  renderEquipos();
}

function equipoForm(eq) {
  const opts = state.clients.map((c) => `<option value="${c.id}" ${Number(eq.client_id) === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
  return '<label>Cliente *<select id="f-client">' + opts + '</select></label>'
    + field('nombre', 'Nombre del equipo *', eq.nombre)
    + field('marca', 'Marca', eq.marca)
    + field('modelo', 'Modelo', eq.modelo)
    + field('serial', 'Serial', eq.serial)
    + field('ubicacion', 'Ubicación', eq.ubicacion)
    + field('notas', 'Notas', eq.notas, 'textarea');
}

function nuevoEquipo() {
  if (!state.clients.length) return alert('Primero registra al menos un cliente en la pestaña Clientes.');
  const eq = { client_id: Number(state.eqCliente) || state.clients[0].id };
  openModal('Nuevo equipo', equipoForm(eq), async () => {
    const x = { client_id: Number($('#f-client').value), nombre: $('#f-nombre').value, marca: $('#f-marca').value, modelo: $('#f-modelo').value, serial: $('#f-serial').value, ubicacion: $('#f-ubicacion').value, notas: $('#f-notas').value };
    const r = await window.api.equipos.save(x);
    if (!r.ok) return alert(r.error);
    await refreshAll();
  });
}

function editEquipo(id) {
  const eq = state.equipos.find((x) => x.id === id);
  openModal('Editar equipo', equipoForm(eq), async () => {
    const x = { id, client_id: Number($('#f-client').value), nombre: $('#f-nombre').value, marca: $('#f-marca').value, modelo: $('#f-modelo').value, serial: $('#f-serial').value, ubicacion: $('#f-ubicacion').value, notas: $('#f-notas').value };
    const r = await window.api.equipos.save(x);
    if (!r.ok) return alert(r.error);
    await refreshAll();
  });
}

async function delEquipo(id) {
  if (!confirm('¿Eliminar este equipo?')) return;
  await window.api.equipos.remove(id);
  await refreshAll();
}

/* ---------------- Técnicos ---------------- */
function renderTecnicos() {
  const q = ($('#tc-search').value || '').trim().toLowerCase();
  const rows = state.tecnicos.filter((t) => !q || (t.nombre + ' ' + (t.telefono || '')).toLowerCase().includes(q));
  $('#tc-count').textContent = rows.length + ' técnico(s)';
  $('#tc-list').innerHTML = rows.map((t) => `
    <div class="card">
      <div class="card-main">
        <div class="card-title">👷 ${esc(t.nombre)} ${t.rol === 'gerente' ? '<span class="pill pill-prio-alta">🔐 Gerente</span>' : ''}</div>
        <div class="card-sub">${t.telefono ? '📞 ' + esc(t.telefono) + ' · ' : ''}${t.pendientes} reporte(s) en curso</div>
      </div>
      <div class="card-actions">
        <button class="btn small" data-action="edit-tecnico" data-id="${t.id}">✏️ Editar</button>
        <button class="btn small danger" data-action="del-tecnico" data-id="${t.id}">🗑️</button>
      </div>
    </div>`).join('') || '<div class="empty">Sin técnicos todavía. Regístralos a mano o impórtalos desde un archivo (Excel, CSV o texto).</div>';
}

function tecnicoForm(t) {
  const isGerente = (t.rol || 'tecnico') === 'gerente';
  return field('nombre', 'Nombre del técnico *', t.nombre)
    + field('telefono', 'Teléfono (opcional)', t.telefono)
    + `<label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer"><input type="checkbox" id="f-rol-gerente" ${isGerente ? 'checked' : ''}> <span>🔐 Gerente (acceso de supervisión)</span></label>`;
}

function nuevoTecnico() {
  openModal('Nuevo técnico', tecnicoForm({}), async () => {
    const x = { nombre: $('#f-nombre').value, telefono: $('#f-telefono').value, rol: $('#f-rol-gerente').checked ? 'gerente' : 'tecnico' };
    const r = await window.api.tecnicos.save(x);
    if (!r.ok) return alert(r.error);
    await refreshAll();
  });
}

function editTecnico(id) {
  const t = state.tecnicos.find((x) => x.id === id);
  openModal('Editar técnico', tecnicoForm(t), async () => {
    const x = { id, nombre: $('#f-nombre').value, telefono: $('#f-telefono').value, rol: $('#f-rol-gerente').checked ? 'gerente' : 'tecnico' };
    const r = await window.api.tecnicos.save(x);
    if (!r.ok) return alert(r.error);
    await refreshAll();
  });
}

async function delTecnico(id) {
  const t = state.tecnicos.find((x) => x.id === id);
  if (!confirm('¿Eliminar a "' + t.nombre + '" del catálogo? Se quitará de los reportes asignados (los reportes se conservan).')) return;
  await window.api.tecnicos.remove(id);
  await refreshAll();
}

async function importarTecnicos() {
  const pick = await window.api.tecnicos.pickFile();
  if (!pick.ok) return;
  const prev = await window.api.tecnicos.previewImport(pick.data);
  if (!prev.ok) return alert(prev.error);
  const names = prev.data;
  if (!names.length) return alert('No se encontraron nombres de técnicos en ese archivo.');
  openModal('Importar ' + names.length + ' técnico(s)', `
    <p class="hint">Se extrajeron estos nombres del archivo. Los que ya existan se omitirán:</p>
    <div class="imp-list">${names.slice(0, 30).map((n) => '<div class="imp-item">👷 ' + esc(n) + '</div>').join('')}${names.length > 30 ? '<div class="hint">… y ' + (names.length - 30) + ' más</div>' : ''}</div>`, async () => {
    const r = await window.api.tecnicos.importSave(names);
    await refreshAll();
    alert('Se importaron ' + r.data.added + ' técnico(s). Se omitieron ' + r.data.skipped + ' repetidos.');
  });
}

/* ---------------- Reportes ---------------- */
const ESTADO_LABEL = { abierto: 'Abierto', en_proceso: 'En proceso', resuelto: 'Resuelto', espera_repuesto: 'Espera de repuesto', espera_cliente: 'Espera del cliente' };

function parseFechaLocal(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]) || 0);
  const d = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (d) return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
  const x = new Date(s);
  return isNaN(x.getTime()) ? null : x;
}

function fmtEdad(creado) {
  const t = parseFechaLocal(creado);
  if (!t) return '';
  const diff = Date.now() - t.getTime();
  if (diff < 0) return '';
  const dias = Math.floor(diff / 86400000);
  if (dias <= 0) {
    const hrs = Math.floor(diff / 3600000);
    return hrs < 1 ? '· recién creado' : '· hace ' + hrs + ' h';
  }
  return '· hace ' + dias + (dias === 1 ? ' día' : ' días');
}

function rpEquiposTxt(r) {
  if (r.equipos && r.equipos.length) return r.equipos.map((x) => x.nombre).join(', ');
  return r.equipo_nombre || '';
}

function fmtDias(d) {
  if (d == null) return '—';
  const r = Math.round(d * 10) / 10;
  return (r + '').replace('.', ',') + ' días';
}

function reporteCard(r) {
  const archivado = !!r.archivado;
  const fotos = parseAdjuntos(r.adjuntos);
  const activo = !archivado && r.estado !== 'resuelto';
  const contactLine = [r.cliente_contacto, r.cliente_telefono].filter(Boolean).map(esc).join(' · ');
  return `
    <div class="card ${r.enviado ? 'sent' : ''} ${archivado ? 'archived' : ''} ${r.prioridad === 'urgente' && !archivado ? 'urgent-card' : ''}">
      <div class="card-main">
        <div class="card-title">🚨 ${esc(r.cliente_nombre || 'Cliente')} <span class="pill pill-${esc(r.estado)}">${ESTADO_LABEL[r.estado]}</span> <span class="pill pill-prio-${esc(r.prioridad)}">${PRIO_LABEL[r.prioridad] || 'Normal'}</span> ${r.enviado ? '<span class="pill pill-sent">Enviado ✓</span>' : ''} ${r.estado === 'resuelto' && r.tecnico_nombre ? '<span class="pill pill-done">✓ ' + esc(r.tecnico_nombre) + '</span>' : ''} ${archivado ? '<span class="pill pill-archivado">📦 Archivado</span>' : ''}</div>
        <div class="card-sub">
          ${rpEquiposTxt(r) ? '🖥️ ' + esc(rpEquiposTxt(r)) + ' · ' : ''}
          📅 ${fmtFecha(r.fecha)} · 📣 ${esc(r.grupo_nombre || '(sin grupo)')}${r.enviado_at ? ' · Enviado: ' + fmtFecha(r.enviado_at) : ''}${r.archivado_at ? ' · 📦 Archivado: ' + fmtFechaHora(r.archivado_at) : ''}${activo ? ' <span class="edad">⏱️ ' + esc(fmtEdad(r.creado || r.fecha)) + '</span>' : ''}
        </div>
        ${contactLine ? '<div class="card-contact">👤 ' + contactLine + (r.cliente_email ? ' · 📧 ' + esc(r.cliente_email) : '') + '</div>' : ''}
        <div class="problem">${esc(r.descripcion)}</div>
        ${r.solucion ? '<div class="solucion">✅ <b>Resuelto:</b> ' + esc(r.solucion) + '</div>' : ''}
        ${r.ultima_nota ? '<div class="nota-box">📝 <b>Última nota:</b> ' + esc(r.ultima_nota) + (r.ultima_nota_at ? ' <span class="muted">· ' + fmtFechaHora(r.ultima_nota_at) + '</span>' : '') + '</div>' : ''}
        <div class="tech-line">${r.tecnico_id ? '👷 <b>' + esc(r.tecnico_nombre || '') + '</b> · tomado el ' + fmtFechaHora(r.asignado_at) : '👷 <span class="muted">Sin técnico asignado</span>'}</div>
        ${r.lat != null && r.lng != null ? '<div class="tech-line">📍 <a href="https://maps.google.com/?q=' + r.lat + ',' + r.lng + '" target="_blank" rel="noopener">' + Number(r.lat).toFixed(6) + ', ' + Number(r.lng).toFixed(6) + '</a></div>' : ''}
      </div>
      <div class="card-actions">
        <button class="btn small" data-action="edit-reporte" data-id="${r.id}" title="Editar reporte">✏️</button>
        <select class="btn small est est-tc" data-action="tecnico" data-id="${r.id}" title="Técnico que tomó el reporte">
          <option value="">Sin asignar</option>
          ${state.tecnicos.map((t) => `<option value="${t.id}" ${Number(r.tecnico_id) === t.id ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}
        </select>
        <select class="btn small est" data-action="estado" data-id="${r.id}">
          <option value="abierto" ${r.estado === 'abierto' ? 'selected' : ''}>Abierto</option>
          <option value="en_proceso" ${r.estado === 'en_proceso' ? 'selected' : ''}>En proceso</option>
          <option value="espera_repuesto" ${r.estado === 'espera_repuesto' ? 'selected' : ''}>⏸ Espera de repuesto</option>
          <option value="espera_cliente" ${r.estado === 'espera_cliente' ? 'selected' : ''}>⏸ Espera del cliente</option>
          <option value="resuelto" ${r.estado === 'resuelto' ? 'selected' : ''}>Resuelto</option>
        </select>
        <button class="btn small" data-action="nota-reporte" data-id="${r.id}" title="Agregar nota de avance">📝</button>
        <button class="btn small" data-action="hist-reporte" data-id="${r.id}" title="Historial">🕘</button>
        <button class="btn small" data-action="share-reporte" data-id="${r.id}" title="Compartir / descargar PDF">📤</button>
        ${fotos.length ? '<button class="btn small" data-action="ver-fotos" data-id="' + r.id + '">🖼️ ' + fotos.length + '</button>' : ''}
        ${archivado
          ? '<button class="btn small primary" data-action="restaurar-reporte" data-id="' + r.id + '">↩ Restaurar</button>'
          : (r.estado === 'resuelto' ? '<button class="btn small" data-action="archivar-reporte" data-id="' + r.id + '">📦 Archivar</button>' : '')}
        ${!archivado ? '<button class="btn small primary" data-action="send-reporte" data-id="' + r.id + '">' + (r.enviado ? '↻ Reenviar' : '📣 Enviar') + '</button>' : ''}
        <button class="btn small danger" data-action="del-reporte" data-id="${r.id}">🗑️</button>
      </div>
    </div>`;
}

function renderReportes() {
  const rows = filtrarReportes();
  $('#rp-count').textContent = rows.length + ' reporte(s)';
  const grupos = {};
  for (const r of rows) {
    const dia = String(r.fecha || '').slice(0, 10) || 'sin-fecha';
    (grupos[dia] = grupos[dia] || []).push(r);
  }
  $('#rp-list').innerHTML = Object.keys(grupos).map((dia) =>
    '<div class="rp-grup">📅 ' + esc(dia === 'sin-fecha' ? 'Sin fecha' : fmtDiaGrupo(dia)) + ' <span class="rp-grup-count">' + grupos[dia].length + '</span></div>'
    + grupos[dia].map(reporteCard).join('')
  ).join('') || '<div class="empty">Sin reportes todavía.</div>';
}

function renderGrupoList(query) {
  const list = $('#f-rp-grupo-list');
  if (!list) return;
  const groups = state.grupoData || [];
  const q = (query || '').toLowerCase();
  const matches = groups.filter((g) => !q || g.name.toLowerCase().includes(q));
  list.innerHTML = matches.map((g) => {
    const sel = String(g.id) === String(state.grupoSelId || '') || g.name === state.grupoSelName ? ' sel' : '';
    return '<div class="g-opt' + sel + '" data-gid="' + esc(g.id) + '" data-gname="' + esc(g.name) + '">' + esc(g.name) + '</div>';
  }).join('') || '<div class="g-empty">Sin coincidencias</div>';
  list.classList.add('open');
}

function openGrupoList() {
  renderGrupoList($('#f-rp-grupo-input') ? $('#f-rp-grupo-input').value : '');
}

function closeGrupoList() {
  const list = $('#f-rp-grupo-list');
  if (list) list.classList.remove('open');
}

function selectGrupo(gid, gname) {
  state.grupoSelId = gid;
  state.grupoSelName = gname;
  const input = $('#f-rp-grupo-input');
  if (input) input.value = gname;
  closeGrupoList();
}

function clearGrupoSel() {
  state.grupoSelId = '';
  state.grupoSelName = '';
  const input = $('#f-rp-grupo-input');
  if (input) input.value = '';
  renderGrupoList('');
}

function fillGrupoSelect(selectedId, selectedName) {
  const input = $('#f-rp-grupo-input');
  if (!input) return;
  const groups = state.wa.groups || [];
  state.grupoData = groups;
  const wantId = selectedId || (state.reportesSel && state.reportesSel.grupo_id);
  const wantName = selectedName || (state.reportesSel && (state.reportesSel.grupo_nombre || state.reportesSel.grupo_id)) || '';
  let g = null;
  if (wantId) g = groups.find((x) => String(x.id) === String(wantId)) || null;
  if (!g && wantName) g = groups.find((x) => x.name === wantName) || null;
  state.grupoSelId = g ? g.id : '';
  state.grupoSelName = g ? g.name : wantName || '';
  input.value = state.grupoSelName;
  input.disabled = !groups.length;
  input.placeholder = groups.length ? 'Busca el grupo y toca para elegirlo…' : '(conecta WhatsApp para ver los grupos)';
  renderGrupoList('');
}

let fotosState = { existentes: [], nuevos: [], eliminados: [] };

function initFotos(existentes, nuevos) {
  fotosState = {
    existentes: (existentes || []).map((n) => ({ name: n })),
    nuevos: (nuevos || []).map((p) => ({ path: p })),
    eliminados: []
  };
  renderFotosGrid();
}

function renderFotosGrid() {
  const grid = $('#fotos-grid');
  if (!grid) return;
  grid.innerHTML = fotosState.existentes.map((f, i) =>
    `<div class="foto-th" data-kind="e" data-i="${i}"><img><button class="foto-del" data-kind="e" data-i="${i}" title="Quitar">✕</button></div>`).join('')
    + fotosState.nuevos.map((f, i) =>
    `<div class="foto-th" data-kind="n" data-i="${i}"><img><button class="foto-del" data-kind="n" data-i="${i}" title="Quitar">✕</button></div>`).join('')
    + '<button id="btn-add-fotos" class="foto-add" type="button" title="Añadir fotos">📎</button>';
  fotosState.existentes.forEach((f, i) => {
    window.api.adjuntos.read(f.name).then((r) => {
      if (r.ok) { const im = grid.querySelector(`.foto-th[data-kind="e"][data-i="${i}"] img`); if (im) im.src = r.data; }
    });
  });
  fotosState.nuevos.forEach((f, i) => {
    window.api.adjuntos.preview(f.path).then((r) => {
      if (r.ok) { const im = grid.querySelector(`.foto-th[data-kind="n"][data-i="${i}"] img`); if (im) im.src = r.data; }
    });
  });
}

async function pickFotos() {
  const r = await window.api.adjuntos.pick();
  if (!r.ok) return;
  for (const p of r.data) {
    if (!fotosState.nuevos.some((f) => f.path === p) && !fotosState.existentes.some((f) => f.name === p)) fotosState.nuevos.push({ path: p });
  }
  renderFotosGrid();
}

function quitarFoto(kind, i) {
  if (kind === 'e') {
    const f = fotosState.existentes[i];
    if (f) { fotosState.eliminados.push(f.name); fotosState.existentes.splice(i, 1); }
  } else {
    fotosState.nuevos.splice(i, 1);
  }
  renderFotosGrid();
}

function reporteForm(rp) {
  const clients = state.clients.map((c) => `<option value="${c.id}" ${Number(rp.client_id) === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
  const prio = ['normal', 'urgente', 'baja'].map((p) => `<option value="${p}" ${(rp.prioridad || 'normal') === p ? 'selected' : ''}>${PRIO_LABEL[p]}</option>`).join('');
  return '<label>Cliente (registrado)<select id="f-rp-client"><option value="0">' + (rp.client_id ? '— Otro (escribe abajo) —' : '— Seleccionar —') + '</option>' + clients + '</select></label>'
    + field('rp-client-nombre', 'Nombre del cliente', rp.client_nombre || (rp.client_id ? '' : ''), 'text', 'placeholder="Si no está registrado, escríbelo aquí"')
    + '<label>Equipos afectados<div id="f-rp-equipos"></div><span class="hint">Marca uno o varios equipos del cliente registrado.</span></label>'
    + field('rp-equipo-nombre', 'Equipo (si no está registrado)', rp.equipo_nombre || '', 'text', 'placeholder="Marca, modelo o serie del equipo"')
    + '<label>Prioridad<select id="f-rp-prioridad">' + prio + '</select></label>'
    + '<label>Fecha<input id="f-rp-fecha" type="date" value="' + esc(rp.fecha || fechaLocal()) + '"></label>'
    + field('rp-desc', 'Problema / descripción *', rp.descripcion, 'textarea')
    + field('rp-sol', 'Solución aplicada (al resolver)', rp.solucion, 'textarea')
    + '<label>Grupo de WhatsApp<div class="combo">'
      + '<input id="f-rp-grupo-input" type="text" autocomplete="off" placeholder="Busca el grupo…">'
      + '<button type="button" id="btn-grupo-clear" class="g-clear" title="Quitar grupo">✕</button>'
      + '<div id="f-rp-grupo-list" class="g-list"></div>'
      + '</div><span class="hint">Recuerda automáticamente el grupo de cada cliente.</span></label>'
    + '<label>Fotos (opcional)</label><div id="fotos-grid"></div>'
    + (state.wa.status !== 'ready' ? '<p class="hint">⚠️ Conecta WhatsApp (barra superior) para poder ver y elegir los grupos del teléfono.</p>' : '');
}

function fillEquiposGrid(clientId, selectedIds) {
  const box = $('#f-rp-equipos');
  if (!box) return;
  const sel = new Set([].concat(selectedIds || []).map(Number));
  const eqs = state.equipos.filter((e) => e.client_id === clientId);
  if (!eqs.length) { box.innerHTML = '<span class="hint">Este cliente no tiene equipos registrados todavía.</span>'; return; }
  box.innerHTML = eqs.map((e) => {
    const on = sel.has(Number(e.id));
    return `<label class="chk-eq${on ? ' sel' : ''}">
      <input type="checkbox" value="${e.id}"${on ? ' checked' : ''}>
      <span class="chk-eq-n">🖥️ ${esc(e.nombre)}</span>
      ${(e.marca || e.modelo) ? '<span class="chk-eq-m">' + esc([e.marca, e.modelo].filter(Boolean).join(' ')) + '</span>' : ''}
      ${e.serial ? '<span class="chk-eq-s">· ' + esc(e.serial) + '</span>' : ''}
    </label>`;
  }).join('');
}

function onRpClientChange() {
  fillEquiposGrid(Number($('#f-rp-client').value) || 0, []);
}

function recEquiposIds() {
  const box = $('#f-rp-equipos');
  return box ? Array.from(box.querySelectorAll('input:checked')).map((i) => Number(i.value)) : [];
}

function nuevoReporte() {
  const rp = { client_id: state.clients.length ? state.clients[0].id : 0, client_nombre: '', equipo_nombre: '', fecha: fechaLocal() };
  state.reportesSel = rp;
  openModal('Nuevo reporte de falla', reporteForm(rp), async () => {
    const x = {
      client_id: Number($('#f-rp-client').value),
      client_nombre: $('#f-rp-client-nombre').value,
      equipo_nombre: $('#f-rp-equipo-nombre').value,
      equipos_ids: recEquiposIds(),
      descripcion: $('#f-rp-desc').value,
      fecha: $('#f-rp-fecha').value,
      estado: 'abierto',
      prioridad: $('#f-rp-prioridad').value,
      solucion: $('#f-rp-sol').value,
      grupo_id: state.grupoSelId || '',
      grupo_nombre: state.grupoSelName || '',
      adjuntos: [],
      adjuntosNuevos: fotosState.nuevos.map((f) => f.path),
      adjuntosEliminados: []
    };
    const r = await window.api.reportes.save(x);
    if (!r.ok) return alert(r.error);
    await refreshAll();
  });
  fillEquiposGrid(rp.client_id, []);
  const defCl = state.clients.find((c) => c.id === rp.client_id);
  fillGrupoSelect((defCl && defCl.grupo_id) || '', (defCl && defCl.grupo_nombre) || '');
  initFotos([], []);
}

function editReporte(id) {
  const rp = state.reportes.find((x) => x.id === id);
  state.reportesSel = rp;
  openModal('Editar reporte', reporteForm(rp), async () => {
    const x = {
      id,
      client_id: Number($('#f-rp-client').value),
      client_nombre: $('#f-rp-client-nombre').value,
      equipo_nombre: $('#f-rp-equipo-nombre').value,
      equipos_ids: recEquiposIds(),
      descripcion: $('#f-rp-desc').value,
      fecha: $('#f-rp-fecha').value,
      estado: rp.estado,
      prioridad: $('#f-rp-prioridad').value,
      solucion: $('#f-rp-sol').value,
      grupo_id: state.grupoSelId || '',
      grupo_nombre: state.grupoSelName || '',
      adjuntos: fotosState.existentes.map((f) => f.name),
      adjuntosNuevos: fotosState.nuevos.map((f) => f.path),
      adjuntosEliminados: fotosState.eliminados
    };
    const r = await window.api.reportes.save(x);
    if (!r.ok) return alert(r.error);
    await refreshAll();
  });
  const eqSel = rp.equipos && rp.equipos.length ? rp.equipos.map((x) => x.id) : (rp.equipo_id ? [rp.equipo_id] : []);
  fillEquiposGrid(rp.client_id, eqSel);
  fillGrupoSelect(rp.grupo_id);
  initFotos(parseAdjuntos(rp.adjuntos), []);
}

let resolverState = null;

function abrirResolver(id, rp) {
  resolverState = { id };
  $('#resolver-body').innerHTML = `
    <div class="resume-box">
      <div class="resume-t">🚨 ${esc((rp && rp.cliente_nombre) || 'Reporte')}${rp && rpEquiposTxt(rp) ? ' · ' + esc(rpEquiposTxt(rp)) : ''}</div>
      <div class="resume-d">${esc((rp && rp.descripcion) || '')}</div>
    </div>
    <label>Nota del técnico / solución aplicada
      <span class="hint">Opcional: si la dejas vacía, el caso igual se cerrará como resuelto.</span>
      <textarea id="f-resolver-nota" rows="4" placeholder="Ej.: Se reemplazó la fuente de poder y el equipo quedó operativo.">${esc((rp && rp.solucion) || '')}</textarea>
    </label>
    <label>Fotos de evidencia (opcional)</label><div id="fotos-grid"></div>`;
  $('#resolver-mask').classList.remove('hidden');
  initFotos(parseAdjuntos(rp && rp.adjuntos), []);
  const ta = $('#f-resolver-nota');
  if (ta) ta.focus();
}

async function cerrarResolver() {
  resolverState = null;
  $('#resolver-mask').classList.add('hidden');
  await refreshAll();
}

async function setEstado(id, estado) {
  if (estado === 'resuelto') {
    abrirResolver(id, state.reportes.find((x) => x.id === id));
    return;
  }
  await window.api.reportes.setEstado(id, estado);
  await refreshAll();
}

function compartirReporte(id) {
  const rp = state.reportes.find((x) => x.id === id);
  $('#share-body').innerHTML = `
    <div class="resume-box">
      <div class="resume-t">🚨 ${esc((rp && rp.cliente_nombre) || 'Reporte')}${rp && rpEquiposTxt(rp) ? ' · ' + esc(rpEquiposTxt(rp)) : ''} <span class="pill pill-${esc(rp && rp.estado)}">${ESTADO_LABEL[(rp && rp.estado)]}</span></div>
      <div class="resume-d">${esc((rp && rp.descripcion) || '')}</div>
    </div>
    <button class="btn primary share-opt" data-action="pdf-reporte" data-id="${id}">📥 Descargar en PDF</button>
    <button class="btn share-opt" data-action="wa-pdf-reporte" data-id="${id}">📤 Enviar PDF por WhatsApp</button>
    <p class="hint">El PDF incluye los datos, la solución/nota, el historial detallado y las imágenes de evidencia.</p>`;
  $('#share-mask').classList.remove('hidden');
}

function cerrarCompartir() {
  $('#share-mask').classList.add('hidden');
}

function agregarNota(id) {
  const rp = state.reportes.find((x) => x.id === id);
  const title = '📝 Nota de avance — ' + esc((rp && rp.cliente_nombre) || 'Reporte') + (rp && rpEquiposTxt(rp) ? ' · ' + esc(rpEquiposTxt(rp)) : '');
  openModal(title, `
    <label>Nota del técnico
      <span class="hint">Se guarda en el historial del reporte y se muestra en la tarjeta.</span>
      <textarea id="f-nota-texto" rows="4" placeholder="Ej.: Se pidió el repuesto al proveedor, llega el viernes."></textarea>
    </label>`, async () => {
    const texto = $('#f-nota-texto').value;
    const r = await window.api.reportes.nota(id, texto);
    if (!r.ok) { alert(r.error); return; }
    await refreshAll();
  });
  setTimeout(() => { const ta = $('#f-nota-texto'); if (ta) ta.focus(); }, 50);
}

async function verResumen() {
  const r = await window.api.reportes.resumen();
  if (!r.ok) return alert(r.error);
  const s = r.data;
  const estRows = s.porEstado.filter((x) => x.n > 0).map((x) => `<div class="panel-row"><span class="panel-name">${esc(x.label)}</span><span class="panel-val"><b>${x.n}</b></span></div>`).join('') || '<div class="hint">Sin reportes activos.</div>';
  const tecRows = s.resumenTecnicos.slice(0, 8).map((x) => `<div class="panel-row"><span class="panel-name">${esc(x.tecnico)}</span><span class="panel-val">${x.resueltos} · <b>${fmtDias(x.promedio)}</b></span></div>`).join('') || '<div class="hint">Sin reportes resueltos.</div>';
  const mesRows = s.meses.map((x) => `<div class="panel-row"><span class="panel-name">${esc(fmtMes(x.mes))}</span><span class="panel-val">${x.creados} creados · ${x.resueltos} resueltos</span></div>`).join('') || '<div class="hint">Sin actividad.</div>';
  const cliRows = s.resumenClientes.slice(0, 8).map((x) => `<div class="panel-row"><span class="panel-name">${esc(x.cliente)}</span><span class="panel-val">${x.total} · <b>${x.activos} activos</b></span></div>`).join('') || '<div class="hint">Sin clientes.</div>';
  const eqRows = s.resumenEquipos.slice(0, 8).map((x) => `<div class="panel-row"><span class="panel-name">${esc(x.equipo)}</span><span class="panel-val"><b>${x.total}</b></span></div>`).join('') || '<div class="hint">Sin equipos.</div>';
  const vieRows = s.viejos.slice(0, 8).map((x) => `<div class="panel-row"><span class="panel-name">${esc(x.cliente || 'Cliente')}${x.equipo ? ' · ' + esc(x.equipo) : ''}</span><span class="panel-val">${ESTADO_LABEL[x.estado] || ''} · <b>${Math.round(x.dias)}d</b></span></div>`).join('') || '<div class="hint">Nada con +7 días 🎉</div>';
  openModal('📊 Resumen ejecutivo', `
    <div class="resume-box">
      <div class="resume-t">📊 ${s.total} reportes · ${s.activos} activos · ${s.resueltos} resueltos</div>
      <div class="resume-d">Promedio de días para resolver: <b>${fmtDias(s.promedioGlobal)}</b></div>
    </div>
    <div class="panel-grid resumen-grid">
      <div class="panel-card"><h4>Estados actuales</h4>${estRows}</div>
      <div class="panel-card"><h4>⏱️ Por técnico (resueltos · promedio)</h4>${tecRows}</div>
      <div class="panel-card"><h4>📈 Por mes</h4>${mesRows}</div>
      <div class="panel-card"><h4>🏢 Por cliente</h4>${cliRows}</div>
      <div class="panel-card"><h4>🖥️ Equipos con más fallas</h4>${eqRows}</div>
      <div class="panel-card"><h4>⏰ Antiguos +7 días</h4>${vieRows}</div>
    </div>
    <button class="btn primary" data-action="resumen-xlsx">⬇ Descargar Excel</button>
    <p class="hint">El Excel incluye pestañas de resumen, por técnico, por mes, por cliente y por equipo.</p>`, null);
}

async function descargarResumenXlsx() {
  const r = await window.api.reportes.resumenXlsx();
  if (!r.ok) { if (!r.canceled) alert(r.error); return; }
  alert('Resumen ejecutivo guardado en:\n' + r.data);
}

async function exportarReportePDF(id) {
  const r = await window.api.reportes.pdf(id);
  cerrarCompartir();
  if (!r.ok) return alert(r.error);
  if (!r.canceled) alert('PDF guardado en:\n' + r.path);
}

async function enviarReportePDF(id) {
  const r = await window.api.reportes.pdfEnviar(id);
  cerrarCompartir();
  if (!r.ok) return alert(r.error);
  alert('Reporte en PDF enviado al grupo: ' + r.sentTo);
}

async function setTecnico(id, tecnicoId) {
  await window.api.reportes.setTecnico(id, tecnicoId);
  await refreshAll();
}

async function archivarReporte(id) {
  if (!confirm('¿Archivar este reporte resuelto? Quedará guardado con su historial, pero fuera de la lista principal.')) return;
  await window.api.reportes.setArchivado(id, 1);
  await refreshAll();
}

async function restaurarReporte(id) {
  await window.api.reportes.setArchivado(id, 0);
  await refreshAll();
}

const HIST_LABELS = {
  creado: '🆕 Reporte creado',
  editado: '✏️ Reporte editado',
  enviado: '📣 Enviado a WhatsApp',
  estado: '🔄 Estado cambiado',
  tecnico: '👷 Técnico',
  archivado: '📦 Archivo',
  nota: '📝 Nota del técnico',
  recordatorio: '⏰ Recordatorio automático'
};

async function verHistorial(id) {
  const r = await window.api.reportes.historial(id);
  if (!r.ok) return alert(r.error);
  const rp = state.reportes.find((x) => x.id === id);
  const events = r.data;
  $('#hist-mask').classList.remove('hidden');
  $('#hist-body').innerHTML = `
    <div class="hist-title">🚨 ${esc((rp && rp.cliente_nombre) || 'Reporte')}${rp && rpEquiposTxt(rp) ? ' · ' + esc(rpEquiposTxt(rp)) : ''}</div>
    ${events.length ? events.map((ev) => `
      <div class="hist-item">
        <div class="hist-icon">${HIST_LABELS[ev.tipo] || '📌'}</div>
        <div class="hist-text">
          <div class="hist-det">${esc(ev.detalle)}</div>
          <div class="hist-time">${esc(ev.creado)}</div>
        </div>
      </div>`).join('') : '<div class="empty">Sin eventos registrados.</div>'}
    ${rp && rp.tecnico_nombre ? '<div class="hint" style="margin-top:10px">Asignado actualmente: 👷 ' + esc(rp.tecnico_nombre) + ' (' + esc(rp.asignado_at || '') + ')</div>' : ''}`;
}

function closeHistorial() {
  $('#hist-mask').classList.add('hidden');
}

async function delReporte(id) {
  if (!confirm('¿Eliminar este reporte?')) return;
  await window.api.reportes.remove(id);
  await refreshAll();
}

async function sendReporte(id, btn) {
  const rp = state.reportes.find((x) => x.id === id);
  if (!rp) return;
  if (state.wa.status !== 'ready') return alert('Conecta WhatsApp primero (barra superior).');
  if (!rp.grupo_id && !rp.grupo_nombre) return alert('Este reporte no tiene grupo asignado. Edítalo y elige el grupo de WhatsApp.');
  if (!confirm('¿Enviar este reporte al grupo "' + (rp.grupo_nombre || '') + '" de WhatsApp?')) return;
  if (btn) { btn.disabled = true; }
  const r = await window.api.wa.send({ reportId: id });
  if (!r.ok) return alert('No se pudo enviar: ' + r.error);
  alert('Reporte enviado al grupo: ' + r.data.sentTo);
  await refreshAll();
}

/* ---------------- Fotos / visor ---------------- */
let fotoState = { lista: [], idx: 0, cache: {} };

function cargarFoto() {
  const f = fotoState.lista[fotoState.idx];
  const img = $('#foto-img');
  if (!f) { img.src = ''; return; }
  $('#foto-count').textContent = (fotoState.idx + 1) + ' / ' + fotoState.lista.length;
  if (fotoState.cache[f]) { img.src = fotoState.cache[f]; return; }
  img.src = '';
  window.api.adjuntos.read(f).then((r) => {
    if (r.ok) { fotoState.cache[f] = r.data; if (fotoState.lista[fotoState.idx] === f) img.src = r.data; }
  });
}

function verFotos(id) {
  const rp = state.reportes.find((x) => x.id === id);
  const lista = parseAdjuntos(rp && rp.adjuntos);
  if (!lista.length) return;
  fotoState = { lista, idx: 0, cache: {} };
  $('#foto-mask').classList.remove('hidden');
  cargarFoto();
}

function fotoNav(dir) {
  if (!fotoState.lista.length) return;
  fotoState.idx = (fotoState.idx + dir + fotoState.lista.length) % fotoState.lista.length;
  cargarFoto();
}

function cerrarFotos() {
  $('#foto-mask').classList.add('hidden');
}

let imgVerState = { archivo: '', mime: '', nombre: '', tipo: 'imagen' };

function cargarMediaVer(archivo, mime, cb) {
  if (state.mediaCache[archivo]) { cb(state.mediaCache[archivo]); return; }
  window.api.wa.mensajesMedia(archivo, mime).then((r) => {
    if (r && r.ok) { state.mediaCache[archivo] = r.data; cb(r.data); }
    else cb('');
  }).catch(() => cb(''));
}

function abrirImgVer(archivo, mime, nombre) {
  imgVerState = { archivo, mime: mime || '', nombre: nombre || '', tipo: 'imagen' };
  $('#ms-video-full').pause();
  $('#ms-video-full').removeAttribute('src');
  $('#ms-video-full').load();
  $('#ms-video-full').classList.add('hidden');
  $('#ms-img-full').classList.remove('hidden');
  const img = $('#ms-img-full');
  img.src = '';
  cargarMediaVer(archivo, imgVerState.mime, (data) => { if (data) img.src = data; else img.alt = 'No disponible'; });
  $('#ms-img-title').textContent = 'Imagen';
  $('#btn-ms-img-download').textContent = '⬇ Descargar';
  $('#ms-img-mask').classList.remove('hidden');
}

function abrirVideoVer(archivo, mime, nombre) {
  imgVerState = { archivo, mime: mime || 'video/mp4', nombre: nombre || '', tipo: 'video' };
  $('#ms-img-full').classList.add('hidden');
  const vid = $('#ms-video-full');
  vid.classList.remove('hidden');
  vid.removeAttribute('src');
  cargarMediaVer(archivo, imgVerState.mime, (data) => {
    if (data) vid.src = data;
    else vid.classList.add('hidden');
  });
  $('#ms-img-title').textContent = 'Video';
  $('#btn-ms-img-download').textContent = '⬇ Descargar';
  $('#ms-img-mask').classList.remove('hidden');
}

function cerrarImgVer() {
  $('#ms-video-full').pause();
  $('#ms-video-full').removeAttribute('src');
  $('#ms-img-mask').classList.add('hidden');
}

function descargarImgVer() {
  if (!imgVerState.archivo) return;
  window.api.wa.descargarMedia(imgVerState.archivo, imgVerState.nombre).then((r) => {
    if (r && r.ok && !r.cancel) alert((imgVerState.tipo === 'video' ? 'Video' : 'Imagen') + ' guardado en: ' + r.path);
  });
}

async function exportarReportes() {
  const rows = filtrarReportes();
  if (!rows.length) return alert('No hay reportes para exportar con el filtro actual.');
  const r = await window.api.reportes.export(rows);
  if (!r.ok) { if (!r.canceled) alert(r.error); return; }
  alert('Archivo Excel guardado:\n' + r.data);
}

async function hacerBackupManual() {
  const r = await window.api.reportes.backup();
  if (!r.ok) return alert(r.error);
  alert('Copia de seguridad creada:\n' + r.data);
}

/* ---------------- Configuración ---------------- */
async function openSettings() {
  const st = state.settings;
  const medio = st.recordatorio_medio || 'grupo';
  const on = st.recordatorio_enabled === '1';
  let syncInfo = null;
  try {
    const sr = await window.api.sync.status();
    syncInfo = sr.ok ? sr.data : null;
  } catch (e) { /* noop */ }
  const sOn = st.sync_enabled === '1';
  const sUrl = st.sync_url || '';
  const sEstado = syncInfo && syncInfo.conectado ? 'Conectado' : (syncInfo && syncInfo.error ? 'Error: ' + syncInfo.error : 'Sin conexión');
  const sUltimo = syncInfo && syncInfo.ultimo ? syncInfo.ultimo : (st.sync_last || 'nunca');
  const tecRows = (state.tecnicos || []).map((t) => {
    const tiene = !!(t.sync_pass && t.sync_pass !== '__clear__');
    return `
      <div class="config-row sync-tec">
        <span class="sync-tec-nombre">${esc(t.nombre)}</span>
        <label class="switch-row"><input type="checkbox" class="sync-tec-on" data-id="${t.id}" ${tiene ? 'checked' : ''}> Acceso a la app</label>
        <input type="password" class="sync-tec-pass" data-id="${t.id}" placeholder="Contraseña (mín. 4)" ${tiene ? '' : 'disabled'}>
      </div>`;
  }).join('');
  openModal('Configuración', `
    ${field('negocio', 'Nombre del negocio (se firma al final del mensaje)', st.negocio)}
    <h4>🔁 Notificación automática de repuestos</h4>
    <p class="hint">Cuando un técnico cambia un reporte a "Espera de repuesto" o "Espera del cliente" desde la app móvil, se envía automáticamente un mensaje al grupo de WhatsApp de piezas con el cliente, equipo y la nota del técnico.</p>
    <label>Grupo de WhatsApp para piezas
      <select id="f-wa-grupo-piezas">
        <option value="">(desactivado)</option>
      </select>
    </label>
    <p class="hint">Selecciona el grupo de compras/piezas. Solo se envía si la PC está encendida con WhatsApp conectado.</p>
    <h4>⏰ Recordatorios automáticos de WhatsApp (opcional)</h4>
    <p class="hint">Envía un recordatorio por WhatsApp a los reportes que llevan varios días sin resolver. Es opcional: si algunos reportes se registran por llamada y no requieren recordatorio por texto, puedes dejarlo desactivado.</p>
    <label class="switch-row"><input type="checkbox" id="f-rec-enabled" ${on ? 'checked' : ''}> Activar recordatorios automáticos</label>
    <label>Enviar a
      <select id="f-rec-medio">
        <option value="grupo" ${medio === 'grupo' ? 'selected' : ''}>Grupo de WhatsApp del cliente</option>
        <option value="directo" ${medio === 'directo' ? 'selected' : ''}>Teléfono directo del cliente</option>
        <option value="ambos" ${medio === 'ambos' ? 'selected' : ''}>Grupo, y si no se puede, teléfono directo</option>
      </select>
    </label>
    <div class="config-row">
      ${field('rec-dias', 'Recordar a partir de (días)', st.recordatorio_dias || '3', 'number', 'min="1" max="90"')}
      ${field('rec-hora', 'Hora de envío (HH:MM)', st.recordatorio_hora || '09:00', 'time')}
      ${field('rec-max', 'Máx. de recordatorios por reporte', st.recordatorio_max || '3', 'number', 'min="1" max="30"')}
    </div>
    <p class="hint">Reglas: solo se recuerdan reportes que ya fueron enviados al grupo, no estén resueltos ni archivados y superen los días indicados. Cada reporte se recuerda como máximo 1 vez por día, y no más del límite configurado.</p>
    <h4>📱 App móvil de técnicos</h4>
    <p class="hint">Los técnicos ven sus reportes asignados y actualizan el estado y los comentarios desde el teléfono. Esta PC sincroniza automáticamente con el servidor.</p>
    <label>URL del servidor
      <input id="f-sync-url" type="text" value="${esc(sUrl)}" placeholder="https://tuservidor.com">
    </label>
    <label class="switch-row"><input type="checkbox" id="f-sync-enabled" ${sOn ? 'checked' : ''}> Activar sincronización automática</label>
    <p class="hint">Estado: <strong>${esc(sEstado)}</strong> · Última sincronización: ${esc(sUltimo)}</p>
    <h4>Acceso de los técnicos a la app</h4>
    <p class="hint">Marca cada técnico y ponle una contraseña para que pueda iniciar sesión en la app móvil. El usuario será su nombre (p. ej. "Carlos Peña" → usuario "carlos").</p>
    ${tecRows || '<p class="hint">Primero agrega técnicos en la pestaña Técnicos.</p>'}
    <button class="btn" type="button" data-action="sync-run">🔄 Sincronizar ahora</button>
    <button class="btn" type="button" data-action="backup">💾 Hacer copia de seguridad de los datos</button>`, async () => {
    await window.api.settings.save({
      negocio: $('#f-negocio').value,
      recordatorio_enabled: $('#f-rec-enabled').checked ? '1' : '0',
      recordatorio_medio: $('#f-rec-medio').value,
      recordatorio_dias: $('#f-rec-dias').value || '3',
      recordatorio_hora: $('#f-rec-hora').value || '09:00',
      recordatorio_max: $('#f-rec-max').value || '3',
      sync_url: $('#f-sync-url').value.trim(),
      sync_enabled: $('#f-sync-enabled').checked,
      wa_grupo_piezas: $('#f-wa-grupo-piezas').value
    });
    for (const row of document.querySelectorAll('.sync-tec-on')) {
      const id = Number(row.dataset.id);
      const pass = document.querySelector('.sync-tec-pass[data-id="' + id + '"]').value;
      if (!row.checked) await window.api.sync.setTecnicoPass(id, { habilitado: false, pass: '' });
      else if (pass) await window.api.sync.setTecnicoPass(id, { habilitado: true, pass });
    }
    await refreshAll();
  });
  setTimeout(async () => {
    try {
      const sel = $('#f-wa-grupo-piezas');
      if (!sel) return;
      const groups = state.wa.groups || [];
      for (const g of groups) {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.name || g.id;
        if (g.id === (st.wa_grupo_piezas || '')) opt.selected = true;
        sel.appendChild(opt);
      }
    } catch (e) { /* noop */ }
  }, 100);
}

async function probarRecordatorios() {
  const r = await window.api.reportes.recordatorioRun();
  if (!r.ok) return alert(r.error);
  const d = r.data || {};
  if (d.desactivado) return alert('Los recordatorios están desactivados. Actívalos en Configuración y pulsa Guardar.');
  if (d.waNoConectado) return alert('WhatsApp no está conectado. Conéctalo y vuelve a intentarlo.');
  const enviados = d.enviados || [];
  if (!enviados.length) return alert('No había reportes que recordar en este momento (sin reportes que superen los días configurados, o ya recordados hoy).');
  alert('Se enviaron ' + enviados.length + ' recordatorio(s):\n' + enviados.map((x) => '• ' + x.cliente + ' (hace ' + x.dias + ' día(s))').join('\n'));
}

async function sincronizarAhora() {
  const btn = document.querySelector('[data-action="sync-run"]');
  if (btn) { btn.textContent = '🔄 Sincronizando...'; btn.disabled = true; }
  const r = await window.api.sync.run();
  if (btn) { btn.textContent = '🔄 Sincronizar ahora'; btn.disabled = false; }
  if (r.ok) alert('Sincronización correcta.\nCambios del teléfono recibidos: ' + (r.cambios || 0) + '\nCambios aplicados: ' + (r.aplicados || 0));
  else if (r.error && r.error !== 'ya en curso') alert('Error de sincronización: ' + r.error);
}

/* ---------------- Eventos ---------------- */
$('#btn-wa-connect').addEventListener('click', connectWa);
$('#btn-settings').addEventListener('click', openSettings);
$('#btn-nuevo-cliente').addEventListener('click', nuevoCliente);
$('#btn-nuevo-equipo').addEventListener('click', nuevoEquipo);
$('#btn-nuevo-reporte').addEventListener('click', nuevoReporte);
$('#btn-nuevo-tecnico').addEventListener('click', nuevoTecnico);
$('#btn-importar-tecnicos').addEventListener('click', importarTecnicos);
$('#cl-search').addEventListener('input', renderClients);
$('#eq-search').addEventListener('input', renderEquipos);
$('#btn-eq-back').addEventListener('click', volverEquipos);
$('#rp-filter').addEventListener('change', renderReportes);
$('#rp-client-filter').addEventListener('change', renderReportes);
$('#rp-equipo-filter').addEventListener('change', renderReportes);
$('#rp-search').addEventListener('input', renderReportes);
$('#btn-resumen').addEventListener('click', verResumen);
$('#tc-search').addEventListener('input', renderTecnicos);
$('#btn-exportar').addEventListener('click', exportarReportes);
$('#btn-pending-go').addEventListener('click', () => goReportes('pendientes'));
$('#btn-ms-refresh').addEventListener('click', refreshMensajes);
$('#btn-ms-borrar-todos').addEventListener('click', borrarTodosChats);
$('#ms-search').addEventListener('input', renderConversaciones);
$('#btn-ms-send').addEventListener('click', enviarRespuesta);
$('#ms-reply-input').addEventListener('keydown', (ev) => {
  const panel = $('#ms-mention-panel');
  const abierto = panel && !panel.classList.contains('hidden') && state.mentList.length;
  if (abierto) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); state.mentSel = (state.mentSel + 1) % state.mentList.length; pintarMentSel(); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); state.mentSel = (state.mentSel - 1 + state.mentList.length) % state.mentList.length; pintarMentSel(); return; }
    if (ev.key === 'Enter') { ev.preventDefault(); const mb = state.mentList[state.mentSel]; if (mb) mencionarMiembro(mb); return; }
    if (ev.key === 'Escape') { ev.preventDefault(); ocultarPanelMenciones(); return; }
    if (ev.key === 'Tab') { ev.preventDefault(); const mb = state.mentList[state.mentSel]; if (mb) mencionarMiembro(mb); return; }
  }
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); enviarRespuesta(); }
});
$('#ms-reply-input').addEventListener('input', (ev) => {
  autoGrowInput();
  manejarMencionInput();
});
$('#ms-mention-panel').addEventListener('mousedown', (ev) => {
  ev.preventDefault();
  const it = ev.target.closest('.ms-mention-item');
  if (!it) return;
  const mb = state.mentList[Number(it.dataset.i)];
  if (mb) mencionarMiembro(mb);
});
$('#ms-chats').addEventListener('click', (ev) => {
  const el = ev.target.closest('.ms-chat');
  if (el) openConversacion(el.dataset.jid);
});
$('#ms-chat-msgs').addEventListener('click', (ev) => {
  if (ev.target.closest('[data-action]')) return;
  const box = ev.target.closest('.msg-check');
  const msg = ev.target.closest('.msg');
  const quote = ev.target.closest('.msg-quote');
  if (quote && quote.dataset.replyto) { scrollToReply(quote.dataset.replyto); return; }
  if (box) { toggleMsgSel(Number(box.dataset.check)); return; }
  if (msg && ev.target.closest('.msg-video')) {
    const el = ev.target.closest('.msg-video');
    const f = el.dataset.file;
    const m = state.mensajes.find((x) => x.id === Number(msg.dataset.id));
    abrirVideoVer(f, (m && m.media_mime) || 'video/mp4', f);
    return;
  }
  if (msg && ev.target.closest('audio, video')) return;
  if (msg && ev.target.closest('.msg-img')) {
    const f = ev.target.closest('.msg-img').dataset.file;
    const m = state.mensajes.find((x) => x.id === Number(msg.dataset.id));
    abrirImgVer(f, (m && m.media_mime) || 'image/webp', f);
    return;
  }
  if (msg && state.msgSel.size) { toggleMsgSel(Number(msg.dataset.id)); return; }
  if (msg) setReplyTo(Number(msg.dataset.id));
});
$('#btn-ms-reply-cancel').addEventListener('click', cancelReply);
$('#btn-ms-mic').addEventListener('click', toggleGrabacion);
$('#btn-ms-rec-cancel').addEventListener('click', () => detenerGrabacion(false));
$('#btn-ms-attach').addEventListener('click', (ev) => {
  ev.stopPropagation();
  $('#ms-emoji-panel').classList.add('hidden');
  $('#ms-sticker-panel').classList.add('hidden');
  $('#ms-attach-menu').classList.toggle('hidden');
});
$('#btn-ms-emoji').addEventListener('click', (ev) => {
  ev.stopPropagation();
  renderEmojiGrid();
  $('#ms-attach-menu').classList.add('hidden');
  $('#ms-sticker-panel').classList.add('hidden');
  $('#ms-emoji-panel').classList.toggle('hidden');
});
$('#ms-emoji-grid').addEventListener('click', (ev) => {
  const b = ev.target.closest('.emoji-item');
  if (!b) return;
  ev.stopPropagation();
  insertarEmoji(b.dataset.e);
});
$('#ms-sticker-grid').addEventListener('click', (ev) => {
  const it = ev.target.closest('.ms-sticker-item');
  if (!it) return;
  ev.stopPropagation();
  sendSticker(it.dataset.file);
});
$('#btn-ms-sticker-add').addEventListener('click', (ev) => {
  ev.stopPropagation();
  const fi = document.querySelector('#ms-file-sticker-pack');
  if (fi) fi.click();
});
$('#ms-file-sticker-pack').addEventListener('change', (ev) => {
  const files = ev.target.files ? [...ev.target.files] : [];
  ev.target.value = '';
  importarStickersArchivos(files);
});
$('#ms-attach-menu').addEventListener('click', (ev) => {
  const it = ev.target.closest('.attach-item');
  if (!it) return;
  ev.stopPropagation();
  const acc = it.dataset.accion;
  if (acc === 'adjuntar-sticker') {
    $('#ms-attach-menu').classList.add('hidden');
    $('#ms-emoji-panel').classList.add('hidden');
    renderStickerGrid();
    $('#ms-sticker-panel').classList.toggle('hidden');
    return;
  }
  const map = { 'adjuntar-imagen': '#ms-file-imagen', 'adjuntar-video': '#ms-file-video', 'adjuntar-documento': '#ms-file-documento' };
  $('#ms-attach-menu').classList.add('hidden');
  const fi = document.querySelector(map[acc]);
  if (fi) fi.click();
});
document.addEventListener('click', (ev) => {
  if (!ev.target.closest('#btn-ms-attach') && !ev.target.closest('#ms-attach-menu')
    && !ev.target.closest('#btn-ms-emoji') && !ev.target.closest('#ms-emoji-panel')
    && !ev.target.closest('#ms-sticker-panel')) {
    closeMsPanels();
  }
});
function bindMsFiles() {
  const defs = {
    'adjuntar-imagen': { input: '#ms-file-imagen', tipo: 'imagen' },
    'adjuntar-video': { input: '#ms-file-video', tipo: 'video' },
    'adjuntar-sticker': { input: '#ms-file-sticker', tipo: 'sticker' },
    'adjuntar-documento': { input: '#ms-file-documento', tipo: 'documento' }
  };
  for (const key in defs) {
    const d = defs[key];
    document.querySelector(d.input).addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (f) enviarMedia(d.tipo, f);
      ev.target.value = '';
    });
  }
}
bindMsFiles();
$('#btn-ms-sel-reporte').addEventListener('click', () => {
  if (!state.msgSel.size) return;
  nuevoReporteDesdeMensajes([...state.msgSel]);
});
$('#btn-ms-sel-cancel').addEventListener('click', cancelMsgSel);
$('#panel-stats').addEventListener('click', (ev) => {
  const st = ev.target.closest('.stat');
  if (st && st.dataset.filter) goReportes(st.dataset.filter);
});
$('#btn-foto-close').addEventListener('click', cerrarFotos);
$('#btn-foto-prev').addEventListener('click', () => fotoNav(-1));
$('#btn-foto-next').addEventListener('click', () => fotoNav(1));
$('#foto-mask').addEventListener('click', (ev) => { if (ev.target === $('#foto-mask')) cerrarFotos(); });
$('#btn-ms-img-close').addEventListener('click', cerrarImgVer);
$('#btn-ms-img-download').addEventListener('click', descargarImgVer);
$('#ms-img-mask').addEventListener('click', (ev) => { if (ev.target === $('#ms-img-mask')) cerrarImgVer(); });

$('#btn-lic').addEventListener('click', openLicModal);
$('#btn-lic-top').addEventListener('click', openLicModal);
$('#btn-gate-activate').addEventListener('click', openLicModal);
$('#btn-lic-close').addEventListener('click', () => $('#lic-mask').classList.add('hidden'));
$('#btn-lic-cancel').addEventListener('click', () => $('#lic-mask').classList.add('hidden'));
$('#btn-lic-activate').addEventListener('click', activateLic);
$('#btn-lic-deactivate').addEventListener('click', async () => {
  try {
    await window.api.license.deactivate();
    await loadLicense();
    $('#lic-mask').classList.add('hidden');
  } catch (e) {
    $('#lic-result').className = 'lic-result err';
    $('#lic-result').textContent = 'No se pudo desactivar la licencia';
  }
});
$('#lic-mask').addEventListener('click', (ev) => { if (ev.target === $('#lic-mask')) $('#lic-mask').classList.add('hidden'); });
$('#btn-lic-file').addEventListener('click', () => $('#lic-file').click());
$('#lic-file').addEventListener('change', (ev) => {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => { $('#lic-key').value = String(reader.result || '').trim(); };
  reader.readAsText(f);
});

$('#btn-modal-ok').addEventListener('click', async () => {
  if (!state.modalAction) return;
  const action = state.modalAction;
  closeModal();
  await action();
});
$('#btn-modal-cancel').addEventListener('click', closeModal);
$('#btn-modal-close').addEventListener('click', closeModal);
$('#modal-mask').addEventListener('click', (ev) => { if (ev.target === $('#modal-mask')) closeModal(); });

$('#btn-resolver-ok').addEventListener('click', async () => {
  if (!resolverState) return;
  const nota = $('#f-resolver-nota').value;
  const r = await window.api.reportes.resolver(
    resolverState.id,
    nota,
    fotosState.nuevos.map((f) => f.path),
    fotosState.eliminados,
    fotosState.existentes.map((f) => f.name)
  );
  if (!r.ok) { alert(r.error); return; }
  await cerrarResolver();
});
$('#btn-resolver-cancel').addEventListener('click', cerrarResolver);
$('#btn-resolver-close').addEventListener('click', cerrarResolver);
$('#resolver-mask').addEventListener('click', (ev) => { if (ev.target === $('#resolver-mask')) cerrarResolver(); });
$('#resolver-body').addEventListener('click', (ev) => {
  const del = ev.target.closest('.foto-del');
  if (del) { ev.stopPropagation(); quitarFoto(del.dataset.kind, Number(del.dataset.i)); return; }
  if (ev.target.closest('#btn-add-fotos')) pickFotos();
});

$('#btn-share-close').addEventListener('click', cerrarCompartir);
$('#btn-share-cancel').addEventListener('click', cerrarCompartir);
$('#share-mask').addEventListener('click', (ev) => { if (ev.target === $('#share-mask')) cerrarCompartir(); });

$('#btn-qr-close').addEventListener('click', () => $('#qr-mask').classList.add('hidden'));
$('#btn-qr-refresh').addEventListener('click', () => {
  const st = state.wa.status;
  $('#qr-mask').classList.remove('hidden');
  if (st === 'ready') {
    $('#qr-img').classList.add('hidden');
    $('#qr-msg').textContent = 'WhatsApp ya está conectado. Si la conexión falla seguido, usa "Reiniciar sesión" para escanear un QR nuevo.';
  } else if (st === 'qr' || st === 'connecting') {
    showQr();
  } else {
    $('#qr-img').classList.add('hidden');
    $('#qr-msg').textContent = 'Generando un QR nuevo…';
    connectWa();
  }
});
$('#btn-qr-reset').addEventListener('click', async () => {
  $('#qr-img').classList.add('hidden');
  $('#qr-msg').textContent = 'Borrando la sesión anterior y generando un QR nuevo…';
  await window.api.wa.resetSession();
  showQr();
});
$('#btn-qr-disconnect').addEventListener('click', async () => {
  await window.api.wa.disconnect();
  $('#qr-img').classList.add('hidden');
  $('#qr-msg').textContent = 'WhatsApp desconectado. Pulsa "Mostrar QR" para volver a conectar.';
});

$('#btn-wa-top').addEventListener('click', () => {
  const st = state.wa.status;
  if (st === 'ready') {
    $('#qr-img').classList.add('hidden');
    $('#qr-msg').textContent = 'WhatsApp conectado.';
    $('#qr-mask').classList.remove('hidden');
  } else if (st === 'qr' || st === 'connecting') {
    showQr();
  } else {
    connectWa();
  }
});

$('#btn-hist-close').addEventListener('click', closeHistorial);
$('#hist-mask').addEventListener('click', (ev) => { if (ev.target === $('#hist-mask')) closeHistorial(); });

$$('.tab').forEach((t) => t.addEventListener('click', () => activarTab(t.dataset.tab)));

$('#modal-body').addEventListener('change', (ev) => {
  if (ev.target && ev.target.id === 'f-rp-client') {
    onRpClientChange();
    const c = state.clients.find((x) => x.id === Number(ev.target.value));
    fillGrupoSelect((c && c.grupo_id) || '', (c && c.grupo_nombre) || '');
  }
});
$('#modal-body').addEventListener('input', (ev) => {
  if (ev.target && ev.target.id === 'f-rp-grupo-input') renderGrupoList(ev.target.value);
});
$('#modal-body').addEventListener('focusin', (ev) => {
  if (ev.target && ev.target.id === 'f-rp-grupo-input') openGrupoList();
});
$('#modal-body').addEventListener('focusout', (ev) => {
  if (ev.target && ev.target.id === 'f-rp-grupo-input') setTimeout(closeGrupoList, 200);
});
$('#modal-body').addEventListener('click', (ev) => {
  const opt = ev.target.closest('.g-opt');
  if (opt) { ev.stopPropagation(); selectGrupo(opt.dataset.gid, opt.dataset.gname); return; }
  if (ev.target.closest('#btn-grupo-clear')) { ev.stopPropagation(); clearGrupoSel(); return; }
  const del = ev.target.closest('.foto-del');
  if (del) { ev.stopPropagation(); quitarFoto(del.dataset.kind, Number(del.dataset.i)); return; }
  if (ev.target.closest('#btn-add-fotos')) pickFotos();
});

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = Number(btn.dataset.id);
  if (action === 'edit-client') editClient(id);
  else if (action === 'del-client') delClient(id);
  else if (action === 'reps-cliente') goReportes('', id, '');
  else if (action === 'edit-equipo') editEquipo(id);
  else if (action === 'del-equipo') delEquipo(id);
  else if (action === 'eq-ver-cliente') { verEquiposCliente(id); activarTab('equipos'); }
  else if (action === 'reps-equipo') goReportes('', '', id);
  else if (action === 'send-reporte') sendReporte(id, btn);
  else if (action === 'edit-reporte') editReporte(id);
  else if (action === 'del-reporte') delReporte(id);
  else if (action === 'edit-tecnico') editTecnico(id);
  else if (action === 'del-tecnico') delTecnico(id);
  else if (action === 'hist-reporte') verHistorial(id);
  else if (action === 'nota-reporte') agregarNota(id);
  else if (action === 'resumen-xlsx') descargarResumenXlsx();
  else if (action === 'recordatorio-run') probarRecordatorios();
  else if (action === 'sync-run') sincronizarAhora();
  else if (action === 'share-reporte') compartirReporte(id);
  else if (action === 'pdf-reporte') exportarReportePDF(id);
  else if (action === 'wa-pdf-reporte') enviarReportePDF(id);
  else if (action === 'archivar-reporte') archivarReporte(id);
  else if (action === 'restaurar-reporte') restaurarReporte(id);
  else if (action === 'ver-fotos') verFotos(id);
  else if (action === 'ms-reporte') nuevoReporteDesdeMensaje(id);
  else if (action === 'ms-borrar') borrarMensaje(id);
  else if (action === 'ms-abrir-media') { const f = btn.dataset.file; if (f) window.api.wa.mensajesAbrirMedia(f); }
  else if (action === 'backup') hacerBackupManual();
});

document.addEventListener('change', (ev) => {
  const sel = ev.target;
  if (sel && sel.dataset && sel.dataset.action === 'estado') setEstado(Number(sel.dataset.id), sel.value);
  else if (sel && sel.dataset && sel.dataset.action === 'tecnico') setTecnico(Number(sel.dataset.id), Number(sel.value) || null);
  else if (sel && sel.classList && sel.classList.contains('sync-tec-on')) {
    const pass = document.querySelector('.sync-tec-pass[data-id="' + sel.dataset.id + '"]');
    if (pass) pass.disabled = !sel.checked;
  }
});

window.api.wa.onStatus((s) => {
  applyWa(s);
  fillGrupoSelect(null);
});
window.api.wa.onChanged(() => refreshAll());
window.api.sync.onChanged(() => refreshAll());
window.api.wa.onNuevoMensaje((m) => {
  state.mensajes = [m].concat(state.mensajes.filter((x) => x.id !== m.id));
  if (state.tab !== 'mensajes') { updateMensajesBadge(); return; }
  renderConversaciones();
  if (state.convId && m.jid === state.convId) {
    if (!m.fromMe && m.tipo !== 'out') {
      m.leido = 1;
      window.api.wa.mensajesLeer([m.id]);
    }
    renderChat();
  }
});
window.api.wa.onGoPendientes(() => goReportes('pendientes'));
window.api.wa.onMensajesUpdate(() => {
  if (state.tab !== 'mensajes') return;
  refreshMensajes();
});
window.api.wa.onGoMensajes(() => {
  activarTab('mensajes');
  refreshMensajes();
});

async function init() {
  try {
    const v = await window.api.app.getVersion();
    if (v) $('#app-version').textContent = 'v' + v;
  } catch (e) { /* noop */ }
  await loadLicense();
  await refreshAll();
  const s = await window.api.wa.status();
  applyWa(s.data);
  refreshMensajes();
}

window.api.app.onUpdateAvailable((info) => {
  const bar = $('#update-bar');
  const txt = $('#update-text');
  txt.textContent = 'Descargando actualización v' + info.version + '...';
  bar.classList.remove('hidden');
  $('#btn-update-install').style.display = 'none';
});
window.api.app.onUpdateProgress((info) => {
  const txt = $('#update-text');
  txt.textContent = 'Descargando actualización... ' + info.percent + '%';
});
window.api.app.onUpdateDownloaded((info) => {
  const txt = $('#update-text');
  const btn = $('#btn-update-install');
  txt.textContent = 'Actualización v' + info.version + ' lista para instalar.';
  btn.style.display = '';
  btn.onclick = () => window.api.app.installUpdate();
});

init();
