'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let settings = { plan_prices: { micro: 2500, pyme: 5000, empresa: 9000, firma: 15000 }, moneda: 'RD$', negocio: '' };
const DEFAULT_NEGOCIO = 'Nexus Software RD';
const negocioName = () => settings.negocio || DEFAULT_NEGOCIO;
let clients = [];
let editingId = null;
let servicios = [];

function renderServicios() {
  $('servicios-list').innerHTML = servicios.length
    ? servicios.map((s, i) => `
      <div class="sv-row" data-i="${i}">
        <input class="sv-nombre" value="${esc(s.nombre)}" placeholder="Programa / servicio" />
        <input class="sv-cuota" type="number" min="0" step="100" value="${s.cuota || ''}" placeholder="Cuota RD$" />
        <button class="pay-del" data-svdel="${i}" title="Quitar programa">✕</button>
      </div>`).join('')
    : '<p class="muted small">Sin programas agregados.</p>';
  updateCuotaTotal();
}

function updateCuotaTotal() {
  const total = servicios.reduce((s, x) => s + (Number(x.cuota) || 0), 0);
  $('f-cuota').value = total || '';
}

function addServicio(nombre, cuota) {
  const n = String(nombre || '').trim();
  if (!n) return;
  servicios.push({ nombre: n, cuota: Number(cuota) || 0 });
  renderServicios();
}

function toast(msg, type) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (type === 'error' ? ' error' : '');
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 3500);
}

function money(n) {
  return settings.moneda + ' ' + Number(n || 0).toLocaleString('es-DO');
}

function planLabel(p) {
  return { micro: 'Micro', pyme: 'Pyme', empresa: 'Empresa', firma: 'Firma' }[p] || p;
}

function badgeCls(v) {
  return { micro: 'micro', pyme: 'pyme', empresa: 'empresa', firma: 'firma', activo: 'activo', prospecto: 'prospecto', cortado: 'cortado', prueba: 'prueba', vencida: 'vencida' }[v] || '';
}

function estadoBadge(c) {
  if (c.estado === 'prueba') {
    return c.trial_expired
      ? '<span class="badge vencida">Prueba vencida</span>'
      : `<span class="badge prueba">Prueba · ${c.trial_days_left} d&iacute;a(s)</span>`;
  }
  return `<span class="badge ${badgeCls(c.estado)}">${esc(c.estado)}</span>`;
}

function addDays(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

async function loadSummary() {
  try {
    const month = $('s-month').value || new Date().toISOString().slice(0, 7);
    const res = await window.api.summaryGet(month);
    if (!res.ok) throw new Error(res.error);
    const d = res.data;
    $('s-income-month').textContent = money(d.incomeMonth);
    $('s-income-year').textContent = money(d.incomeYear);
    $('s-active').textContent = d.activos + ' / ' + d.totalClientes;
    $('s-employees').textContent = d.totalEmpleados.toLocaleString('es-DO');
    $('s-projection').textContent = money(d.proyeccionAnual);
    const box = $('due-box');
    if (d.porCobrar.length) {
      box.hidden = false;
      $('due-list').innerHTML = d.porCobrar.map((c) => `
        <div class="due-item">
          <span>${esc(c.nombre)}</span>
          <span>${money(c.cuota)} <span class="muted">· último pago ${esc(c.ultimo_pago)}</span></span>
          <button class="btn btn-primary btn-sm" data-due="${c.id}">Cobrar</button>
        </div>`).join('');
      box.querySelectorAll('[data-due]').forEach((b) => b.addEventListener('click', () => {
        const c = clients.find((x) => x.id === Number(b.dataset.due));
        if (c) openPaymentModal({ id: c.id, nombre: c.nombre, cuota: c.cuota });
      }));
    } else {
      box.hidden = true;
    }
    const tbox = $('trial-box');
    if ((d.pruebasVencidas || []).length) {
      tbox.hidden = false;
      $('trial-list').innerHTML = d.pruebasVencidas.map((c) => `
        <div class="due-item">
          <span>${esc(c.nombre)} <span class="muted small">· prueba terminó el ${esc(c.trial_fin)}</span></span>
          <span class="trial-actions">
            <button class="btn btn-primary btn-sm" data-activate="${c.id}">✅ Activar</button>
            <button class="btn btn-ghost btn-sm" data-cut="${c.id}">✂️ Cortar</button>
          </span>
        </div>`).join('');
      tbox.querySelectorAll('[data-activate]').forEach((b) => b.addEventListener('click', async () => {
        await window.api.clientsState(Number(b.dataset.activate), 'activo');
        toast('Cliente activado', 'success');
        loadClients();
        loadSummary();
        openClientModal(Number(b.dataset.activate));
      }));
      tbox.querySelectorAll('[data-cut]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('¿Marcar este cliente como cortado?')) return;
        await window.api.clientsState(Number(b.dataset.cut), 'cortado');
        toast('Cliente cortado');
        loadClients();
        loadSummary();
      }));
    } else {
      tbox.hidden = true;
    }
  } catch (e) { toast(e.message, 'error'); }
}

async function loadClients() {
  try {
    const month = $('s-month').value || new Date().toISOString().slice(0, 7);
    const res = await window.api.clientsList(month);
    if (!res.ok) throw new Error(res.error);
    clients = res.data || [];
    renderClients();
  } catch (e) { toast(e.message, 'error'); }
}

function renderClients() {
  const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const q = norm($('search').value);
  const hay = (s) => norm(s).includes(q);
  const rows = q
    ? clients.filter((c) => hay(c.nombre) || hay(c.rnc) || hay(c.contacto) || hay(c.telefono) || hay(c.email) || hay(c.direccion) || hay(c.licencia) || hay(c.plan) || hay(c.estado) || hay(c.notas) || hay((c.servicios || []).map((s) => s.nombre).join(' ')))
    : clients;
  const cnt = $('search-count');
  if (cnt) cnt.textContent = q ? rows.length + ' de ' + clients.length + ' resultados' : clients.length + ' cliente' + (clients.length === 1 ? '' : 's');
  $('client-list').innerHTML = rows.length
    ? '<div class="client-row" style="cursor:default; font-weight:600; color:#64748b; font-size:12px; text-transform:uppercase"><span>Empresa</span><span>Plan</span><span>Cuota</span><span>Empleados</span><span>Pago del mes</span><span>Estado</span><span>Deuda</span></div>'
    + rows.map((c) => `
      <div class="client-row" data-id="${c.id}">
        <span><span class="name">${esc(c.nombre)}</span>${(c.servicios && c.servicios.length) ? '<br /><span class="muted small">' + c.servicios.map((s) => esc(s.nombre)).join(' · ') + '</span>' : ''}<br /><span class="muted small">${esc(c.contacto || '')}${c.telefono ? ' · ' + esc(c.telefono) : ''}</span></span>
        <span><span class="badge ${badgeCls(c.plan)}">${planLabel(c.plan)}</span></span>
        <span>${money(c.cuota)}</span>
        <span>${Number(c.empleados || 0).toLocaleString('es-DO')}</span>
        <span><span class="badge ${c.pagado_mes ? 'activo' : 'pendiente'}">${c.pagado_mes ? 'Pagó ✓' : 'Pendiente'}</span>${!c.pagado_mes ? `<br /><button class="btn btn-primary btn-sm" data-pay="${c.id}" style="margin-top:4px">💵 Cobrar</button>` : ''}</span>
        <span>${estadoBadge(c)}</span>
        <span class="${c.deuda > 0 ? 'deuda' : 'pagado'}">${c.deuda > 0 ? money(c.deuda) : 'Al día'}</span>
      </div>`).join('')
    : q
      ? '<p class="muted">Sin resultados para la búsqueda.</p>'
      : '<p class="muted">No hay clientes. Presione "Nuevo cliente" para empezar.</p>';
  document.querySelectorAll('.client-row[data-id]').forEach((r) => r.addEventListener('click', () => openClientModal(Number(r.dataset.id))));
  document.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const c = clients.find((x) => x.id === Number(b.dataset.pay));
    if (c) openPaymentModal({ id: c.id, nombre: c.nombre, cuota: c.cuota });
  }));
}

function fillForm(c) {
  $('f-nombre').value = c.nombre || '';
  $('f-rnc').value = c.rnc || '';
  $('f-contacto').value = c.contacto || '';
  $('f-telefono').value = c.telefono || '';
  $('f-email').value = c.email || '';
  $('f-direccion').value = c.direccion || '';
  $('f-plan').value = c.plan || 'pyme';
  $('f-cuota').value = c.cuota || '';
  $('f-instalacion').value = c.costo_instalacion || '';
  $('f-empleados').value = c.empleados || 0;
  $('f-inicio').value = c.inicio || '';
  $('f-estado').value = c.estado || 'activo';
  $('f-trial-fin').value = c.trial_fin || '';
  $('f-licencia').value = c.licencia || '';
  $('f-notas').value = c.notas || '';
  servicios = (c.servicios || []).map((s) => ({ nombre: s.nombre, cuota: s.cuota }));
  renderServicios();
}

async function openClientModal(id) {
  editingId = id || null;
  $('client-modal-title').textContent = id ? 'Editar cliente' : 'Nuevo cliente';
  $('btn-client-delete').classList.toggle('hidden', !id);
  const box = $('payments-box');
  if (id) {
    const res = await window.api.clientsGet(id);
    if (!res.ok) { toast(res.error, 'error'); return; }
    const c = res.data;
    fillForm(c);
    const mes = new Date().toISOString().slice(0, 7);
    const estadoMes = `<div class="pay-summary">Pago del mes actual (${mes}): <b class="${c.pagado_mes ? 'pagado' : 'deuda'}">${c.pagado_mes ? 'Pagó ✓' : 'Pendiente'}</b></div>`;
    const inst = c.costo_instalacion > 0
      ? `<div class="pay-summary">Instalación (única): <b>${money(c.costo_instalacion)}</b> · ${c.instalacion_pagada ? '<b class="pagado">Pagada ✓</b>' : `<b class="deuda">Pendiente (${money(c.instalacion_deuda)})</b>`}</div>`
      : '';
    const due = c.deuda > 0 ? `<div class="pay-summary">Deuda estimada: <b class="deuda">${money(c.deuda)}</b> · Total cobrado: <b>${money(c.total_pagos)}</b></div>` : `<div class="pay-summary">Al día · Total cobrado: <b>${money(c.total_pagos)}</b></div>`;
    $('pay-summary').innerHTML = estadoMes + inst + due;
    $('pay-list').innerHTML = c.payments.length
      ? c.payments.map((p) => `
        <div class="pay-row">
          <span><b>${esc(p.fecha)}</b> · ${money(p.monto)}${p.tipo === 'instalacion' ? ' · <span class="badge instalacion">Instalación</span>' : ''} · ${esc(p.metodo || '—')}${p.meses > 1 ? ' · ' + p.meses + ' meses' : ''}</span>
          <button class="pay-del" data-paydel="${p.id}" title="Eliminar pago">✕</button>
        </div>`).join('')
      : '<p class="muted">Sin pagos registrados.</p>';
    box.querySelectorAll('[data-paydel]').forEach((b) => b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!confirm('¿Eliminar este pago?')) return;
      await window.api.paymentsDelete(Number(b.dataset.paydel));
      openClientModal(id);
    }));
    box.hidden = false;
    currentPayClient = { id: c.id, nombre: c.nombre, cuota: c.cuota };
    const instBtn = $('btn-add-instalacion');
    instBtn.classList.toggle('hidden', !(c.costo_instalacion > 0 && c.instalacion_deuda > 0));
    instBtn.dataset.id = c.id;
  } else {
    fillForm({});
    box.hidden = true;
    currentPayClient = null;
  }
  $('client-modal').hidden = false;
}

let currentPayClient = null;

async function saveClient() {
  const data = {
    id: editingId,
    nombre: $('f-nombre').value.trim(),
    rnc: $('f-rnc').value.trim(),
    contacto: $('f-contacto').value.trim(),
    telefono: $('f-telefono').value.trim(),
    email: $('f-email').value.trim(),
    direccion: $('f-direccion').value.trim(),
    plan: $('f-plan').value,
    cuota: Number($('f-cuota').value) || 0,
    costo_instalacion: Number($('f-instalacion').value) || 0,
    empleados: Number($('f-empleados').value) || 0,
    inicio: $('f-inicio').value,
    estado: $('f-estado').value,
    trial_fin: $('f-estado').value === 'prueba' ? ($('f-trial-fin').value || addDays(15)) : '',
    licencia: $('f-licencia').value.trim(),
    notas: $('f-notas').value,
    servicios: servicios.map((s) => ({ nombre: String(s.nombre || '').trim(), cuota: Number(s.cuota) || 0 }))
  };
  const res = await window.api.clientsSave(data);
  if (!res.ok) { toast(res.error, 'error'); return; }
  toast(editingId ? 'Cliente actualizado' : 'Cliente agregado', 'success');
  $('client-modal').hidden = true;
  loadClients();
  loadSummary();
}

async function deleteClient() {
  if (!editingId) return;
  if (!confirm('¿Eliminar este cliente y todos sus pagos? Esta acción no se puede deshacer.')) return;
  await window.api.clientsDelete(editingId);
  $('client-modal').hidden = true;
  toast('Cliente eliminado');
  loadClients();
  loadSummary();
}

function openPaymentModal(opts) {
  if (!opts || !opts.id) return;
  currentPayClient = { id: opts.id, nombre: opts.nombre };
  $('pay-client-name').textContent = opts.nombre;
  $('p-fecha').value = new Date().toISOString().slice(0, 10);
  $('p-monto').value = opts.instalacion ? (opts.monto || '') : (opts.cuota || '');
  $('p-tipo').value = opts.instalacion ? 'instalacion' : 'mensual';
  $('p-metodo').value = 'transferencia';
  $('p-meses').value = 1;
  $('p-notas').value = '';
  $('payment-modal').hidden = false;
}

async function savePayment() {
  const res = await window.api.paymentsAdd({
    client_id: currentPayClient.id,
    fecha: $('p-fecha').value,
    monto: Number($('p-monto').value) || 0,
    tipo: $('p-tipo').value,
    metodo: $('p-metodo').value,
    meses: Number($('p-meses').value) || 1,
    notas: $('p-notas').value
  });
  if (!res.ok) { toast(res.error, 'error'); return; }
  $('payment-modal').hidden = true;
  toast('Pago registrado', 'success');
  openClientModal(currentPayClient.id);
  loadClients();
  loadSummary();
}

async function loadSettings() {
  const res = await window.api.settingsGet();
  if (!res.ok) return;
  settings = res.data;
  $('cfg-negocio').value = res.data.negocio || DEFAULT_NEGOCIO;
  $('cfg-moneda').value = res.data.moneda || 'RD$';
  $('cfg-micro').value = res.data.plan_prices.micro;
  $('cfg-pyme').value = res.data.plan_prices.pyme;
  $('cfg-empresa').value = res.data.plan_prices.empresa;
  $('cfg-firma').value = res.data.plan_prices.firma;
  $('topbar-negocio').textContent = negocioName() + ' · control de clientes';
  document.title = negocioName() + ' · NEXUS';
}

async function rncSearchRun() {
  const q = $('rnc-q').value.trim();
  if (q.length < 3) { toast('Escribe al menos 3 letras o un RNC', 'error'); return; }
  const box = $('rnc-results');
  box.innerHTML = '<p class="muted">Buscando en el RNC…</p>';
  const res = await window.api.rncSearch(q);
  if (!res.ok) { box.innerHTML = '<p class="deuda">' + esc(res.error) + '</p>'; return; }
  if (!res.data.length) { box.innerHTML = '<p class="muted">Sin resultados para "' + esc(q) + '".</p>'; return; }
  box.innerHTML = res.data.map((it, i) => `
    <div class="rnc-item">
      <div class="rnc-info">
        <b>${esc(it.razon_social)}</b><br />
        <span class="muted small">RNC ${esc(it.rnc)}</span>
        ${it.actividad_economica ? '<br /><span class="muted small">' + esc(it.actividad_economica) + '</span>' : ''}
        <br /><span class="badge ${it.estado === 'ACTIVO' ? 'activo' : 'pendiente'}">${esc(it.estado)}</span>
      </div>
      <button class="btn btn-primary btn-sm" data-addrnc="${i}">➕ Prospecto</button>
    </div>`).join('');
  box.querySelectorAll('[data-addrnc]').forEach((b) => b.addEventListener('click', async () => {
    const item = res.data[Number(b.dataset.addrnc)];
    $('rnc-modal').hidden = true;
    await openClientModal(null);
    fillForm({ nombre: item.razon_social, rnc: item.rnc, estado: 'prospecto' });
    $('f-estado').value = 'prospecto';
    $('client-modal-title').textContent = 'Nuevo prospecto';
  }));
}

async function saveSettings() {
  try {
    const res = await window.api.settingsSave({
      negocio: $('cfg-negocio').value.trim(),
      moneda: $('cfg-moneda').value.trim() || 'RD$',
      plan_prices: {
        micro: Number($('cfg-micro').value) || 0,
        pyme: Number($('cfg-pyme').value) || 0,
        empresa: Number($('cfg-empresa').value) || 0,
        firma: Number($('cfg-firma').value) || 0
      }
    });
    if (!res.ok) throw new Error(res.error || 'No se pudo guardar la configuración');
    $('config-modal').hidden = true;
    toast('Configuración guardada', 'success');
    await loadSettings();
    loadClients();
    loadSummary();
  } catch (e) { toast(e.message, 'error'); }
}

async function exportExcel(which) {
  try {
    const res = await window.api.exportExcel(which);
    if (!res.ok) throw new Error(res.error);
    if (res.file) toast('Exportado a Excel: ' + res.file);
  } catch (e) { toast(e.message, 'error'); }
}

function wire() {
  $('btn-add-client').addEventListener('click', () => openClientModal(null));
  $('btn-rnc').addEventListener('click', () => { $('rnc-modal').hidden = false; setTimeout(() => $('rnc-q').focus(), 50); });
  $('rnc-search').addEventListener('click', rncSearchRun);
  $('rnc-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') rncSearchRun(); });
  $('rnc-cancel').addEventListener('click', () => { $('rnc-modal').hidden = true; });
  $('btn-client-cancel').addEventListener('click', () => { $('client-modal').hidden = true; });
  $('btn-client-save').addEventListener('click', saveClient);
  $('btn-client-delete').addEventListener('click', deleteClient);
  $('btn-pay-cancel').addEventListener('click', () => { $('payment-modal').hidden = true; });
  $('btn-pay-save').addEventListener('click', savePayment);
  $('btn-add-payment').addEventListener('click', () => openPaymentModal(currentPayClient));
  $('btn-add-instalacion').addEventListener('click', () => {
    const id = Number($('btn-add-instalacion').dataset.id);
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    openPaymentModal({ id: c.id, nombre: c.nombre, instalacion: true, monto: c.instalacion_deuda });
  });
  $('btn-settings').addEventListener('click', async () => { await loadSettings(); $('config-modal').hidden = false; });
  $('btn-cfg-cancel').addEventListener('click', () => { $('config-modal').hidden = true; });
  $('btn-cfg-save').addEventListener('click', saveSettings);
  $('btn-export-csv').addEventListener('click', () => exportExcel('clients'));
  $('btn-export-payments').addEventListener('click', () => exportExcel('payments'));
  $('s-month').value = new Date().toISOString().slice(0, 7);
  $('s-month').addEventListener('change', () => { loadSummary(); loadClients(); });
  $('search').addEventListener('input', renderClients);
  $('search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = document.querySelector('.client-row[data-id]');
      if (first) openClientModal(Number(first.dataset.id));
    }
  });
  ['client-modal', 'payment-modal', 'config-modal', 'rnc-modal'].forEach((id) => {
    $(id).addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.hidden = true; });
  });
  $('f-plan').addEventListener('change', () => {
    const p = settings.plan_prices[$('f-plan').value];
    if (p) $('f-cuota').value = p;
  });
  $('f-estado').addEventListener('change', () => {
    if ($('f-estado').value === 'prueba' && !$('f-trial-fin').value) $('f-trial-fin').value = addDays(15);
  });
  $('btn-sv-add').addEventListener('click', () => {
    addServicio($('sv-nombre').value, $('sv-cuota').value);
    $('sv-nombre').value = '';
    $('sv-cuota').value = '';
    $('sv-nombre').focus();
  });
  $('sv-nombre').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-sv-add').click(); });
  document.querySelectorAll('.serv-quick button[data-sv]').forEach((b) => b.addEventListener('click', () => addServicio(b.dataset.sv, b.dataset.svCuota)));
  $('servicios-list').addEventListener('input', (ev) => {
    const row = ev.target.closest('.sv-row');
    if (!row) return;
    const i = Number(row.dataset.i);
    const s = servicios[i];
    if (!s) return;
    if (ev.target.classList.contains('sv-nombre')) s.nombre = ev.target.value;
    if (ev.target.classList.contains('sv-cuota')) s.cuota = Number(ev.target.value) || 0;
    updateCuotaTotal();
  });
  $('servicios-list').addEventListener('click', (ev) => {
    const del = ev.target.closest('[data-svdel]');
    if (!del) return;
    servicios.splice(Number(del.dataset.svdel), 1);
    renderServicios();
  });
}

(async function init() {
  await loadSettings();
  wire();
  await Promise.all([loadClients(), loadSummary()]);
})();
