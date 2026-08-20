'use strict';
(function () {
  const TOKEN_KEY = 'nexalert_token';
  const USER_KEY = 'nexalert_user';
  const THEME_KEY = 'nexalert_theme';
  const ESTADO_LABEL = { abierto: 'Abierto', en_proceso: 'En proceso', resuelto: 'Resuelto', espera_repuesto: 'Espera repuesto', espera_cliente: 'Espera cliente' };
  const PRIO_LABEL = { baja: 'Baja', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };
  const EVENTO_LABEL = { estado: 'Cambio de estado', nota: 'Comentario', foto: 'Foto adjunta', foto_del: 'Foto eliminada', ubicacion: 'Ubicación registrada', creado: 'Reporte creado' };
  const NATIVO = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ========== TECLADO ========== */
  (function ajustarTeclado() {
    const html = document.documentElement;
    const body = document.body;
    const vv = 'visualViewport' in window ? window.visualViewport : null;
    let kbPx = 0;
    let locked = false;
    let lastH = -1;

    function esCaja(t) {
      if (!t) return false;
      const tag = t.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (tag === 'INPUT') {
        const tipo = (t.getAttribute('type') || 'text').toLowerCase();
        if (tipo === 'file' || tipo === 'checkbox' || tipo === 'radio' || tipo === 'button' || tipo === 'hidden') return false;
        return true;
      }
      return false;
    }

    function visibleHeight() {
      let h = vv ? Math.round(vv.height) : 0;
      if (h > 0) return h;
      h = window.innerHeight;
      if (kbPx > 0) h = Math.max(0, h - kbPx);
      return h;
    }

    function centrarCampo() {
      const el = document.activeElement;
      if (el && typeof el.scrollIntoView === 'function') {
        try { el.scrollIntoView({ block: 'nearest', behavior: 'auto' }); } catch (e) { el.scrollIntoView(); }
      }
    }

    function lock() {
      if (locked) return;
      const view = document.getElementById('view');
      const docTop = window.pageYOffset || 0;
      locked = true;
      body.classList.add('kb-abierto');
      html.style.overflow = 'hidden';
      body.style.overflow = 'hidden';
      const h = visibleHeight();
      if (h > 0) { html.style.height = h + 'px'; lastH = h; }
      if (view) view.scrollTop = docTop;
      centrarCampo();
    }

    function unlock() {
      if (!locked) return;
      const view = document.getElementById('view');
      const keep = view ? view.scrollTop : 0;
      locked = false;
      lastH = -1;
      body.classList.remove('kb-abierto');
      html.style.height = '';
      html.style.overflow = '';
      body.style.overflow = '';
      if (keep > 0) {
        requestAnimationFrame(function () { window.scrollTo(0, keep); });
      }
    }

    function aplicar() {
      if (!locked) {
        if (vv && Math.round(vv.height) < window.innerHeight - 40) lock();
        return;
      }
      const h = visibleHeight();
      if (h === lastH) return;
      lastH = h;
      html.style.height = h + 'px';
      html.style.setProperty('--kb', Math.max(0, Math.round((window.innerHeight || 0) - h)) + 'px');
      centrarCampo();
    }

    document.addEventListener('focusin', function (e) { if (esCaja(e.target)) lock(); });
    document.addEventListener('focusout', function (e) {
      if (esCaja(e.target)) {
        setTimeout(function () { if (!esCaja(document.activeElement)) unlock(); }, 150);
      }
    });

    function onKbShow(info) {
      kbPx = Math.round((info && info.keyboardHeight || 0) * (window.devicePixelRatio || 1));
      if (kbPx > 0) lock();
    }
    function onKbHide() { kbPx = 0; unlock(); }
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard) {
        window.Capacitor.Plugins.Keyboard.addListener('keyboardWillShow', onKbShow);
        window.Capacitor.Plugins.Keyboard.addListener('keyboardWillHide', onKbHide);
        window.Capacitor.Plugins.Keyboard.addListener('keyboardDidHide', onKbHide);
      }
    } catch (e) { /* ignore */ }

    if (vv) { vv.addEventListener('resize', aplicar); vv.addEventListener('scroll', aplicar); }
    window.addEventListener('resize', aplicar);
    window.addEventListener('orientationchange', function () { setTimeout(aplicar, 250); });

    function bloquearGesto(e) { if (locked) e.preventDefault(); }
    document.addEventListener('touchmove', bloquearGesto, { passive: false });
    document.addEventListener('wheel', bloquearGesto, { passive: false });
  })();

  /* ========== ICONOS SVG ========== */
  function ic(name) {
    const svgs = {
      cam: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>',
      img: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
      clip: '<svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>',
      map: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>',
      history: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
      chart: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>',
      sun: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>',
      moon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
      share: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>',
      check: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
    };
    return svgs[name] || '';
  }

  /* ========== IndexedDB ========== */
  const DB_NAME = 'nexalert_offline';
  const DB_VER = 1;
  let _idb = null;

  function openIDB() {
    if (_idb) return Promise.resolve(_idb);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('reportes')) db.createObjectStore('reportes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending', { keyPath: 'ts' });
        if (!db.objectStoreNames.contains('fotos_cola')) db.createObjectStore('fotos_cola', { keyPath: 'ts' });
      };
      req.onsuccess = (e) => { _idb = e.target.result; resolve(_idb); };
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(store, data) {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(data);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGetAll(store) {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbDelete(store, key) {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbClear(store) {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ========== COLA DE CAMBIOS PENDIENTES ========== */
  async function enqueuePending(tipo, payload) {
    await idbPut('pending', { ts: Date.now(), tipo, payload });
    actualizarBadgePendientes();
  }

  async function processPendingQueue() {
    if (!navigator.onLine) return;
    const items = await idbGetAll('pending');
    if (!items.length) return;
    for (const item of items) {
      try {
        if (item.tipo === 'estado') {
          await api('/api/reportes/' + item.payload.id + '/estado', { method: 'POST', body: JSON.stringify({ estado: item.payload.estado }) });
        } else if (item.tipo === 'nota') {
          await api('/api/reportes/' + item.payload.id + '/notas', { method: 'POST', body: JSON.stringify({ texto: item.payload.texto }) });
        } else if (item.tipo === 'foto') {
          await api('/api/reportes/' + item.payload.id + '/fotos', { method: 'POST', body: JSON.stringify(item.payload) });
        } else if (item.tipo === 'ubicacion') {
          await api('/api/reportes/' + item.payload.id + '/ubicacion', { method: 'POST', body: JSON.stringify({ lat: item.payload.lat, lng: item.payload.lng }) });
        } else if (item.tipo === 'nuevo_reporte') {
          await api('/api/reportes', { method: 'POST', body: JSON.stringify(item.payload) });
        } else if (item.tipo === 'estado_nota_foto') {
          await api('/api/reportes/' + item.payload.id + '/estado', { method: 'POST', body: JSON.stringify(item.payload) });
        }
        await idbDelete('pending', item.ts);
      } catch (e) { break; }
    }
    actualizarBadgePendientes();
  }

  async function actualizarBadgePendientes() {
    const items = await idbGetAll('pending');
    const badge = $('#badge-pendientes');
    if (badge) {
      if (items.length > 0) {
        badge.textContent = items.length;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  }

  /* ========== COLA DE FOTOS ========== */
  async function enqueueFoto(id, base64, nombre) {
    await idbPut('fotos_cola', { ts: Date.now(), id, base64, nombre, intentos: 0, estado: 'pendiente' });
    actualizarProgresoFotos();
    if (navigator.onLine) processFotoQueue();
  }

  async function processFotoQueue() {
    const items = await idbGetAll('fotos_cola');
    for (const item of items) {
      if (item.estado === 'completada') { await idbDelete('fotos_cola', item.ts); continue; }
      try {
        await api('/api/reportes/' + item.id + '/fotos', {
          method: 'POST',
          body: JSON.stringify({ nombre: item.nombre, tipo: 'image/jpeg', datos: item.base64 })
        });
        await idbDelete('fotos_cola', item.ts);
      } catch (e) {
        item.intentos = (item.intentos || 0) + 1;
        if (item.intentos >= 5) { item.estado = 'fallida'; await idbPut('fotos_cola', item); }
      }
    }
    actualizarProgresoFotos();
  }

  async function actualizarProgresoFotos() {
    const items = await idbGetAll('fotos_cola');
    const pendientes = items.filter((i) => i.estado !== 'completada').length;
    const bar = $('#foto-progress');
    if (bar) {
      if (pendientes > 0) {
        bar.textContent = pendientes + ' foto' + (pendientes > 1 ? 's' : '') + ' en cola';
        bar.classList.remove('hidden');
      } else {
        bar.classList.add('hidden');
      }
    }
  }

  /* ========== ESTADO ========== */
  let state = { reportes: [], detalle: null, timer: null, view: 'home', stats: null };

  function token() { return localStorage.getItem(TOKEN_KEY); }
  function usuario() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; } }

  /* ========== API ========== */
  async function api(path, options) {
    const headers = { 'Content-Type': 'application/json' };
    if (token()) headers.Authorization = 'Bearer ' + token();
    const res = await fetch(path, { ...options, headers });
    let data = {};
    try { data = await res.json(); } catch (e) { /* noop */ }
    if (res.status === 401 && token()) { cerrarSesion(); throw new Error('Sesion expirada'); }
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Error del servidor');
    return data;
  }

  /* ========== TOAST ========== */
  function toast(msg, tipo) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = (tipo || '');
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.className = 'hidden'; }, 3200);
  }

  /* ========== UTILS ========== */
  function badgeEstado(estado) {
    return '<span class="badge estado-' + esc(estado) + '">' + esc(ESTADO_LABEL[estado] || estado) + '</span>';
  }

  function badgePrio(prio) {
    return '<span class="badge prio-' + esc(prio) + '">' + esc(PRIO_LABEL[prio] || prio) + '</span>';
  }

  function fechaLarga(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return esc(s);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function fechaHoraLarga(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return esc(s);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatearEvento(ev) {
    const tipo = ev.tipo || '';
    const lbl = EVENTO_LABEL[tipo] || tipo;
    if (tipo === 'estado') {
      try { const d = JSON.parse(ev.detalle); return lbl + ': ' + (ESTADO_LABEL[d.de] || d.de) + ' → ' + (ESTADO_LABEL[d.a] || d.a); } catch (e) { return lbl; }
    }
    if (tipo === 'ubicacion') {
      try { const d = JSON.parse(ev.detalle); return lbl + ' (' + d.lat.toFixed(5) + ', ' + d.lng.toFixed(5) + ')'; } catch (e) { return lbl; }
    }
    if (tipo === 'nota') return lbl + ': "' + esc(ev.detalle) + '"';
    if (tipo === 'foto') return lbl + ': ' + esc(ev.detalle);
    if (tipo === 'foto_del') return lbl + ': ' + esc(ev.detalle);
    return lbl;
  }

  /* ========== TEMA ========== */
  function getTheme() { return localStorage.getItem(THEME_KEY) || 'dark'; }
  function applyTheme(t) {
    if (t === 'light') { document.body.classList.add('light'); } else { document.body.classList.remove('light'); }
    const btn = $('#btn-theme');
    if (btn) btn.textContent = t === 'light' ? 'Modo oscuro' : 'Modo claro';
    localStorage.setItem(THEME_KEY, t);
  }
  function toggleTheme() { applyTheme(getTheme() === 'dark' ? 'light' : 'dark'); }

  /* ========== CARGAR REPORTES ========== */
  async function cargarReportes() {
    if (navigator.onLine) {
      try {
        const data = await api('/api/reportes');
        state.reportes = data.data || [];
        for (const r of state.reportes) await idbPut('reportes', r);
        pintarLista();
        return;
      } catch (e) { /* fall to cache */ }
    }
    state.reportes = await idbGetAll('reportes');
    pintarLista();
  }

  /* ========== FILTROS ========== */
  function filtrar() {
    const q = ($('#buscar').value || '').toLowerCase().trim();
    const st = $('#filtro-estado').value;
    const pr = $('#filtro-prio').value;
    const fDesde = $('#filtro-desde').value;
    const fHasta = $('#filtro-hasta').value;
    return state.reportes.filter((r) => {
      if (st && r.estado !== st) return false;
      if (pr && r.prioridad !== pr) return false;
      if (fDesde && r.fecha && r.fecha < fDesde) return false;
      if (fHasta && r.fecha && r.fecha > fHasta + 'T23:59:59') return false;
      if (!q) return true;
      return (r.client_nombre + ' ' + r.equipo_nombre + ' ' + r.descripcion).toLowerCase().includes(q);
    });
  }

  function pintarLista() {
    const rows = filtrar();
    const lista = $('#lista');
    const ult = $('#ultimo-update');
    const pendientes = state.reportes._pendingCount || 0;
    const hora = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    ult.textContent = state.reportes.length + ' reporte' + (state.reportes.length === 1 ? '' : 's') + (pendientes ? ' · ' + pendientes + ' pendiente' + (pendientes > 1 ? 's' : '') : '') + ' · ' + hora;
    if (!rows.length) {
      lista.innerHTML = '<div class="vacio"><span class="ico-vacio">' + ic('clip') + '</span><p>' + (state.reportes.length ? 'No hay reportes con ese filtro.' : 'No tienes reportes asignados todavia.') + '</p></div>';
      return;
    }
    lista.innerHTML = rows.map((r) => `
      <div class="rp-card" data-id="${r.id}">
        <div class="head">
          <div class="cliente">${esc(r.client_nombre || 'Cliente')}</div>
          ${badgeEstado(r.estado)}
        </div>
        <div class="equipo">${esc(r.equipo_nombre || 'Equipo no especificado')}</div>
        <div class="descripcion">${esc(r.descripcion)}</div>
        <div class="meta">
          ${badgePrio(r.prioridad || 'normal')}
          ${r.fotos_count ? '<span class="foto-badge">' + ic('cam') + ' ' + r.fotos_count + '</span>' : ''}
          ${r.lat != null ? '<span class="map-badge">' + ic('map') + '</span>' : ''}
          <span class="fecha">${fechaLarga(r.fecha)}</span>
        </div>
      </div>`).join('');
  }

  /* ========== DETALLE ========== */
  async function abrirDetalle(id) {
    if (navigator.onLine) {
      try {
        const data = await api('/api/reportes/' + id);
        state.detalle = data.data;
        await idbPut('reportes', { ...state.detalle });
        pintarDetalle();
        $('#home').classList.add('hidden');
        $('#dashboard-section').classList.add('hidden');
        $('#detalle').classList.remove('hidden');
        state.view = 'detalle';
        window.scrollTo(0, 0);
        return;
      } catch (e) { /* fall to cache */ }
    }
    const cached = await idbGetAll('reportes');
    state.detalle = cached.find((r) => r.id === id) || null;
    if (!state.detalle) { toast('Reporte no disponible sin conexion', 'err'); return; }
    state.detalle.notas = state.detalle.notas || [];
    state.detalle.fotos = state.detalle.fotos || [];
    pintarDetalle();
    $('#home').classList.add('hidden');
    $('#dashboard-section').classList.add('hidden');
    $('#detalle').classList.remove('hidden');
    state.view = 'detalle';
    window.scrollTo(0, 0);
  }

  function pintarDetalle() {
    const r = state.detalle;
    if (!r) return;
    const notas = r.notas || [];
    const fotos = r.fotos || [];
    const tieneUbicacion = r.lat != null && r.lng != null;
    $('#detalle-contenido').innerHTML = `
      <div class="det-head">
        <div class="det-top">
          <div>
            <div class="cliente">${esc(r.client_nombre || 'Cliente')}</div>
            <div class="equipo">${esc(r.equipo_nombre || 'Equipo no especificado')}</div>
          </div>
          <div class="det-badges">
            ${badgeEstado(r.estado)}
            ${badgePrio(r.prioridad || 'normal')}
          </div>
        </div>
        ${r.fecha ? '<div class="det-row"><label>Fecha del reporte</label><div class="valor">' + fechaLarga(r.fecha) + '</div></div>' : ''}
        <div class="det-row"><label>Problema</label><div class="valor">${esc(r.descripcion)}</div></div>
        ${r.solucion ? '<div class="det-row"><label>Solucion</label><div class="valor">' + esc(r.solucion) + '</div></div>' : ''}
        ${tieneUbicacion ? '<div class="det-row"><label>Ubicacion</label><div class="valor"><a class="map-link" href="https://www.google.com/maps?q=' + r.lat + ',' + r.lng + '" target="_blank" rel="noopener">' + ic('map') + ' Abrir en Maps (' + r.lat.toFixed(5) + ', ' + r.lng.toFixed(5) + ')</a></div></div>' : ''}
        ${fotos.length ? `
          <div class="det-row">
            <label>Evidencia (${fotos.length})</label>
            <div class="fotos-grid">${fotos.map((f) => `
              <div class="foto-item" data-src="data:${esc(f.tipo || 'image/jpeg')};base64,${f.datos}" data-nombre="${esc(f.nombre)}">
                <img src="data:${esc(f.tipo || 'image/jpeg')};base64,${f.datos}" alt="foto" loading="lazy">
              </div>`).join('')}
            </div>
          </div>` : ''}
        <div class="foto-upload">
          <div class="foto-upload-title">Adjuntar evidencia</div>
          <div class="foto-upload-actions">
            <button id="btn-foto-cam" class="btn-cam">${ic('cam')} Camara</button>
            <button id="btn-foto-gal" class="btn-gal">${ic('img')} Galeria</button>
          </div>
          <div id="foto-progress" class="foto-progress hidden"></div>
        </div>
        <div class="det-actions-row">
          ${!tieneUbicacion ? '<button id="btn-ubicacion" class="btn-sm btn-outline">' + ic('map') + ' Registrar ubicacion</button>' : ''}
          <button id="btn-historial" class="btn-sm btn-outline">${ic('history')} Historial</button>
        </div>
      </div>
      <div class="estado-actions">
        ${['abierto', 'en_proceso', 'espera_repuesto', 'espera_cliente', 'resuelto'].map((e) => `
          <button class="estado-btn ${r.estado === e ? 'activo' : ''}" data-estado="${e}">${esc(ESTADO_LABEL[e])}</button>`).join('')}
      </div>
      ${r.estado !== 'resuelto' ? '' : `
      <div class="firma-section">
        <h3>Firma del cliente</h3>
        <canvas id="firma-canvas" width="300" height="150"></canvas>
        <div class="firma-actions">
          <button id="btn-firma-limpiar" class="btn-sm btn-outline">Limpiar</button>
          <button id="btn-firma-guardar" class="btn-sm btn-primary">${ic('check')} Guardar firma</button>
        </div>
      </div>`}
      <div class="notas">
        <h3>Comentarios (${notas.length})</h3>
        ${notas.length ? notas.map((n) => `
          <div class="nota">
            <div class="n-texto">${esc(n.texto)}</div>
            <div class="n-meta">${esc(n.autor || 'Tecnico')} · ${fechaHoraLarga(n.creado)}</div>
          </div>`).join('') : '<p class="hint">Sin comentarios todavia.</p>'}
      </div>
      <div id="historial-section" class="hidden">
        <div class="notas"><h3>Historial</h3><div id="historial-lista"><p class="hint">Cargando...</p></div></div>
      </div>
      <div class="nueva-nota">
        <textarea id="in-nota" placeholder="Escribe un comentario..."></textarea>
        <button id="btn-enviar-nota" class="btn-primary">Enviar comentario</button>
      </div>`;

    $$('.estado-btn').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.estado === 'espera_repuesto' || b.dataset.estado === 'espera_cliente') {
        abrirEsperaModal(r.id, b.dataset.estado, b);
      } else {
        cambiarEstado(r.id, b.dataset.estado, b);
      }
    }));
    $('#btn-enviar-nota').addEventListener('click', enviarNota);
    $('#btn-foto-cam').addEventListener('click', tomarFoto);
    $('#btn-foto-gal').addEventListener('click', elegirFoto);
    $$('.foto-item').forEach((el) => el.addEventListener('click', () => verFotoGrande(el.dataset.src, el.dataset.nombre)));

    const btnUbicacion = $('#btn-ubicacion');
    if (btnUbicacion) btnUbicacion.addEventListener('click', () => capturarUbicacion(r.id));

    const btnHistorial = $('#btn-historial');
    if (btnHistorial) btnHistorial.addEventListener('click', toggleHistorial);

    if (r.estado === 'resuelto') initFirma();
    actualizarProgresoFotos();
  }

  /* ========== HISTORIAL ========== */
  async function toggleHistorial() {
    const sec = $('#historial-section');
    if (sec.classList.contains('hidden')) {
      sec.classList.remove('hidden');
      await cargarHistorial();
    } else {
      sec.classList.add('hidden');
    }
  }

  async function cargarHistorial() {
    const lista = $('#historial-lista');
    if (!lista || !state.detalle) return;
    if (!navigator.onLine) { lista.innerHTML = '<p class="hint">Sin conexion.</p>'; return; }
    try {
      const data = await api('/api/reportes/' + state.detalle.id + '/historial');
      const eventos = data.data || [];
      if (!eventos.length) { lista.innerHTML = '<p class="hint">Sin eventos registrados.</p>'; return; }
      lista.innerHTML = eventos.map((ev) => `
        <div class="nota">
          <div class="n-texto">${formatearEvento(ev)}</div>
          <div class="n-meta">${esc(ev.autor || 'Sistema')} · ${fechaHoraLarga(ev.creado)}</div>
        </div>`).join('');
    } catch (e) {
      lista.innerHTML = '<p class="hint">Error al cargar historial.</p>';
    }
  }

  /* ========== FOTO OVERLAY ========== */
  function verFotoGrande(src, nombre) {
    const ov = $('#foto-overlay');
    $('#foto-overlay-img').src = src;
    ov.dataset.nombre = nombre || '';
    ov.classList.remove('hidden');
  }

  function tomarFoto() { $('#in-foto-cam').click(); }
  function elegirFoto() { $('#in-foto-gal').click(); }

  function procesarYEnviar(files) {
    const f = files && files[0];
    if (!f) return;
    procesarImagen(f).then((dataUrl) => {
      const comma = dataUrl.indexOf(',');
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      const nombre = 'tel_' + Date.now() + '.jpg';
      if (navigator.onLine) {
        enviarFotoDirecto(base64, nombre);
      } else {
        enqueueFoto(state.detalle.id, base64, nombre);
        toast('Foto en cola (sin conexion).', 'ok');
      }
    }).catch((e) => toast(e.message, 'err'));
  }

  async function enviarFotoDirecto(base64, nombre) {
    const btn = $('#btn-foto-cam') || $('#btn-foto-gal');
    const txt = btn && btn.innerHTML;
    if (btn) btn.disabled = true;
    try {
      await api('/api/reportes/' + state.detalle.id + '/fotos', {
        method: 'POST',
        body: JSON.stringify({ nombre, tipo: 'image/jpeg', datos: base64 })
      });
      toast('Foto adjuntada.', 'ok');
      await abrirDetalle(state.detalle.id);
      cargarReportes().catch(() => {});
    } catch (e) {
      enqueueFoto(state.detalle.id, base64, nombre);
      toast('Error subiendo, en cola.', 'err');
    } finally {
      if (btn) { btn.disabled = false; if (txt) btn.innerHTML = txt; }
    }
  }

  function procesarImagen(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const MAX = 1280;
          let w = img.width, h = img.height;
          if (!w || !h) { reject(new Error('Imagen no valida')); return; }
          if (w > MAX || h > MAX) { const k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.72));
        };
        img.onerror = () => reject(new Error('Imagen no valida'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
      reader.readAsDataURL(file);
    });
  }

  /* ========== ESPERA MODAL ========== */
  let esperaState = { reporteId: null, estado: null, btn: null, fotoFile: null, fotoBase64: null, fotoNombre: null };

  function abrirEsperaModal(reporteId, estado, btn) {
    const savedScroll = window.scrollY || 0;
    const view = document.getElementById('view');
    const savedViewScroll = view ? view.scrollTop : 0;
    esperaState = { reporteId, estado, btn, fotoFile: null, fotoBase64: null, fotoNombre: null };
    $('#esp-nota').value = '';
    $('#esp-foto-preview').classList.add('hidden');
    $('#esp-foto-preview').src = '';
    $('#esp-foto-nombre').textContent = '';
    $('#esp-submit').disabled = false;
    $('#espera-modal').classList.remove('hidden');
    $('#top-dropdown').classList.add('hidden');
    setTimeout(() => {
      $('#esp-nota').focus();
      setTimeout(() => {
        window.scrollTo(0, savedScroll);
        if (view) view.scrollTop = savedViewScroll;
      }, 150);
    }, 50);
  }

  function cerrarEsperaModal() {
    $('#espera-modal').classList.add('hidden');
    esperaState = { reporteId: null, estado: null, btn: null, fotoFile: null, fotoBase64: null, fotoNombre: null };
  }

  async function confirmarEspera() {
    const nota = $('#esp-nota').value.trim();
    const { reporteId, estado, btn, fotoBase64, fotoNombre } = esperaState;
    if (!nota && !fotoBase64) { toast('Escribe una nota o adjunta una foto.', 'err'); return; }
    $('#esp-submit').disabled = true;
    const payload = { estado };
    if (nota) payload.nota = nota;
    if (fotoBase64 && fotoNombre) {
      payload.foto = { nombre: fotoNombre, tipo: 'image/jpeg', datos: fotoBase64 };
    }
    if (!navigator.onLine) {
      await enqueuePending('estado_nota_foto', { id: reporteId, ...payload });
      if (state.detalle && state.detalle.id === reporteId) state.detalle.estado = estado;
      pintarDetalle();
      actualizarListaDesdeDetalle();
      toast('Guardado localmente.', 'ok');
      cerrarEsperaModal();
      return;
    }
    try {
      const r = await api('/api/reportes/' + reporteId + '/estado', { method: 'POST', body: JSON.stringify(payload) });
      state.detalle = { ...state.detalle, ...r.data };
      await idbPut('reportes', state.detalle);
      pintarDetalle();
      actualizarListaDesdeDetalle();
      toast('Estado actualizado.', 'ok');
      cerrarEsperaModal();
    } catch (e) {
      await enqueuePending('estado_nota_foto', { id: reporteId, ...payload });
      state.detalle.estado = estado;
      pintarDetalle();
      toast('Guardado localmente.', 'ok');
      cerrarEsperaModal();
    }
  }

  function esperarFotoCam() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = (ev) => procesarEsperaFoto(ev.target.files);
    input.click();
  }

  function esperarFotoGal() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (ev) => procesarEsperaFoto(ev.target.files);
    input.click();
  }

  async function procesarEsperaFoto(files) {
    if (!files || !files[0]) return;
    const file = files[0];
    if (file.size > 8 * 1024 * 1024) { toast('La foto supera 8 MB', 'err'); return; }
    const ext = file.name.split('.').pop() || 'jpg';
    const nombre = 'esp_' + Date.now() + '.' + ext;
    esperaState.fotoFile = file;
    esperaState.fotoNombre = nombre;
    const b64 = await procesarImagen(file);
    esperaState.fotoBase64 = b64;
    const preview = $('#esp-foto-preview');
    preview.src = b64;
    preview.classList.remove('hidden');
    $('#esp-foto-nombre').textContent = file.name;
  }

  /* ========== ESTADO ========== */
  async function cambiarEstado(id, estado, btn) {
    btn.disabled = true;
    if (!navigator.onLine) {
      await enqueuePending('estado', { id, estado });
      if (state.detalle && state.detalle.id === id) state.detalle.estado = estado;
      pintarDetalle();
      actualizarListaDesdeDetalle();
      toast('Estado guardado localmente.', 'ok');
      btn.disabled = false;
      return;
    }
    try {
      const r = await api('/api/reportes/' + id + '/estado', { method: 'POST', body: JSON.stringify({ estado }) });
      state.detalle = { ...state.detalle, ...r.data };
      await idbPut('reportes', state.detalle);
      pintarDetalle();
      actualizarListaDesdeDetalle();
    } catch (e) {
      await enqueuePending('estado', { id, estado });
      state.detalle.estado = estado;
      pintarDetalle();
      toast('Guardado localmente.', 'ok');
      btn.disabled = false;
    }
  }

  function actualizarListaDesdeDetalle() {
    const i = state.reportes.findIndex((x) => x.id === state.detalle.id);
    if (i >= 0) state.reportes[i] = { ...state.reportes[i], ...state.detalle };
  }

  /* ========== NOTAS ========== */
  async function enviarNota() {
    const input = $('#in-nota');
    const texto = (input.value || '').trim();
    if (!texto) return toast('Escribe un comentario.', 'err');
    const btn = $('#btn-enviar-nota');
    btn.disabled = true;
    if (!navigator.onLine) {
      await enqueuePending('nota', { id: state.detalle.id, texto });
      input.value = '';
      toast('Comentario guardado localmente.', 'ok');
      btn.disabled = false;
      return;
    }
    try {
      await api('/api/reportes/' + state.detalle.id + '/notas', { method: 'POST', body: JSON.stringify({ texto }) });
      input.value = '';
      toast('Comentario enviado.', 'ok');
      await abrirDetalle(state.detalle.id);
    } catch (e) {
      await enqueuePending('nota', { id: state.detalle.id, texto });
      input.value = '';
      toast('Guardado localmente.', 'ok');
      btn.disabled = false;
    }
  }

  /* ========== UBICACION ========== */
  async function capturarUbicacion(reporteId) {
    if (!navigator.geolocation) return toast('Geolocalizacion no disponible.', 'err');
    toast('Obteniendo ubicacion...', 'ok');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (navigator.onLine) {
          try {
            await api('/api/reportes/' + reporteId + '/ubicacion', { method: 'POST', body: JSON.stringify({ lat, lng }) });
            state.detalle.lat = lat;
            state.detalle.lng = lng;
            await idbPut('reportes', state.detalle);
            pintarDetalle();
            toast('Ubicacion registrada.', 'ok');
            return;
          } catch (e) { /* fall to queue */ }
        }
        await enqueuePending('ubicacion', { id: reporteId, lat, lng });
        state.detalle.lat = lat;
        state.detalle.lng = lng;
        pintarDetalle();
        toast('Ubicacion guardada localmente.', 'ok');
      },
      (err) => toast('No se pudo obtener ubicacion: ' + err.message, 'err'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  /* ========== FIRMA ========== */
  function initFirma() {
    setTimeout(() => {
      const canvas = $('#firma-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      let drawing = false;
      let lastX = 0, lastY = 0;

      canvas.style.touchAction = 'none';
      canvas.addEventListener('pointerdown', (e) => {
        drawing = true;
        const rect = canvas.getBoundingClientRect();
        lastX = e.clientX - rect.left;
        lastY = e.clientY - rect.top;
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.strokeStyle = '#eef2ff';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.stroke();
        lastX = x; lastY = y;
      });
      canvas.addEventListener('pointerup', () => { drawing = false; });
      canvas.addEventListener('pointerleave', () => { drawing = false; });

      const btnLimpiar = $('#btn-firma-limpiar');
      if (btnLimpiar) btnLimpiar.addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      });

      const btnGuardar = $('#btn-firma-guardar');
      if (btnGuardar) btnGuardar.addEventListener('click', async () => {
        const dataUrl = canvas.toDataURL('image/png');
        const comma = dataUrl.indexOf(',');
        const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
        const nombre = 'firma_' + Date.now() + '.png';
        toast('Guardando firma...', 'ok');
        if (navigator.onLine) {
          try {
            await api('/api/reportes/' + state.detalle.id + '/fotos', {
              method: 'POST', body: JSON.stringify({ nombre, tipo: 'image/png', datos: base64 })
            });
            toast('Firma guardada.', 'ok');
            await abrirDetalle(state.detalle.id);
          } catch (e) {
            await enqueueFoto(state.detalle.id, base64, nombre);
            toast('Firma en cola.', 'ok');
          }
        } else {
          await enqueueFoto(state.detalle.id, base64, nombre);
          toast('Firma guardada localmente.', 'ok');
        }
      });
    }, 100);
  }



  /* ========== DASHBOARD ========== */
  async function abrirDashboard() {
    $('#home').classList.add('hidden');
    $('#detalle').classList.add('hidden');
    $('#dashboard-section').classList.remove('hidden');
    state.view = 'dashboard';
    window.scrollTo(0, 0);
    const sec = $('#dashboard-section');
    sec.innerHTML = '<div class="cargando">Cargando estadísticas...</div>';
    if (!navigator.onLine) {
      sec.innerHTML = '<div class="vacio"><p>Sin conexión para cargar estadísticas.</p></div>';
      return;
    }
    try {
      const data = await api('/api/stats');
      const s = data.data;
      const total = s.total || 0;
      const abiertos = s.porEstado.abierto || 0;
      const proceso = s.porEstado.en_proceso || 0;
      const resueltos = s.porEstado.resuelto || 0;
      const espera = (s.porEstado.espera_repuesto || 0) + (s.porEstado.espera_cliente || 0);
      const prom = s.promResolucionDias;
      const urg = s.porPrio.urgente || 0;
      const alt = s.porPrio.alta || 0;
      sec.innerHTML = `
        <div class="dash-head"><button id="btn-dash-back" class="back-btn"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg> Volver</button><h2>Estadísticas</h2></div>
        <div class="dash-grid">
          <div class="dash-card accent"><div class="dash-num">${total}</div><div class="dash-lbl">Total</div></div>
          <div class="dash-card red"><div class="dash-num">${abiertos}</div><div class="dash-lbl">Abiertos</div></div>
          <div class="dash-card blue"><div class="dash-num">${proceso}</div><div class="dash-lbl">En proceso</div></div>
          <div class="dash-card green"><div class="dash-num">${resueltos}</div><div class="dash-lbl">Resueltos</div></div>
          <div class="dash-card amber"><div class="dash-num">${espera}</div><div class="dash-lbl">En espera</div></div>
          <div class="dash-card accent"><div class="dash-num">${prom != null ? prom + 'd' : '-'}</div><div class="dash-lbl">Prom. resolución</div></div>
        </div>
        <div class="dash-section">
          <h3>Por prioridad</h3>
          <div class="dash-bars">
            ${urg ? '<div class="dash-bar-row"><span class="dash-bar-lbl">Urgente</span><div class="dash-bar"><div class="dash-bar-fill red" style="width:' + Math.round(urg / total * 100) + '%"></div></div><span class="dash-bar-val">' + urg + '</span></div>' : ''}
            ${alt ? '<div class="dash-bar-row"><span class="dash-bar-lbl">Alta</span><div class="dash-bar"><div class="dash-bar-fill orange" style="width:' + Math.round(alt / total * 100) + '%"></div></div><span class="dash-bar-val">' + alt + '</span></div>' : ''}
            ${(s.porPrio.normal || 0) ? '<div class="dash-bar-row"><span class="dash-bar-lbl">Normal</span><div class="dash-bar"><div class="dash-bar-fill blue" style="width:' + Math.round((s.porPrio.normal || 0) / total * 100) + '%"></div></div><span class="dash-bar-val">' + (s.porPrio.normal || 0) + '</span></div>' : ''}
            ${(s.porPrio.baja || 0) ? '<div class="dash-bar-row"><span class="dash-bar-lbl">Baja</span><div class="dash-bar"><div class="dash-bar-fill muted" style="width:' + Math.round(s.porPrio.baja / total * 100) + '%"></div></div><span class="dash-bar-val">' + s.porPrio.baja + '</span></div>' : ''}
          </div>
        </div>
        <div class="dash-section">
          <h3>Últimos 7 días</h3>
          <div class="dash-card accent" style="text-align:center"><div class="dash-num">${s.resueltos7d || 0}</div><div class="dash-lbl">Reportes creados</div></div>
        </div>`;
      $('#btn-dash-back').addEventListener('click', irInicio);
    } catch (e) {
      sec.innerHTML = '<div class="vacio"><p>Error al cargar estadísticas.</p></div>';
    }
  }

  /* ========== NUEVO REPORTE ========== */

  function abrirNuevoReporte() {
    $('#home').classList.add('hidden');
    $('#dashboard-section').classList.add('hidden');
    $('#detalle').classList.add('hidden');
    $('#nuevo-reporte').classList.remove('hidden');
    state.view = 'nuevo';
    $('#nf-cliente').value = '';
    $('#nf-equipo').value = '';
    $('#nf-descripcion').value = '';
    $('#nf-prioridad').value = 'normal';
    $('#nf-submit').disabled = false;
    setTimeout(() => $('#nf-cliente').focus(), 200);
  }

  function cerrarNuevoReporte() {
    $('#nuevo-reporte').classList.add('hidden');
    irInicio();
  }

  async function guardarNuevoReporte(ev) {
    ev.preventDefault();
    const cliente = $('#nf-cliente').value.trim();
    const equipo = $('#nf-equipo').value.trim();
    const desc = $('#nf-descripcion').value.trim();
    const prio = $('#nf-prioridad').value;
    if (!cliente) { toast('Escribe el nombre del cliente', 'err'); $('#nf-cliente').focus(); return; }
    if (!desc) { toast('Describe el problema', 'err'); $('#nf-descripcion').focus(); return; }
    const payload = {
      client_nombre: cliente,
      equipo_nombre: equipo,
      descripcion: desc,
      prioridad: prio
    };
    $('#nf-submit').disabled = true;
    if (navigator.onLine) {
      try {
        const data = await api('/api/reportes', { method: 'POST', body: JSON.stringify(payload) });
        toast('Reporte #' + data.data.id + ' creado', 'ok');
        cerrarNuevoReporte();
      } catch (e) {
        toast(e.message, 'err');
        $('#nf-submit').disabled = false;
      }
    } else {
      await enqueuePending('nuevo_reporte', payload);
      toast('Reporte en cola (sin conexion)', 'ok');
      cerrarNuevoReporte();
    }
  }

  /* ========== NAVEGACION ========== */
  function irInicio() {
    $('#detalle').classList.add('hidden');
    $('#dashboard-section').classList.add('hidden');
    $('#home').classList.remove('hidden');
    state.detalle = null;
    state.view = 'home';
    cargarReportes().catch(() => {});
  }

  function cerrarSesion() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    state.reportes = [];
    mostrarLogin();
  }

  function mostrarApp(u) {
    $('#login').classList.add('hidden');
    $('#topbar').classList.remove('hidden');
    $('#view').classList.remove('hidden');
    $('#buscar').value = '';
    $('#filtro-estado').value = '';
    $('#filtro-prio').value = '';
    $('#filtro-desde').value = '';
    $('#filtro-hasta').value = '';
    irInicio();
    cargarReportes().catch((e) => toast(e.message, 'err'));
    processPendingQueue().catch(() => {});
    processFotoQueue().catch(() => {});
    actualizarBadgePendientes();
    initPush();
    initAppResume();
    if (!state.timer) state.timer = setInterval(() => {
      if (state.view !== 'home') return;
      cargarReportes().catch(() => {});
      processPendingQueue().catch(() => {});
      processFotoQueue().catch(() => {});
    }, 25000);
  }

  function mostrarLogin() {
    $('#topbar').classList.add('hidden');
    $('#view').classList.add('hidden');
    $('#login').classList.remove('hidden');
    $('#in-usuario').focus();
  }

  /* ========== PUSH NOTIFICATIONS ========== */
  async function initPush() {
    if (!NATIVO) return;
    try {
      const CP = window.Capacitor && window.Capacitor.Plugins;
      if (!CP || !CP.PushNotifications) { toast('Push plugin no encontrado', 'err'); return; }
      const PushNotifications = CP.PushNotifications;
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') { toast('Permiso de notificaciones denegado', 'err'); return; }
      await PushNotifications.register();
      PushNotifications.addListener('registration', async (token) => {
        try {
          const user = usuario();
          if (!user) { toast('No hay usuario logueado', 'err'); return; }
          await api('/api/push/register', { method: 'POST', body: JSON.stringify({ pushToken: token.value, tecnicoId: user.id }) });
          toast('Push registrado OK', 'ok');
        } catch (e) { toast('Error registrando push: ' + e.message, 'err'); }
      });
      PushNotifications.addListener('pushNotificationReceived', (notif) => {
        toast(notif.title || 'Nueva notificación');
      });
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const data = action.notification?.data;
        if (data && data.reporteId) {
          abrirDetalle(Number(data.reporteId));
        }
      });
    } catch (e) { toast('Error push: ' + e.message, 'err'); }
  }

  /* ========== REFRESH AL VOLVER AL FOREGROUND ========== */
  function initAppResume() {
    if (!NATIVO) return;
    try {
      const CP = window.Capacitor && window.Capacitor.Plugins;
      if (!CP || !CP.App) return;
      CP.App.addListener('appStateChange', ({ isActive }) => {
        if (isActive && state.view === 'home') {
          cargarReportes().catch(() => {});
          processPendingQueue().catch(() => {});
          processFotoQueue().catch(() => {});
        }
      });
    } catch (e) { /* noop */ }
  }

  /* ========== DOBLE BACK PARA CERRAR ========== */
  let lastBackPress = 0;
  function handleBackButton() {
    if (!NATIVO) return;
    try {
      window.Capacitor.Plugins.App.addListener('backButton', ({ canGoBack }) => {
        if (state.view === 'detalle') {
          irInicio();
        } else if (state.view === 'dashboard') {
          irInicio();
        } else if (state.view === 'nuevo') {
          cerrarNuevoReporte();
        } else {
          const now = Date.now();
          if (now - lastBackPress < 2000) {
            window.Capacitor.Plugins.App.exitApp();
          } else {
            lastBackPress = now;
            toast('Presiona otra vez para salir.');
          }
        }
      });
    } catch (e) { /* noop */ }
  }

  /* ========== ONLINE/OFFLINE ========== */
  function initConnectivity() {
    const bar = $('#offline-bar');
    function update() {
      if (navigator.onLine) {
        bar.classList.add('hidden');
        processPendingQueue().catch(() => {});
        processFotoQueue().catch(() => {});
      } else {
        bar.classList.remove('hidden');
      }
    }
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  /* ========== PULL TO REFRESH ========== */
  function initPullToRefresh() {
    let startY = 0;
    let pulling = false;
    const indicator = $('#pull-indicator');
    document.addEventListener('touchstart', (e) => {
      if (state.view !== 'home') return;
      if (window.scrollY > 5) return;
      startY = e.touches[0].clientY;
      pulling = true;
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 20 && dy < 150) {
        indicator.classList.remove('hidden');
        indicator.style.transform = 'translateY(' + Math.min(dy - 20, 60) + 'px)';
        indicator.style.opacity = Math.min(1, dy / 100);
      }
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!pulling) return;
      pulling = false;
      const dy = e.changedTouches[0].clientY - startY;
      indicator.classList.add('hidden');
      indicator.style.transform = '';
      indicator.style.opacity = '';
      if (dy > 90 && state.view === 'home') {
        cargarReportes().then(() => toast('Actualizado.', 'ok')).catch(() => {});
      }
    }, { passive: true });
  }

  /* ========== EVENTOS ========== */
  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('#btn-login');
    const err = $('#login-error');
    err.classList.add('hidden');
    btn.disabled = true;
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ usuario: $('#in-usuario').value.trim(), pass: $('#in-pass').value }) });
      localStorage.setItem(TOKEN_KEY, r.token);
      localStorage.setItem(USER_KEY, JSON.stringify(r.tecnico));
      mostrarApp(r.tecnico);
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });

  $('#btn-logout').addEventListener('click', () => { $('#top-dropdown').classList.add('hidden'); cerrarSesion(); });
  $('#btn-theme').addEventListener('click', () => { $('#top-dropdown').classList.add('hidden'); toggleTheme(); });
  $('#btn-stats').addEventListener('click', () => { $('#top-dropdown').classList.add('hidden'); abrirDashboard(); });
  $('#btn-refresh').addEventListener('click', async () => {
    $('#top-dropdown').classList.add('hidden');
    const btn = $('#btn-refresh');
    btn.classList.add('spin');
    btn.disabled = true;
    try { await cargarReportes(); toast('Actualizado.', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
    finally { btn.classList.remove('spin'); btn.disabled = false; }
  });

  $('#btn-menu').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const dd = $('#top-dropdown');
    dd.classList.toggle('hidden');
  });
  document.addEventListener('click', (ev) => {
    const dd = $('#top-dropdown');
    if (dd && !dd.classList.contains('hidden') && !ev.target.closest('.top-menu-wrap')) dd.classList.add('hidden');
  });

  $('#foto-overlay').addEventListener('click', (ev) => {
    if (ev.target === $('#foto-overlay') || ev.target === $('#foto-overlay-img')) $('#foto-overlay').classList.add('hidden');
  });

  $('#btn-foto-del').addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const ov = $('#foto-overlay');
    const nombre = ov.dataset.nombre;
    if (!nombre || !state.detalle) return;
    const si = await confirmar('Eliminar foto', 'Seguro que quieres eliminar esta foto del reporte? Esta accion no se puede deshacer.');
    if (!si) return;
    try {
      await api('/api/reportes/' + state.detalle.id + '/fotos/' + encodeURIComponent(nombre), { method: 'DELETE' });
      toast('Foto eliminada.', 'ok');
      ov.classList.add('hidden');
      await abrirDetalle(state.detalle.id);
      cargarReportes().catch(() => {});
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  $('#modal-cancel').addEventListener('click', () => cerrarModal(false));
  $('#modal-ok').addEventListener('click', () => cerrarModal(true));

  $('#esp-cancel').addEventListener('click', cerrarEsperaModal);
  $('#esp-submit').addEventListener('click', confirmarEspera);
  $('#esp-foto-cam').addEventListener('click', esperarFotoCam);
  $('#esp-foto-gal').addEventListener('click', esperarFotoGal);

  function confirmar(titulo, body) {
    return new Promise((resolve) => {
      $('#modal-titulo').textContent = titulo;
      $('#modal-body').innerHTML = '<p style="margin:0;color:var(--muted);font-size:14px;line-height:1.5">' + esc(body) + '</p>';
      $('#modal-ok').textContent = 'Eliminar';
      $('#modal-ok').style.background = 'var(--red)';
      $('#modal-cancel').textContent = 'Cancelar';
      $('#modal').classList.remove('hidden');
      $('#modal')._resolve = resolve;
    });
  }

  function cerrarModal(val) {
    const m = $('#modal');
    m.classList.add('hidden');
    const r = m._resolve;
    m._resolve = null;
    if (r) r(val);
  }

  $('#btn-nuevo').addEventListener('click', abrirNuevoReporte);
  $('#btn-nuevo-back').addEventListener('click', cerrarNuevoReporte);
  $('#form-nuevo').addEventListener('submit', guardarNuevoReporte);

  $('#btn-back').addEventListener('click', irInicio);
  $('#filtro-estado').addEventListener('change', pintarLista);
  $('#filtro-prio').addEventListener('change', pintarLista);
  $('#buscar').addEventListener('input', pintarLista);
  $('#filtro-desde').addEventListener('change', pintarLista);
  $('#filtro-hasta').addEventListener('change', pintarLista);

  $('#lista').addEventListener('click', (ev) => {
    const card = ev.target.closest('.rp-card');
    if (card) abrirDetalle(Number(card.dataset.id)).catch((e) => toast(e.message, 'err'));
  });

  $('#in-foto-cam').addEventListener('change', (ev) => { procesarYEnviar(ev.target.files); ev.target.value = ''; });
  $('#in-foto-gal').addEventListener('change', (ev) => { procesarYEnviar(ev.target.files); ev.target.value = ''; });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && token() && state.view === 'home') {
      cargarReportes().catch(() => {});
    }
  });

  /* ========== INIT ========== */
  if (NATIVO) {
    document.documentElement.classList.add('nativo');
    try {
      const SB = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
      if (SB && typeof SB.hide === 'function') SB.hide();
    } catch (e) { /* noop */ }
    handleBackButton();
  }

  applyTheme(getTheme());
  initConnectivity();
  initPullToRefresh();

  if (token()) mostrarApp(usuario()); else mostrarLogin();
})();
