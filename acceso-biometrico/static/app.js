const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const state = {
  tab: 'cam',
  video: null,
  stream: null,
  raf: false,
  detectando: false,
  ultimo: null,       // {persona, confianza, box}
  enEspera: false,    // cooldown local tras evento
  personas: [],
  evCache: [],
  camLista: false,
};

/* ---------------- Tabs ---------------- */
function activarTab(name) {
  state.tab = name;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'personas') renderPersonas();
  if (name === 'eventos') cargarDashboard();
}

/* ---------------- API ---------------- */
async function api(path, opts) {
  const r = await fetch(path, opts);
  return r.json();
}

/* ---------------- Cámara ---------------- */
async function iniciarCamara() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
    });
    state.video = $('#video');
    state.video.srcObject = state.stream;
    await state.video.play();
    state.camLista = true;
    $('#cam-off').classList.add('hidden');
    $('#video').classList.remove('hidden');
    const ov = $('#overlay');
    ov.width = state.video.videoWidth || 640;
    ov.height = state.video.videoHeight || 480;
    setInterval(bucleDeteccion, 500);
  } catch (e) {
    state.camLista = false;
    $('#cam-off').classList.remove('hidden');
    $('#video').classList.add('hidden');
  }
}

function dibujarVideo() {
  const ov = $('#overlay');
  const ctx = ov.getContext('2d');
  ctx.drawImage(state.video, 0, 0, ov.width, ov.height);
  const u = state.ultimo;
  if (u && u.box) {
    const [x, y, w, h] = u.box;
    const ok = !!u.persona;
    ctx.strokeStyle = ok ? '#16a34a' : '#dc2626';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = ok ? '#16a34a' : '#dc2626';
    ctx.font = '600 15px Segoe UI, Arial';
    const label = ok ? (u.persona.nombre + ' ' + (u.persona.apellido || '')).trim() + ' ' + Math.round(u.confianza * 100) + '%' : 'Desconocido';
    const tw = ctx.measureText(label).width + 14;
    ctx.fillRect(x, y - 24, tw, 22);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 7, y - 8);
  }
}

async function bucleDeteccion() {
  if (!state.camLista || state.detectando) return;
  if (state.video.readyState < 2) return;
  state.detectando = true;
  try {
    const ov = $('#overlay');
    const ctx = ov.getContext('2d');
    ctx.drawImage(state.video, 0, 0, ov.width, ov.height);
    const blob = await new Promise((res) => ov.toBlob(res, 'image/jpeg', 0.8));
    if (!blob) return;
    const fd = new FormData();
    fd.append('imagen', blob, 'frame.jpg');
    const j = await api('/api/detectar', { method: 'POST', body: fd });
    if (j.ok) {
      const main = j.rostros && j.rostros[0];
      state.ultimo = main ? { persona: main.persona, confianza: main.confianza, box: main.box } : null;
      dibujarFrame();
      actualizarEstado();
    }
  } catch (e) { /* reintenta */ }
  finally { state.detectando = false; }
}

function dibujarFrame() {
  const ov = $('#overlay');
  const ctx = ov.getContext('2d');
  if (state.camLista && state.video.readyState >= 2) {
    ctx.drawImage(state.video, 0, 0, ov.width, ov.height);
  }
  const u = state.ultimo;
  if (u && u.box) {
    const [x, y, w, h] = u.box;
    const ok = !!u.persona;
    ctx.strokeStyle = ok ? '#16a34a' : '#dc2626';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = ok ? '#16a34a' : '#dc2626';
    ctx.font = '600 15px Segoe UI, Arial';
    const label = ok ? (u.persona.nombre + ' ' + (u.persona.apellido || '')).trim() + ' · ' + Math.round(u.confianza * 100) + '%' : 'Desconocido';
    const tw = ctx.measureText(label).width + 14;
    ctx.fillRect(x, y - 24, tw, 22);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 7, y - 8);
  }
}

function actualizarEstado() {
  const u = state.ultimo;
  const nom = $('#st-nombre');
  const det = $('#st-detalle');
  const alerta = $('#st-alerta');
  const btn = $('#btn-registrar');
  const cooldownNote = $('#cooldown-note');
  if (u && u.persona) {
    nom.textContent = (u.persona.nombre + ' ' + (u.persona.apellido || '')).trim();
    nom.className = 'st-nombre ok';
    det.textContent = 'Cédula: ' + (u.persona.cedula || '—') + ' · Rol: ' + (u.persona.rol || 'empleado') + ' · Confianza: ' + Math.round(u.confianza * 100) + '%';
    alerta.classList.add('hidden');
    const tipo = proximoTipo(u.persona.id);
    btn.textContent = (tipo === 'salida' ? '🚪 Registrar Salida' : '✅ Registrar Entrada');
    btn.disabled = false;
    if ($('#chk-auto').checked) {
      registrarEvento(u.persona, u.confianza, tipo);
    }
    cooldownNote.textContent = state.enEspera ? '⏳ Registrando…' : '';
  } else if (u) {
    nom.textContent = 'Desconocido';
    nom.className = 'st-nombre danger';
    det.textContent = 'Rostro no registrado en la base.';
    alerta.classList.remove('hidden');
    alerta.textContent = '⚠️ Persona no reconocida. Verifica identidad antes de permitir acceso.';
    btn.disabled = true;
    btn.textContent = 'Registrar Entrada / Salida';
  } else {
    nom.textContent = 'Esperando rostro…';
    nom.className = 'st-nombre muted';
    det.textContent = '';
    alerta.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Registrar Entrada / Salida';
  }
}

/* ---------------- Eventos ---------------- */
function proximoTipo(personaId) {
  const ult = state.evCache.find((e) => e.persona_id === personaId);
  return ult && ult.tipo === 'entrada' ? 'salida' : 'entrada';
}

async function registrarEvento(persona, confianza, tipo) {
  if (state.enEspera) return;
  state.enEspera = true;
  $('#btn-registrar').disabled = true;
  $('#cooldown-note').textContent = '⏳ Registrando…';
  const r = await api('/api/eventos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ persona_id: persona.id, tipo, confianza: confianza || 0, metodo: 'rostro' }),
  });
  const d = r.data || {};
  if (d.cooldown) {
    $('#cooldown-note').textContent = '⏳ Espera ' + d.segundos + ' s para registrar otra vez';
  } else if (d.evento) {
    const e = d.evento;
    $('#cooldown-note').textContent = '✔ ' + (e.tipo === 'entrada' ? 'Entrada' : 'Salida') + ' registrada: ' + e.creado;
    state.evCache.unshift({ persona_id: e.persona_id, tipo: e.tipo });
    if (state.tab === 'eventos') cargarDashboard();
  } else {
    $('#cooldown-note').textContent = 'Registro enviado.';
  }
  setTimeout(() => { state.enEspera = false; actualizarEstado(); }, 2500);
}

/* ---------------- Personas ---------------- */
async function cargarPersonas() {
  const j = await api('/api/personas');
  if (j.ok) state.personas = j.data;
}

function renderPersonas() {
  const q = ($('#p-search').value || '').trim().toLowerCase();
  const rows = state.personas.filter((p) => !q || (p.nombre + ' ' + (p.apellido || '') + ' ' + (p.cedula || '')).toLowerCase().includes(q));
  $('#p-count').textContent = rows.length + ' persona(s)';
  $('#p-list').innerHTML = rows.map((p) => `
    <div class="p-card">
      <div style="display:flex;gap:12px;align-items:center">
        ${p.foto
          ? `<img class="p-photo" src="/api/foto/${p.id}" alt="">`
          : `<div class="p-photo no">👤</div>`}
        <div>
          <div class="p-name">${esc(p.nombre + ' ' + (p.apellido || '')).trim()}</div>
          <div class="p-meta">${p.cedula ? '🪪 ' + esc(p.cedula) : ''}</div>
        </div>
      </div>
      <span class="p-rol">${esc(p.rol || 'empleado')}</span>
      <div class="p-actions">
        <button class="btn danger-text" data-del="${p.id}">🗑️ Eliminar</button>
      </div>
    </div>`).join('') || '<div class="empty">Sin personas registradas.</div>';
  $$('#p-list [data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta persona?')) return;
    await api('/api/personas/' + b.dataset.del, { method: 'DELETE' });
    await cargarPersonas();
    renderPersonas();
  }));
}

/* ---------------- Dashboard ---------------- */
async function cargarDashboard() {
  const j = await api('/api/dashboard');
  if (!j.ok) return;
  const d = j.data;
  $('#d-dentro').textContent = d.dentro.length;
  $('#d-entradas').textContent = d.hoy_entradas;
  $('#d-salidas').textContent = d.hoy_salidas;
  $('#d-alertas').textContent = d.alertas;
  $('#dentro-list').innerHTML = d.dentro.length
    ? d.dentro.map((p) => `<span class="dentro-chip">🟢 ${esc(p.nombre + ' ' + (p.apellido || '')).trim()} <small>· desde ${esc((p.desde || '').slice(11, 16))}</small></span>`).join('')
    : '<span class="hint">Nadie dentro ahora.</span>';
  $('#ev-list').innerHTML = d.ultimos.map((e) => `
    <div class="ev-row">
      <span class="hora">${esc((e.creado || '').slice(0, 16))}</span>
      <span class="tipo ${esc(e.tipo)}">${e.tipo === 'entrada' ? '✅ Entrada' : e.tipo === 'salida' ? '🚪 Salida' : '⚠️ Alerta'}</span>
      <span>${esc(e.persona_nombre || 'Desconocido')}</span>
      <span class="hint">${esc(e.metodo || '')}${e.confianza ? ' · ' + Math.round(e.confianza * 100) + '%' : ''}</span>
    </div>`).join('') || '<div class="ev-empty">Sin eventos todavía.</div>';
  state.evCache = (j.data.ultimos || []).map((e) => ({ persona_id: e.persona_id, tipo: e.tipo }));
}

/* ---------------- Foto (servir) ---------------- */
function fotoPersona(id) {
  return '/api/foto/' + id;
}

/* ---------------- Modal nueva persona ---------------- */
let capturaNueva = null;

function abrirModalNueva() {
  $('#f-nombre').value = '';
  $('#f-apellido').value = '';
  $('#f-cedula').value = '';
  $('#f-rol').value = 'empleado';
  $('#f-preview').classList.add('hidden');
  $('#f-foto-blob').value = '';
  capturaNueva = null;
  $('#modal-mask').classList.remove('hidden');
  $('#f-nombre').focus();
}

function capturarFotoModal() {
  const ov = $('#overlay');
  if (!state.camLista) return alert('La cámara no está disponible. Sube una foto.');
  ov.toBlob((blob) => {
    capturaNueva = blob;
    const pv = $('#f-preview');
    pv.src = URL.createObjectURL(blob);
    pv.classList.remove('hidden');
  }, 'image/jpeg', 0.92);
}

async function guardarPersona() {
  const nombre = $('#f-nombre').value.trim();
  if (!nombre) return alert('El nombre es obligatorio');
  let foto = null;
  if (capturaNueva) {
    foto = new File([capturaNueva], 'captura.jpg', { type: 'image/jpeg' });
  } else {
    const fi = $('#f-foto');
    if (!fi.files || !fi.files[0]) return alert('Captura o sube una foto del rostro');
    foto = fi.files[0];
  }
  const fd = new FormData();
  fd.append('nombre', nombre);
  fd.append('apellido', $('#f-apellido').value.trim());
  fd.append('cedula', $('#f-cedula').value.trim());
  fd.append('rol', $('#f-rol').value);
  fd.append('foto', foto);
  const btn = $('#btn-save');
  btn.disabled = true;
  btn.textContent = 'Registrando…';
  const r = await api('/api/personas', { method: 'POST', body: fd });
  btn.disabled = false;
  btn.textContent = 'Guardar';
  if (!r.ok) return alert(r.detail || 'No se pudo registrar');
  $('#modal-mask').classList.add('hidden');
  await cargarPersonas();
  renderPersonas();
  activarTab('cam');
}

/* ---------------- Util ---------------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ---------------- Init ---------------- */
async function init() {
  await cargarPersonas();
  await cargarDashboard();
  iniciarCamara();
  setInterval(() => { if (state.tab === 'eventos') cargarDashboard(); }, 5000);
}

$('#btn-registrar').addEventListener('click', () => {
  const u = state.ultimo;
  if (!u || !u.persona) return;
  registrarEvento(u.persona, u.confianza, proximoTipo(u.persona.id));
});
$('#btn-capturar').addEventListener('click', abrirModalNueva);
$('#btn-nueva').addEventListener('click', abrirModalNueva);
$('#btn-cancel').addEventListener('click', () => $('#modal-mask').classList.add('hidden'));
$('#btn-save').addEventListener('click', guardarPersona);
$('#btn-capture2').addEventListener('click', capturarFotoModal);
$('#f-foto').addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) {
    const pv = $('#f-preview');
    pv.src = URL.createObjectURL(e.target.files[0]);
    pv.classList.remove('hidden');
    capturaNueva = null;
  }
});
$('#p-search').addEventListener('input', renderPersonas);
$$('.tab').forEach((t) => t.addEventListener('click', () => activarTab(t.dataset.tab)));
$('#img-test').addEventListener('change', async (e) => {
  if (!e.target.files || !e.target.files[0]) return;
  const fd = new FormData();
  fd.append('imagen', e.target.files[0]);
  const j = await api('/api/detectar', { method: 'POST', body: fd });
  if (!j.ok) return alert('No se pudo analizar la imagen');
  if (j.encontrado) {
    alert('✔ Reconocido: ' + j.encontrado.persona.nombre + ' ' + (j.encontrado.persona.apellido || '') + ' (' + Math.round(j.encontrado.confianza * 100) + '%)');
  } else {
    alert(j.rostros.length ? '⚠️ No reconocido en la base de datos' : 'No se detectó ningún rostro en la foto');
  }
});

init();
