(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  let currentUser = null;
  let editId = null;
  let modalRecord = null;
  let lastFrontFile = null;
  let aiConfigured = false;
  let aiProviders = [];

  const FRONT_FIELDS = [
    ['cedula', 'Cédula'],
    ['nombres', 'Nombres'],
    ['apellidos', 'Apellidos'],
    ['sexo', 'Sexo']
  ];

  const BACK_FIELDS = [
    ['fecha_nacimiento', 'Fecha de nacimiento'],
    ['lugar_nacimiento', 'Lugar de nacimiento'],
    ['ciudad', 'Ciudad de residencia'],
    ['nacionalidad', 'Nacionalidad'],
    ['estado_civil', 'Estado civil'],
    ['profesion', 'Profesión'],
    ['fecha_vencimiento', 'Fecha de vencimiento'],
    ['tipo_sangre', 'Tipo de sangre'],
    ['puesto', 'Puesto'],
    ['departamento', 'Departamento'],
    ['sucursal', 'Sucursal']
  ];

  const SEXO_OPTS = ['', 'Masculino', 'Femenino'];
  const CIVIL_OPTS = ['', 'Soltero', 'Casado', 'Divorciado', 'Viudo', 'Unión libre'];
  const SANGRE_OPTS = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  const TIPO_SALARIO_OPTS = ['', 'mensual', 'quincenal', 'semanal', 'diario', 'por_hora'];
  const TIPO_SALARIO_LABEL = { mensual: 'Mensual', quincenal: 'Quincenal', semanal: 'Semanal', diario: 'Diario', por_hora: 'Por hora' };
  const CONTRATO_OPTS = ['', 'indefinido', 'temporal', 'prueba', 'obra'];
  const CONTRATO_LABEL = { indefinido: 'Indefinido', temporal: 'Temporal / definido', prueba: 'Periodo de prueba', obra: 'Obra o servicio' };
  const MESES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const LABOR_FIELDS = [
    ['salario', 'Salario (RD$)'],
    ['tipo_salario', 'Tipo de salario'],
    ['fecha_ingreso', 'Fecha de ingreso'],
    ['nss', 'NSS'],
    ['ars', 'ARS'],
    ['afp', 'AFP'],
    ['email', 'Correo electrónico'],
    ['telefono', 'Teléfono'],
    ['flota', 'Número de flota'],
    ['banco', 'Banco'],
    ['cuenta', 'Número de cuenta'],
    ['tipo_contrato', 'Tipo de contrato']
  ];

  /* ============ Helpers ============ */
  function toast(msg, type = 'info', ms = 3000) {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, ms);
  }

  function canEdit() { return currentUser && (currentUser.role === 'admin' || currentUser.role === 'editor'); }
  function isAdmin() { return currentUser && currentUser.role === 'admin'; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function roleClass(r) { return 'role-' + (r === 'admin' ? 'admin' : r === 'editor' ? 'editor' : 'invitado'); }
  function roleLabel(r) { return r === 'admin' ? 'Admin' : r === 'editor' ? 'Editor' : 'Invitado'; }

  function fmtRD(v) {
    const n = Number(v) || 0;
    return 'RD$ ' + n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Convierte AAAA-MM-DD (input date) al formato DD/MM/AAAA usado en el expediente.
  function isoToDMY(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return String(iso);
    return `${m[3].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[1]}`;
  }

  /* ============ Session / navigation ============ */
  function showLogin() {
    $('app-view').classList.add('hidden');
    $('login-view').classList.remove('hidden');
    $('login-user').value = '';
    $('login-pass').value = '';
    $('login-error').classList.add('hidden');
    $('login-user').focus();
  }

  function showApp() {
    $('login-view').classList.add('hidden');
    $('app-view').classList.remove('hidden');
    $('user-name').textContent = currentUser.full_name || currentUser.username;
    const uname = currentUser.full_name || currentUser.username || '';
    const uparts = uname.trim().split(/\s+/);
    const initials = uparts.length >= 2 ? uparts[0][0] + uparts[uparts.length - 1][0] : (uparts[0] || '')[0] || '';
    $('user-name').setAttribute('data-initials', initials.toUpperCase());
    const rb = $('user-role-badge');
    rb.textContent = roleLabel(currentUser.role);
    rb.className = 'role-badge ' + roleClass(currentUser.role);
    $('nav-usuarios').classList.toggle('hidden', !isAdmin());
    $('nav-audit').classList.toggle('hidden', !isAdmin());
    $('nav-nomina').classList.toggle('hidden', !canEdit());
    $('nav-reportes').classList.toggle('hidden', !canEdit());
    $('nav-notificaciones').classList.toggle('hidden', !canEdit());
    $('nav-correo').classList.toggle('hidden', !canEdit());
    $('nav-sistema').classList.toggle('hidden', !canEdit());
    $('btn-new-employee').classList.toggle('hidden', !canEdit());
    $('btn-export-cedulas-pdf').classList.toggle('hidden', !canEdit());
    $('btn-import-excel-header').classList.toggle('hidden', !canEdit());
    $('btn-historial-finiquitos').classList.toggle('hidden', !canEdit());
    $('btn-inactivos-excel').classList.toggle('hidden', !canEdit());
    $('salarios-maint-card').classList.toggle('hidden', !isAdmin());
    go('dashboard');
    loadNotificaciones();
  }

  /* ============ Conexión (local o nube) ============ */
  async function loadConnStatus() {
    const el = $('conn-status');
    try {
      const res = await window.api.getServerConfig();
      if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'Error');
      const cfg = res.data;
      if (cfg.cloud && cfg.cloud.enabled && cfg.cloud.url) {
        el.textContent = 'Verificando la nube: ' + cfg.cloud.url + '…';
        el.className = 'conn-status';
        try {
          const t = await window.api.testCloud(cfg.cloud.url);
          if (t && t.ok) {
            el.textContent = '☁️ Conectado a la nube: ' + cfg.cloud.url;
            el.className = 'conn-status ok';
          } else {
            throw new Error(t && t.error ? t.error : 'sin respuesta');
          }
        } catch (e2) {
          el.textContent = 'Nube no alcanzable: ' + (e2 && e2.message ? e2.message : 'error');
          el.className = 'conn-status err';
        }
        return;
      }
      el.textContent = 'Base de datos local de esta PC';
      el.className = 'conn-status';
    } catch (e) {
      el.textContent = 'No se pudo verificar la conexión: ' + (e && e.message ? e.message : 'error');
      el.className = 'conn-status err';
    }
  }

  let connMode = 'local';
  let connCfg = null;

  function setConnMode(mode) {
    connMode = mode;
    document.querySelectorAll('#conn-mode-cards .mode-card').forEach((card) => {
      const selected = card.dataset.mode === mode;
      card.classList.toggle('selected', selected);
      card.querySelector('input').checked = selected;
    });
    $('conn-local').classList.toggle('hidden', mode !== 'local');
    $('conn-cloud').classList.toggle('hidden', mode !== 'cloud');
    if (mode === 'cloud') {
      const saved = connCfg && connCfg.cloud && connCfg.cloud.token;
      $('cloud-saved-note').textContent = saved ? '✓ Acceso guardado para esta dirección. Puedes reconectar.' : '';
    }
  }

  async function openServerConfig() {
    try {
      const res = await window.api.getServerConfig();
      if (res && res.ok) {
        connCfg = res.data;
        const c = res.data;
        $('cloud-url').value = (c.cloud && c.cloud.url) || '';
        const mode = (c.mode && ['local', 'cloud'].includes(c.mode)) ? c.mode : 'local';
        setConnMode(mode);
      }
    } catch (e) { /* noop */ }
    $('server-modal').classList.remove('hidden');
  }

  function closeServerConfig() {
    $('server-modal').classList.add('hidden');
  }

  async function testCloudConnection() {
    const box = $('cloud-test-result');
    box.className = 'error-box';
    box.classList.remove('hidden');
    box.textContent = 'Probando…';
    try {
      const res = await window.api.testCloud($('cloud-url').value);
      if (res && res.ok) {
        box.textContent = 'Conexión exitosa. El servidor en la nube está disponible.';
        box.className = 'error-box success';
      } else {
        throw new Error(res && res.error ? res.error : 'sin respuesta');
      }
    } catch (e) {
      box.textContent = (e && e.message) || 'No se pudo conectar';
      box.className = 'error-box';
    }
  }

  async function connectCloud() {
    const box = $('cloud-login-result');
    box.className = 'error-box';
    box.classList.remove('hidden');
    box.textContent = 'Conectando…';
    const url = $('cloud-url').value.trim().replace(/\/+$/, '');
    const user = $('cloud-user').value.trim();
    const pass = $('cloud-pass').value;
    try {
      if (!url) throw new Error('Escribe la dirección del servidor (ej. https://kardexdigital.duckdns.org)');
      if (!/^https?:\/\//i.test(url)) throw new Error('La dirección debe comenzar con http:// o https://');
      if (!user || !pass) throw new Error('Escribe el usuario y la contraseña');
      // Primero se guarda la URL para que el login la use; luego se autentica y
      // se guarda el token JWT. Al final se reinicia conectado a la nube.
      const saved = await window.api.setCloud({ url });
      if (!saved || !saved.ok) throw new Error(saved && saved.error ? saved.error : 'Error guardando la dirección');
      const res = await window.api.cloudLogin(user, pass);
      if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'Error de autenticación');
      const who = ((res.user && (res.user.full_name || res.user.username)) || '');
      box.textContent = '✓ Conectado a la nube' + (who ? ' como ' + who : '') + '. Reiniciando…';
      box.className = 'error-box success';
      setTimeout(() => window.api.restartApp(), 1200);
    } catch (e) {
      box.textContent = (e && e.message) || 'No se pudo conectar a la nube';
      box.className = 'error-box';
    }
  }

  async function saveServerConfig() {
    const mode = connMode;
    try {
      if (mode === 'cloud') {
        const url = $('cloud-url').value.trim().replace(/\/+$/, '');
        if (!url) throw new Error('Escribe la dirección del servidor (ej. https://kardexdigital.duckdns.org)');
        if (!/^https?:\/\//i.test(url)) throw new Error('La dirección debe comenzar con http:// o https://');
        const savedTok = !!(connCfg && connCfg.cloud && connCfg.cloud.token);
        const tokMatches = !!(connCfg && connCfg.cloud && connCfg.cloud.url === url);
        if (!savedTok || !tokMatches) {
          throw new Error('Pulsa "Conectar y guardar acceso" con el usuario y contraseña antes de aplicar');
        }
        toast('Conectando a la nube. Reiniciando…', 'info', 1500);
        setTimeout(() => window.api.restartApp(), 1200);
        return;
      }
      if (connCfg && connCfg.mode === 'local' && !(connCfg.cloud && connCfg.cloud.enabled)) {
        closeServerConfig();
        toast('Configuración actual: base de datos local', 'info', 1200);
        return;
      }
      const res = await window.api.setServerConfig({ mode: 'local' });
      if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'Error');
      toast('Volviendo a base de datos local. Reiniciando…', 'info', 1500);
      setTimeout(() => window.api.restartApp(), 1200);
    } catch (e) {
      toast((e && e.message) || 'Error guardando la configuración', 'error');
    }
  }

  /* ============ Wizard de primer arranque ============ */
  let wizardMode = 'local';

  function setWizardMode(mode) {
    wizardMode = mode;
    document.querySelectorAll('#wizard-mode-cards .mode-card').forEach((card) => {
      const selected = card.dataset.mode === mode;
      card.classList.toggle('selected', selected);
      card.querySelector('input').checked = selected;
    });
    $('btn-wizard-next').classList.remove('hidden');
  }

  async function showWizardIfFirstRun() {
    try {
      const res = await window.api.getServerConfig();
      if (res && res.ok && res.data && res.data.firstRun) {
        setWizardMode('local');
        $('wizard-modal').classList.remove('hidden');
      }
    } catch (e) { /* noop */ }
  }

  async function wizardContinue() {
    try { await window.api.wizardDone(); } catch (e) { /* noop */ }
    $('wizard-modal').classList.add('hidden');
    if (wizardMode === 'local') return;
    // Modo nube: se abre la ventana de conexión para introducir URL + credenciales.
    try {
      const res = await window.api.getServerConfig();
      if (res && res.ok) {
        connCfg = res.data;
        $('cloud-url').value = (res.data.cloud && res.data.cloud.url) || '';
      }
    } catch (e) { /* noop */ }
    setConnMode('cloud');
    $('server-modal').classList.remove('hidden');
    $('cloud-url').focus();
  }

  /* ============ Licencia ============ */
  function renderLicense(s) {
    const box = $('license-text');
    const btn = $('btn-license');
    box.className = 'license-text';
    if (!s) { box.textContent = 'Licencia desconocida'; btn.textContent = 'Activar licencia'; return; }
    if (s.valid && s.license) {
      box.textContent = '✔ ' + s.license.company + (s.license.expires ? ' · vence ' + s.license.expires : ' · perpetua');
      btn.textContent = 'Ver licencia';
    } else if (s.valid) {
      box.textContent = '✔ Licencia válida';
      btn.textContent = 'Ver licencia';
    } else if (!s.activated && s.trial && !s.trial.expired) {
      box.textContent = 'Versión de prueba · ' + s.trial.daysLeft + ' día(s) restante(s)';
      btn.textContent = 'Activar licencia';
    } else if (!s.activated) {
      box.textContent = 'Prueba vencida · activa tu licencia';
      box.className = 'license-text err';
      btn.textContent = 'Activar licencia';
    } else {
      box.textContent = 'Licencia no válida: ' + (s.reason || 'error');
      box.className = 'license-text err';
      btn.textContent = 'Activar licencia';
    }
  }

  async function loadLicense() {
    try {
      const res = await window.api.licenseStatus();
      renderLicense(res && res.ok ? res.data : null);
    } catch (e) { renderLicense(null); }
  }

  async function openLicenseModal() {
    try {
      const res = await window.api.licenseStatus();
      const s = res && res.ok ? res.data : null;
      const cur = $('license-current');
      const box = $('license-result');
      box.className = 'error-box hidden';
      box.textContent = '';
      $('license-machine-hint').textContent = 'ID de esta computadora: ' + (s ? s.machineId : '—');
      $('license-key').value = '';
      if (s && s.valid && s.license) {
        const progs = (s.license.programs && s.license.programs.length) ? s.license.programs.map((p) => String(p).toUpperCase()).join(' + ') : 'KARDEX';
        cur.innerHTML = '<div class="ok-box">Licencia activa<br/><b>' + esc(s.license.company) + '</b> · ' +
          progs +
          ' · tipo ' + esc(s.license.type) +
          (s.license.expires ? ' · vence ' + esc(s.license.expires) : ' · perpetua') +
          (s.license.seats ? ' · ' + s.license.seats + ' puesto(s)' : '') +
          (s.maxEmployees ? ' · hasta ' + s.maxEmployees + ' empleado(s)' : '') + '</div>';
      } else if (s && s.activated) {
        cur.innerHTML = '<div class="err-box">Licencia guardada pero no válida: ' + esc(s.reason || 'error') + '</div>';
      } else if (s && s.trial) {
        cur.innerHTML = '<div class="ok-box">Modo prueba · ' + s.trial.daysLeft + ' día(s) restante(s).</div>';
      }
    } catch (e) { /* noop */ }
    $('license-modal').classList.remove('hidden');
    $('license-key').focus();
  }

  async function activateLicense() {
    const box = $('license-result');
    box.className = 'error-box';
    box.classList.remove('hidden');
    const key = $('license-key').value.trim();
    if (!key) { box.textContent = 'Pega la clave de licencia primero.'; return; }
    box.textContent = 'Activando…';
    try {
      const res = await window.api.licenseActivate(key);
      if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'Error');
      box.textContent = '¡Licencia activada correctamente!';
      box.className = 'error-box success';
      await loadLicense();
      setTimeout(() => $('license-modal').classList.add('hidden'), 1200);
    } catch (e) {
      box.textContent = (e && e.message) || 'La licencia no es válida';
    }
  }

  async function init() {
    loadConnStatus();
    showWizardIfFirstRun();
    loadLicense();
    try {
      const st = await window.api.aiStatus();
      aiProviders = (st && st.ok && st.data && Array.isArray(st.data.providers)) ? st.data.providers : [];
      aiConfigured = aiProviders.length > 0;
      const sel = $('ai-provider');
      for (const opt of Array.from(sel.options)) {
        opt.hidden = !aiProviders.includes(opt.value);
      }
      if (aiProviders.length === 1) {
        sel.value = aiProviders[0];
      } else if (!aiProviders.includes(sel.value)) {
        sel.value = aiProviders.includes('gemini') ? 'gemini' : (aiProviders[0] || '');
      }
      sel.classList.toggle('hidden', aiProviders.length <= 1);
    } catch (e) { aiConfigured = false; aiProviders = []; }
    try {
      const res = await window.api.me();
      if (res && res.ok && res.data) { currentUser = res.data; showApp(); }
      else showLogin();
    } catch (e) {
      showLogin();
    }
  }

  /* ============ Views ============ */
  const views = { dashboard: null, empleados: null, inactivos: null, nomina: null, reportes: null, notificaciones: null, correo: null, usuarios: null, audit: null, sistema: null };
  function go(name) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
    ['dashboard', 'empleados', 'inactivos', 'nomina', 'reportes', 'notificaciones', 'correo', 'usuarios', 'audit', 'sistema'].forEach(v => {
      $('view-' + v).classList.toggle('hidden', v !== name);
    });
    if (name === 'dashboard') loadDashboard();
    if (name === 'empleados') loadEmployees();
    if (name === 'inactivos') loadInactiveEmployees();
    if (name === 'nomina') loadNomina();
    if (name === 'reportes') initReportes();
    if (name === 'notificaciones') { loadNotificaciones(); loadNotifSettings(); }
    if (name === 'correo') loadCorreo();
    if (name === 'usuarios') loadUsers();
    if (name === 'audit') loadAudit();
    if (name === 'sistema') loadSistema();
  }

  /* ============ Dashboard / Inicio ============ */
  function escLabel(v) { return esc(String(v == null ? '' : v)); }
  function renderBarChart(el, items, opts) {
    const o = opts || {};
    const max = Math.max(1, ...items.map(i => i.value));
    const format = o.format || ((v) => v);
    el.innerHTML = items.map(it => `
      <div class="bar-col" title="${esc(it.label)}: ${it.value}">
        <div class="bar-value">${format(it.value)}</div>
        <div class="bar-track"><div class="bar-fill" style="height:${Math.max(3, Math.round((it.value / max) * 100))}%;${it.color ? 'background:' + it.color : ''}"></div></div>
        <div class="bar-label" title="${esc(it.label)}">${escLabel(it.label)}</div>
      </div>`).join('');
  }
  function monthKey(offset) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - offset);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function monthLabel(offset) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - offset);
    return d.toLocaleDateString('es', { month: 'short' }).replace('.', '') + ' ' + d.getFullYear().toString().slice(-2);
  }
  function fmtDshDate(v) {
    if (!v) return '—';
    const s = String(v);
    const n = /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(s.slice(0, 10) + 'T00:00:00') : new Date(s);
    if (isNaN(n.getTime())) return '—';
    return n.toLocaleDateString('es-DO');
  }
  async function loadDashboard() {
    try {
      const [listRes, statsRes, notifRes] = await Promise.all([
        window.api.listEmployees('', ''),
        window.api.getStats(),
        window.api.listNotificaciones()
      ]);
      if (!listRes.ok) throw new Error(listRes.error);
      const rows = (listRes.data || []).slice();
      const stats = (statsRes && statsRes.data) || {};
      const active = stats.activos != null ? stats.activos : rows.filter(r => r.status === 'activo').length;
      const inactive = stats.inactivos != null ? stats.inactivos : rows.filter(r => r.status === 'inactivo').length;

      const activosCount = active;
      const inactivosCount = inactive;
      const total = rows.length;
      const conCedula = rows.filter(r => r.has_images).length;

      $('dsh-activos').textContent = activosCount;
      $('dsh-inactivos').textContent = inactivosCount;
      $('dsh-total').textContent = total;
      $('dsh-cedula').textContent = conCedula;
      $('dashboard-subtitle').textContent = 'Resumen general · ' + new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

      const deptMap = {};
      rows.forEach(r => { if (r.status === 'activo') { const k = (r.departamento || 'Sin departamento'); deptMap[k] = (deptMap[k] || 0) + 1; } });
      const deptItems = Object.keys(deptMap).map(k => ({ label: k, value: deptMap[k], color: '#3b82f6' })).sort((a, b) => b.value - a.value).slice(0, 8);
      if (!deptItems.length) $('dash-dept-card').classList.add('hidden');
      else { $('dash-dept-card').classList.remove('hidden'); renderBarChart($('dash-dept-chart'), deptItems); }

      renderBarChart($('dash-status-chart'), [
        { label: 'Activos', value: activosCount, color: '#10b981' },
        { label: 'Inactivos', value: inactivosCount, color: '#f59e0b' }
      ]);

      const monthly = [];
      for (let i = 5; i >= 0; i--) {
        const k = monthKey(i);
        monthly.push({ key: k, label: monthLabel(i), count: 0 });
      }
      rows.forEach(r => {
        const c = (r.created_at || '').slice(0, 10);
        if (!c) return;
        const mk = c.slice(0, 7);
        const m = monthly.find(x => x.key === mk);
        if (m) m.count++;
      });
      renderBarChart($('dash-montly-chart'), monthly.map(m => ({ label: m.label, value: m.count, color: '#8b5cf6' })));

      const recent = rows.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8);
      $('dash-recent-note').textContent = 'Los más recientes primero (últimos ' + recent.length + ' de ' + total + ')';
      $('dashboard-empty').classList.toggle('hidden', recent.length > 0);
      $('dashboard-recent-tbody').innerHTML = recent.map(r => `
        <tr>
          <td><strong>${esc(r.cedula || '—')}</strong></td>
          <td>${esc(r.nombres)} ${esc(r.apellidos)}</td>
          <td>${esc(r.departamento || '—')}</td>
          <td>${esc(r.puesto || '—')}</td>
          <td>${esc(fmtDshDate(r.created_at))}</td>
          <td class="row-actions">
            <button class="btn btn-ghost btn-sm" data-open-emp="${r.id}" title="Abrir expediente">Abrir</button>
          </td>
        </tr>`).join('');

      $('dashboard-recent-tbody').querySelectorAll('[data-open-emp]').forEach(btn => {
        btn.addEventListener('click', () => openEmployee(btn.getAttribute('data-open-emp')));
      });

      // Próximas alertas
      const alerts = ((notifRes && notifRes.data && notifRes.data.events) || []).slice(0, 6);
      const notifBox = $('dash-alertas');
      if (!alerts.length) {
        notifBox.innerHTML = '<p class="muted small">No hay alertas próximas.</p>';
      } else {
        notifBox.innerHTML = alerts.map(a => `<div class="dash-alerta"><span>${esc(a.titulo)}</span><em>${a.dias < 0 ? 'Vencida' : a.dias === 0 ? 'Hoy' : 'En ' + a.dias + ' día' + (a.dias === 1 ? '' : 's')}</em></div>`).join('');
      }

      // Nómina
      const conSalario = rows.filter(r => r.status === 'activo' && Number(r.salario) > 0);
      const totalSalarial = conSalario.reduce((s, r) => s + (Number(r.salario) || 0), 0);
      const n = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' });
      $('dash-nomina').innerHTML =
        `<div class="dash-alerta"><span>Empleados activos con salario</span><em>${conSalario.length}</em></div>` +
        `<div class="dash-alerta"><span>Nómina mensual estimada</span><em>${n.format(totalSalarial)}</em></div>` +
        `<div class="dash-alerta"><span>Salario promedio</span><em>${conSalario.length ? n.format(Math.round(totalSalarial / conSalario.length)) : n.format(0)}</em></div>`;
    } catch (e) {
      toast('Error cargando el panel: ' + ((e && e.message) || 'error'), 'error');
    }
  }

  /* ============ Empleados ============ */
  let empPage = 1;
  let empAllRows = [];
  const EMP_PAGE_SIZE = 10;

  async function loadEmployees() {
    const search = $('search-input').value;
    try {
      const res = await window.api.listEmployees(search, 'activo');
      if (!res.ok) throw new Error(res.error);
      empAllRows = res.data;
      empPage = 1;
      renderEmployeesPage();
      loadStats();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function renderEmployeesPage() {
    const rows = empAllRows;
    const pages = Math.max(1, Math.ceil(rows.length / EMP_PAGE_SIZE));
    if (empPage > pages) empPage = pages;
    const start = (empPage - 1) * EMP_PAGE_SIZE;
    const pageRows = rows.slice(start, start + EMP_PAGE_SIZE);
    $('employees-count').textContent = rows.length + ' registro(s)';
    $('employees-empty').classList.toggle('hidden', rows.length > 0);
    const tb = $('employees-tbody');
    tb.innerHTML = pageRows.map(r => `
        <tr>
          <td><strong>${esc(r.cedula || '—')}</strong></td>
          <td>${esc(r.nombres)} ${esc(r.apellidos)}</td>
          <td>${esc(r.sexo || '')}</td>
          <td>${esc(r.fecha_nacimiento || '')}</td>
          <td>${esc(r.estado_civil || '')}</td>
          <td>${esc(r.puesto || '')}</td>
          <td>${esc(r.departamento || '')}</td>
          <td class="contacto-cell">
            ${r.email ? `<span class="muted">✉ ${esc(r.email)}</span>` : ''}
            ${r.telefono ? `<span class="muted">📞 ${esc(r.telefono)}</span>` : ''}
            ${r.flota ? `<span class="muted">📟 ${esc(r.flota)}</span>` : ''}
            ${!r.email && !r.telefono && !r.flota ? '<span class="muted">—</span>' : ''}
          </td>
          <td>${r.has_images ? '✅' : '—'}</td>
          <td class="row-actions">
            <button class="btn btn-ghost" data-open="${r.id}">Ver / Editar</button>
            ${canEdit() ? `<button class="btn btn-danger btn-sm" data-fire="${r.id}">Dar de baja</button>` : ''}
          </td>
        </tr>`).join('');
    tb.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openEmployee(Number(b.dataset.open))));
    tb.querySelectorAll('[data-finiquito]').forEach(b => b.addEventListener('click', () => showFiniquito(Number(b.dataset.finiquito))));
    tb.querySelectorAll('[data-fire]').forEach(b => b.addEventListener('click', () => showLiquidacion(Number(b.dataset.fire))));
    const bar = $('emp-pagination');
    if (bar) bar.classList.toggle('hidden', rows.length === 0);
    $('emp-page-info').textContent = `Página ${empPage} de ${pages} · ${rows.length} registro(s)`;
    $('emp-prev').disabled = empPage <= 1;
    $('emp-next').disabled = empPage >= pages;
  }

  /* ============ Inactivos ============ */
  let inactivePage = 1;
  let inactiveAllRows = [];
  const INACTIVE_PAGE_SIZE = 10;

  async function loadInactiveEmployees() {
    const search = $('search-inactive').value;
    try {
      const res = await window.api.listEmployees(search, 'inactivo');
      if (!res.ok) throw new Error(res.error);
      inactiveAllRows = res.data;
      inactivePage = 1;
      renderInactivePage();
      loadStats();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function renderInactivePage() {
    const rows = inactiveAllRows;
    const pages = Math.max(1, Math.ceil(rows.length / INACTIVE_PAGE_SIZE));
    if (inactivePage > pages) inactivePage = pages;
    const start = (inactivePage - 1) * INACTIVE_PAGE_SIZE;
    const pageRows = rows.slice(start, start + INACTIVE_PAGE_SIZE);
    $('inactive-count').textContent = rows.length + ' registro(s)';
    $('inactive-empty').classList.toggle('hidden', rows.length > 0);
    const tb = $('inactive-tbody');
    tb.innerHTML = pageRows.map(r => `
        <tr>
          <td><strong>${esc(r.cedula || '—')}</strong></td>
          <td>${esc(r.nombres)} ${esc(r.apellidos)}</td>
          <td>${esc(r.sexo || '')}</td>
          <td>${esc(r.fecha_nacimiento || '')}</td>
          <td>${esc(r.estado_civil || '')}</td>
          <td>${esc(r.puesto || '')}</td>
          <td>${esc(r.departamento || '')}</td>
          <td>${esc(r.fecha_baja || '—')}</td>
          <td class="row-actions">
            <button class="btn btn-ghost" data-open="${r.id}">Ver</button>
            ${canEdit() ? `<button class="btn btn-ghost" data-finiquito="${r.id}">Finiquito</button>` : ''}
            ${canEdit() ? `<button class="btn btn-primary btn-sm" data-reactivate="${r.id}">Reactivar</button>` : ''}
          </td>
        </tr>`).join('');
    tb.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openEmployee(Number(b.dataset.open))));
    tb.querySelectorAll('[data-finiquito]').forEach(b => b.addEventListener('click', () => showFiniquito(Number(b.dataset.finiquito))));
    tb.querySelectorAll('[data-reactivate]').forEach(b => b.addEventListener('click', () => showReintegrar(Number(b.dataset.reactivate))));
    const bar = $('inactive-pagination');
    if (bar) bar.classList.toggle('hidden', rows.length === 0);
    $('inactive-page-info').textContent = `Página ${inactivePage} de ${pages} · ${rows.length} registro(s)`;
    $('inactive-prev').disabled = inactivePage <= 1;
    $('inactive-next').disabled = inactivePage >= pages;
  }

  /* ============ Estadísticas ============ */
  async function loadStats() {
    try {
      const res = await window.api.getStats();
      if (!res.ok) throw new Error(res.error);
      $('stat-activos').textContent = res.data.activos;
      $('stat-inactivos').textContent = res.data.inactivos;
      const dl = $('dept-list');
      const rows = res.data.departamentos || [];
      dl.innerHTML = rows.length
        ? rows.map(d => `<div class="dept-item"><span>${esc(d.departamento)}</span><b>${d.cantidad}</b></div>`).join('')
        : '<div class="muted">Sin datos</div>';
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function refreshEmployeeLists() {
    loadEmployees();
    loadInactiveEmployees();
    loadStats();
  }

  /* ============ Liquidación ============ */
  let liquidacionEmpId = null;
  let finiquitoEmpId = null;
  function liquidacionOptions() {
    const fb = $('liq-fecha-baja').value;
    return {
      fecha_baja: fb,
      ha_sido_preavisado: $('liq-preaviso').checked,
      incluir_cesantia: $('liq-cesantia').checked,
      tomo_vacaciones_ultimo_ano: $('liq-vacaciones').checked,
      incluir_salario_navidad: $('liq-navidad').checked
    };
  }
  function formatTiempoLaborado(t) {
    const y = Number(t && t.years) || 0;
    const m = Number(t && t.months) || 0;
    const d = Number(t && t.days) || 0;
    const parts = [];
    if (y) parts.push(y + (y === 1 ? ' año' : ' años'));
    if (m) parts.push(m + (m === 1 ? ' mes' : ' meses'));
    if (d) parts.push(d + (d === 1 ? ' día' : ' días'));
    return parts.length ? parts.join(', ') : 'Sin antigüedad';
  }
  async function recalcularLiquidacion() {
    if (!liquidacionEmpId) return;
    try {
      const lr = await window.api.calcularLiquidacion(liquidacionEmpId, liquidacionOptions());
      if (!lr.ok) throw new Error(lr.error);
      const liq = lr.data;
      const items = [
        ['Salario mensual', fmtRD(liq.salario_mensual)],
        ['Salario diario', fmtRD(liq.salario_diario)],
        ['Tiempo de servicio', formatTiempoLaborado(liq.tiempo_laborado)],
        ['Cesantía (' + liq.cesantia_dias + ' días)', fmtRD(liq.cesantia)],
        ['Preaviso (' + liq.preaviso_dias + ' días)', fmtRD(liq.preaviso)],
        ['Vacaciones (' + liq.vacaciones_dias + ' días)', fmtRD(liq.vacaciones)],
        ['Regalía pascual', fmtRD(liq.regalia)]
      ];
      $('liquidacion-detail').innerHTML = items.map(([l, v]) =>
        `<div class="liquidacion-row"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('');
      $('liquidacion-total').textContent = fmtRD(liq.total);
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function showLiquidacion(empId) {
    try {
      const er = await window.api.getEmployee(empId);
      if (!er.ok) throw new Error(er.error);
      const emp = er.data;
      liquidacionEmpId = empId;
      const hoy = new Date();
      $('liq-fecha-baja').value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
      $('liquidacion-subject').textContent =
        `${emp.nombres} ${emp.apellidos} — ${emp.cedula || 's/n'} · ${emp.puesto || 'Sin puesto'} (${emp.departamento || 'Sin depto'})`;
      await recalcularLiquidacion();
      $('liquidacion-modal').classList.remove('hidden');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function confirmLiquidacion() {
    if (!liquidacionEmpId) return;
    try {
      const r = await window.api.confirmarLiquidacion(liquidacionEmpId, $('liq-fecha-baja').value, liquidacionOptions());
      if (!r.ok) throw new Error(r.error);
      toast('Empleado dado de baja y finiquito guardado', 'success');
      closeLiquidacion();
      refreshEmployeeLists();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function closeLiquidacion() {
    $('liquidacion-modal').classList.add('hidden');
    liquidacionEmpId = null;
  }

  /* ============ Finiquito guardado (historial) ============ */
  async function showFiniquito(empId) {
    try {
      const er = await window.api.getEmployee(empId);
      if (!er.ok) throw new Error(er.error);
      const emp = er.data;
      const lr = await window.api.listLiquidaciones(empId);
      if (!lr.ok) throw new Error(lr.error);
      const list = lr.data || [];
      finiquitoEmpId = empId;
      $('finiquito-subject').textContent =
        `${emp.nombres} ${emp.apellidos} — ${emp.cedula || 's/n'}`;
      $('finiquito-list').innerHTML = list.length ? list.map(liquidationCard).join('')
        : '<p class="muted">Este empleado no tiene finiquitos guardados.</p>';
      $('finiquito-modal').classList.remove('hidden');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function liquidationCard(l) {
    const items = [
      ['Fecha de baja', l.fecha_baja || '—'],
      ['Salario mensual', fmtRD(l.salario_mensual)],
      ['Salario diario', fmtRD(l.salario_diario)],
      ['Tiempo de servicio', formatTiempoLaborado({ years: l.tiempo_years, months: l.tiempo_months, days: l.tiempo_days })],
      ['Cesantía (' + l.cesantia_dias + ' días)', fmtRD(l.cesantia)],
      ['Preaviso (' + l.preaviso_dias + ' días)', fmtRD(l.preaviso)],
      ['Vacaciones (' + l.vacaciones_dias + ' días)', fmtRD(l.vacaciones)],
      ['Regalía pascual', fmtRD(l.regalia)]
    ];
    const rows = items.map(([label, val]) =>
      `<div class="liquidacion-row"><span>${esc(label)}</span><b>${esc(val)}</b></div>`).join('');
    return `
      <div class="finiquito-card">
        ${rows}
        <div class="liquidacion-total">
          <span>Total pagado</span>
          <b>${fmtRD(l.total)}</b>
        </div>
        <div class="finiquito-meta muted small">
          Registrado: ${esc(l.created_at || '')}
          ${canEdit() ? `<button class="btn btn-danger btn-sm" data-del-liq="${l.id}">Eliminar</button>` : ''}
        </div>
      </div>`;
  }

  async function deleteLiquidacion(id) {
    if (!confirm('¿Eliminar este finiquito del historial?')) return;
    try {
      const r = await window.api.deleteLiquidacion(id);
      if (!r.ok) throw new Error(r.error);
      toast('Finiquito eliminado', 'success');
      if (finiquitoEmpId) showFiniquito(finiquitoEmpId);
    } catch (e) { toast(e.message, 'error'); }
  }

  /* ============ Historial global de finiquitos ============ */
  async function showHistorialFiniquitos() {
    try {
      const r = await window.api.listAllLiquidaciones();
      if (!r.ok) throw new Error(r.error);
      const list = r.data || [];
      $('historial-empty').classList.toggle('hidden', list.length > 0);
      const tb = $('historial-tbody');
      tb.innerHTML = list.map(l => `
        <tr>
          <td><strong>${esc(l.nombres || '')} ${esc(l.apellidos || '')}</strong>${l.employee_id ? '' : ' <span class="muted small">(empleado eliminado)</span>'}</td>
          <td>${esc(l.cedula || '—')}</td>
          <td>${l.empleado_status === 'activo' ? '🟢 Activo' : l.empleado_status === 'inactivo' ? '🔴 Inactivo' : '<span class="muted">—</span>'}</td>
          <td>${esc(l.fecha_baja || '—')}</td>
          <td>${fmtRD(l.total)}</td>
          <td class="row-actions">
            ${l.employee_id ? `<button class="btn btn-ghost btn-sm" data-ver-liq="${l.employee_id}">Ver</button>` : ''}
          </td>
        </tr>`).join('');
      $('historial-modal').classList.remove('hidden');
    } catch (e) { toast(e.message, 'error'); }
  }

  /* ============ Exportar inactivos a Excel ============ */
  async function exportInactivosExcel() {
    try {
      const res = await window.api.listEmployees('', 'inactivo');
      if (!res.ok) throw new Error(res.error);
      const rows = res.data || [];
      const headers = ['Cédula', 'Nombre completo', 'Sexo', 'Fecha nacimiento', 'Estado civil', 'Puesto', 'Departamento', 'Fecha de baja'];
      const data = rows.map(r => [
        r.cedula || '',
        `${r.nombres || ''} ${r.apellidos || ''}`.trim(),
        r.sexo || '',
        r.fecha_nacimiento || '',
        r.estado_civil || '',
        r.puesto || '',
        r.departamento || '',
        r.fecha_baja || ''
      ]);
      const hoy = new Date();
      const fname = `inactivos_${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
      await doExportExcel(fname, [{
        name: 'Inactivos',
        headers,
        rows: data,
        footer: data.length ? ['', '', '', '', '', '', 'Total', String(rows.length)] : null
      }]);
    } catch (e) { toast(e.message, 'error'); }
  }

  /* ============ Reintegración ============ */
  let reintegrarEmpId = null;
  async function showReintegrar(empId) {
    reintegrarEmpId = empId;
    const hoy = new Date();
    $('reintegrar-fecha').value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    $('reintegrar-mismo-puesto').checked = true;
    $('reintegrar-cambios').classList.add('hidden');
    try {
      const er = await window.api.getEmployee(empId);
      if (er.ok && er.data) {
        $('reintegrar-puesto').value = er.data.puesto || '';
        $('reintegrar-departamento').value = er.data.departamento || '';
        $('reintegrar-sucursal').value = er.data.sucursal || '';
        $('reintegrar-tipo-salario').value = er.data.tipo_salario || 'mensual';
        $('reintegrar-salario').value = er.data.salario || '';
      }
    } catch (e) { /* ignore */ }
    $('reintegrar-modal').classList.remove('hidden');
  }

  async function confirmReintegrar() {
    if (!reintegrarEmpId) return;
    const fecha = $('reintegrar-fecha').value;
    if (!fecha) { toast('Indique la fecha de reintegro', 'error'); return;
    }
    const mismoPuesto = $('reintegrar-mismo-puesto').checked;
    const extra = { fecha_ingreso: isoToDMY(fecha) };
    if (!mismoPuesto) {
      extra.puesto = $('reintegrar-puesto').value.trim();
      extra.departamento = $('reintegrar-departamento').value.trim();
      extra.sucursal = $('reintegrar-sucursal').value.trim();
      extra.tipo_salario = $('reintegrar-tipo-salario').value;
      extra.salario = Number($('reintegrar-salario').value) || 0;
    }
    try {
      const r = await window.api.setEmployeeStatus(reintegrarEmpId, 'activo', extra);
      if (!r.ok) throw new Error(r.error);
      toast(mismoPuesto ? 'Empleado reintegrado con nueva fecha de ingreso' : 'Empleado reintegrado con nuevos datos', 'success');
      closeReintegrar();
      refreshEmployeeLists();
    } catch (e) { toast(e.message, 'error'); }
  }

  function closeReintegrar() {
    $('reintegrar-modal').classList.add('hidden');
    reintegrarEmpId = null;
  }

  /* ============ Permisos y vacaciones ============ */
  async function renderVacaciones(empId, editable) {
    const sec = $('vacaciones-section');
    if (!empId) {
      sec.innerHTML = '<p class="muted">Guarde primero el expediente para gestionar permisos y vacaciones.</p>';
      return;
    }
    const dis = editable ? '' : 'disabled';
    sec.innerHTML = `
      <div class="vac-form">
        <select id="v-tipo" ${dis}>
          <option value="vacaciones">Vacaciones</option>
          <option value="permiso">Permiso</option>
          <option value="enfermedad">Licencia por enfermedad</option>
        </select>
        <label>Modalidad
          <select id="v-modalidad" ${dis}>
            <option value="tomadas">Tomó las vacaciones</option>
            <option value="pagadas">Se le pagaron (todas)</option>
            <option value="pagadas_parcial">Pagadas parcialmente</option>
          </select>
        </label>
        <label>Desde <input id="v-inicio" type="date" ${dis} /></label>
        <label>Hasta <input id="v-fin" type="date" ${dis} /></label>
        <label id="v-dias-wrap">Días <input id="v-dias" type="number" min="0" step="0.5" value="1" ${dis} /></label>
        <label id="v-pag-wrap" class="hidden">Días pagados <input id="v-dias-pagados" type="number" min="0" step="0.5" value="0" ${dis} /></label>
        <label id="v-guard-wrap" class="hidden">Días guardados <input id="v-dias-guardados" type="number" min="0" step="0.5" value="0" ${dis} /></label>
        <input id="v-motivo" type="text" placeholder="Motivo / observaciones" ${dis} />
        <button class="btn btn-primary btn-sm" id="btn-v-add" ${dis}>Agregar</button>
      </div>
      <p class="muted small" id="v-pag-hint" style="margin:6px 0"></p>
      <table class="table">
        <thead><tr><th>Tipo</th><th>Modalidad</th><th>Desde</th><th>Hasta</th><th>Días</th><th>Motivo</th><th>Estado</th><th></th></tr></thead>
        <tbody id="vacaciones-tbody"></tbody>
      </table>`;
    function modalidadLabel(v) {
      if (v.modalidad === 'pagadas') return 'Pagadas';
      if (v.modalidad === 'pagadas_parcial') return 'Pagadas ' + esc(v.dias_pagados) + ' · Guardadas ' + esc(v.dias_guardados);
      return 'Tomadas';
    }
    const vSel = $('v-modalidad');
    if (vSel) {
      const syncModalidad = () => {
        const m = vSel.value;
        $('v-dias-wrap').classList.toggle('hidden', m === 'pagadas_parcial');
        $('v-pag-wrap').classList.toggle('hidden', m !== 'pagadas_parcial');
        $('v-guard-wrap').classList.toggle('hidden', m !== 'pagadas_parcial');
        $('v-pag-hint').textContent = m === 'pagadas'
          ? 'Se pagarán todos los días indicados.'
          : m === 'pagadas_parcial'
            ? 'Total = días pagados + días guardados. Los días guardados quedan disponibles para otro momento.'
            : '';
      };
      vSel.addEventListener('change', syncModalidad);
      ['v-dias-pagados', 'v-dias-guardados'].forEach(id => {
        const el = $(id);
        if (el) el.addEventListener('input', () => {
          const p = Number($('v-dias-pagados').value) || 0;
          const g = Number($('v-dias-guardados').value) || 0;
          $('v-dias').value = p + g;
        });
      });
      syncModalidad();
    }
    try {
      const res = await window.api.listVacaciones(empId);
      if (!res.ok) throw new Error(res.error);
      const rows = res.data;
      $('vacaciones-tbody').innerHTML = rows.length ? rows.map(v => `
        <tr>
          <td>${esc(v.tipo)}</td>
          <td>${modalidadLabel(v)}</td>
          <td>${esc(v.fecha_inicio || '—')}</td>
          <td>${esc(v.fecha_fin || '—')}</td>
          <td>${esc(v.dias)}</td>
          <td>${esc(v.motivo || '')}</td>
          <td>${v.aprobado ? '<span class="badge-ok">Aprobado</span>' : '<span class="badge-warn">Pendiente</span>'}</td>
          <td class="row-actions">${editable ? `<button class="btn btn-danger btn-sm" data-vdel="${v.id}">✕</button>` : ''}</td>
        </tr>`).join('')
        : '<tr><td colspan="8" class="muted center">Sin permisos ni vacaciones registrados.</td></tr>';
      $('vacaciones-tbody').querySelectorAll('[data-vdel]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este registro?')) return;
        try {
          const r = await window.api.deleteVacacion(Number(b.dataset.vdel));
          if (!r.ok) throw new Error(r.error);
          toast('Registro eliminado', 'success');
          renderVacaciones(empId, editable);
        } catch (e) { toast(e.message, 'error'); }
      }));
      const addBtn = $('btn-v-add');
      if (addBtn) addBtn.addEventListener('click', async () => {
        try {
          const modalidad = $('v-modalidad').value;
          let dias = Number($('v-dias').value) || 0;
          let diasPagados = 0, diasGuardados = 0;
          if (modalidad === 'pagadas') {
            if (dias <= 0) throw new Error('Indique cuántos días de vacaciones se pagan');
            diasPagados = dias;
          } else if (modalidad === 'pagadas_parcial') {
            diasPagados = Number($('v-dias-pagados').value) || 0;
            diasGuardados = Number($('v-dias-guardados').value) || 0;
            if (diasPagados <= 0 && diasGuardados <= 0) throw new Error('Indique los días pagados y/o guardados');
            dias = diasPagados + diasGuardados;
          } else {
            if (dias <= 0) throw new Error('Indique los días de vacaciones');
          }
          const data = {
            employee_id: empId,
            tipo: $('v-tipo').value,
            modalidad,
            fecha_inicio: $('v-inicio').value,
            fecha_fin: $('v-fin').value,
            dias,
            dias_pagados: diasPagados,
            dias_guardados: diasGuardados,
            motivo: $('v-motivo').value,
            aprobado: 1
          };
          if (!data.fecha_inicio) throw new Error('Indique la fecha de inicio');
          const r = await window.api.createVacacion(data);
          if (!r.ok) throw new Error(r.error);
          toast('Permiso / vacación agregado', 'success');
          renderVacaciones(empId, editable);
        } catch (e) { toast(e.message, 'error'); }
      });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  /* ============ Nómina ============ */
  let lastNominaData = null;
  let nominaEmployees = [];
  async function loadNomina() {
    const mes = Number($('nomina-mes').value) || new Date().getMonth() + 1;
    const anio = Number($('nomina-anio').value) || new Date().getFullYear();
    const sel = $('nomina-emp');
    const prev = sel.value;
    const deptSel = $('nomina-depto');
    const prevDept = deptSel.value;
    try {
      const empRes = await window.api.listEmployees('', 'activo');
      if (empRes.ok) {
        nominaEmployees = empRes.data;
        const opts = '<option value="">Todos los empleados</option>' +
          nominaEmployees.map(e => `<option value="${e.id}">${esc(e.nombres)} ${esc(e.apellidos)}</option>`).join('');
        if (sel.innerHTML !== opts) sel.innerHTML = opts;
        if (prev && nominaEmployees.some(e => String(e.id) === prev)) sel.value = prev;
        const depts = [...new Set(nominaEmployees.map(e => (e.departamento || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        const deptOpts = '<option value="">Todos los departamentos</option>' +
          depts.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
        if (deptSel.innerHTML !== deptOpts) deptSel.innerHTML = deptOpts;
        if (prevDept && depts.some(d => d === prevDept)) deptSel.value = prevDept;
      }
    } catch (e) { /* el cálculo mostrará el error */ }
    const empId = sel.value ? Number(sel.value) : null;
    const depto = deptSel.value || null;
    $('regalia-card').classList.add('hidden');
    const ec = $('extra-card');
    ec.classList.toggle('hidden', !empId);
    const vpc = $('vac-pago-card');
    vpc.classList.toggle('hidden', !empId);
    if (empId) {
      const emp = nominaEmployees.find(e => e.id === empId);
      $('extra-emp-name').textContent = emp ? `${emp.nombres} ${emp.apellidos}` : `#${empId}`;
      $('vp-emp-name').textContent = emp ? `${emp.nombres} ${emp.apellidos}` : `#${empId}`;
      try {
        const hx = await window.api.getHorasExtra(empId, mes, anio);
        if (hx.ok) {
          $('he-horas').value = hx.data.horas_extra || 0;
          $('he-domingos').value = hx.data.domingos_extra || 0;
          $('he-feriados').value = hx.data.feriados_extra || 0;
          $('he-otros').value = hx.data.otros_ingresos || 0;
          $('he-nota').value = hx.data.nota || '';
        }
      } catch (e) { /* sin extras guardadas */ }
      await renderIncentivos(empId, mes, anio);
      await renderDeducciones(empId, mes, anio);
      await renderPagoVacaciones(empId, mes, anio);
    }
    await renderNominaVista($('nomina-vista').value, mes, anio, empId, depto);
  }

  // Definición de las vistas de nómina (formas de pago). Cada vista comparte el
  // desglose base (salario, horas/domingos/feriados, extras RD$, otros, incentivo,
  // vacaciones) y añade sus columnas específicas (pagos parciales / totales).
  // C(t, v, strong): describe una celda. t = 'texto' | 'num' | 'money'.
  function C(t, v, strong) { return { t, v, strong }; }
  function nomColHtml(c) {
    if (c.t === 'money') return `<td class="num">${c.strong ? `<strong>${fmtRD(c.v)}</strong>` : fmtRD(c.v)}</td>`;
    if (c.t === 'num') return `<td class="num">${Number(c.v) || 0}</td>`;
    return `<td>${esc(c.v == null ? '' : c.v)}</td>`;
  }
  function nomColValue(c) {
    if (c.t === 'money' || c.t === 'num') return Number(c.v) || 0;
    return c.v == null ? '' : String(c.v);
  }

  const NOMINA_VIEWS = {
    mensual: {
      label: 'Mensual',
      fetch: (mes, anio, empId, depto) => window.api.calcularNomina(mes, anio, empId, depto),
      headers: ['Empleado', 'Cédula', 'Departamento', 'Salario', 'Hrs. extra', 'Domingos', 'Feriados', 'Extras RD$', 'Otros RD$', 'Incentivo RD$', 'Vacaciones RD$', 'Bruto', 'AFP', 'SFS', 'ISR', 'Retenciones', 'Neto a pagar'],
      cols: (r) => [
        C('texto', `${r.nombres} ${r.apellidos}`), C('texto', r.cedula || '—'), C('texto', r.departamento || ''),
        C('money', r.salario), C('num', r.horas_extra), C('num', r.domingos_extra), C('num', r.feriados_extra),
        C('money', r.extra), C('money', r.otros_ingresos), C('money', r.incentivo), C('money', r.vacaciones_pago),
        C('money', r.bruto), C('money', r.afp), C('money', r.sfs), C('money', r.isr), C('money', r.retenciones),
        C('money', r.neto, true)
      ],
      totCols: (t) => [
        C('texto', ''), C('texto', ''), C('texto', 'Totales'),
        C('money', t.salario), C('texto', ''), C('texto', ''), C('texto', ''),
        C('money', t.extra), C('money', t.otros_ingresos), C('money', t.incentivo), C('money', t.vacaciones),
        C('money', t.bruto), C('money', t.afp), C('money', t.sfs), C('money', t.isr), C('money', t.retenciones),
        C('money', t.neto, true)
      ],
      cards: (t, count) => [
        ['Empleados', count, ''],
        ['Salario base', fmtRD(t.salario), ''],
        ['Horas/domingos/feriados', fmtRD(t.extra), ''],
        ['Otros ingresos', fmtRD(t.otros_ingresos), ''],
        ['Incentivos', fmtRD(t.incentivo), ''],
        ['Vacaciones', fmtRD(t.vacaciones), ''],
        ['Bruto', fmtRD(t.bruto), ''],
        ['Total AFP', fmtRD(t.afp), ''],
        ['Total SFS', fmtRD(t.sfs), ''],
        ['Total ISR', fmtRD(t.isr), ''],
        ['Total retenciones', fmtRD(t.retenciones), ''],
        ['Neto a pagar', fmtRD(t.neto), ' stat-net']
      ]
    },
    quincenal: {
      label: 'Quincenal',
      fetch: (mes, anio, empId, depto) => window.api.calcularNominaQuincenal(mes, anio, empId, depto),
      headers: ['Empleado', 'Cédula', 'Departamento', 'Salario', 'Hrs. extra', 'Domingos', 'Feriados', 'Extras RD$', 'Otros RD$', 'Incentivo RD$', 'Vacaciones RD$', 'Deducciones RD$', '1ra quincena', '2da quincena (bruto)', 'AFP', 'SFS', 'ISR', 'Retenciones', '2da quincena (neto)', 'Total neto'],
      cols: (r) => [
        C('texto', `${r.nombres} ${r.apellidos}`), C('texto', r.cedula || '—'), C('texto', r.departamento || ''),
        C('money', r.salario), C('num', r.horas_extra), C('num', r.domingos_extra), C('num', r.feriados_extra),
        C('money', r.extra), C('money', r.otros_ingresos), C('money', r.incentivo), C('money', r.vacaciones_pago),
        C('money', r.deducciones_manuales),
        C('money', r.quincena1), C('money', r.quincena2_bruto),
        C('money', r.afp), C('money', r.sfs), C('money', r.isr), C('money', r.retenciones),
        C('money', r.quincena2_neto), C('money', r.total_neto, true)
      ],
      totCols: (t) => [
        C('texto', ''), C('texto', ''), C('texto', 'Totales'),
        C('money', t.salario), C('texto', ''), C('texto', ''), C('texto', ''),
        C('money', t.extra), C('money', t.otros_ingresos), C('money', t.incentivo), C('money', t.vacaciones),
        C('money', t.deducciones_manuales),
        C('money', t.quincena1), C('money', t.quincena2_bruto),
        C('money', t.afp), C('money', t.sfs), C('money', t.isr), C('money', t.retenciones),
        C('money', t.quincena2_neto), C('money', t.neto, true)
      ],
      cards: (t, count) => [
        ['Empleados', count, ''],
        ['Salario base', fmtRD(t.salario), ''],
        ['Horas/domingos/feriados', fmtRD(t.extra), ''],
        ['Otros ingresos', fmtRD(t.otros_ingresos), ''],
        ['Incentivos', fmtRD(t.incentivo), ''],
        ['Vacaciones', fmtRD(t.vacaciones), ''],
        ['Deducciones manuales', fmtRD(t.deducciones_manuales), ''],
        ['1ra quincena', fmtRD(t.quincena1), ''],
        ['2da quincena (bruto)', fmtRD(t.quincena2_bruto), ''],
        ['Total retenciones', fmtRD(t.retenciones), ''],
        ['2da quincena (neto)', fmtRD(t.quincena2_neto), ''],
        ['Total neto', fmtRD(t.neto), ' stat-net']
      ]
    },
    semanal: {
      label: 'Semanal',
      fetch: (mes, anio, empId, depto) => window.api.calcularNominaSemanal(mes, anio, empId, depto),
      headers: ['Empleado', 'Cédula', 'Departamento', 'Salario', 'Hrs. extra', 'Domingos', 'Feriados', 'Extras RD$', 'Otros RD$', 'Incentivo RD$', 'Vacaciones RD$', 'Sem. 1-3 (neto)', 'Última sem. (bruto)', 'AFP', 'SFS', 'ISR', 'Retenciones', 'Última sem. (neto)', 'Total neto'],
      cols: (r) => [
        C('texto', `${r.nombres} ${r.apellidos}`), C('texto', r.cedula || '—'), C('texto', r.departamento || ''),
        C('money', r.salario), C('num', r.horas_extra), C('num', r.domingos_extra), C('num', r.feriados_extra),
        C('money', r.extra), C('money', r.otros_ingresos), C('money', r.incentivo), C('money', r.vacaciones_pago),
        C('money', Math.round((Number(r.semana_neto) || 0) * 3 * 100) / 100), C('money', r.ultima_bruto),
        C('money', r.afp), C('money', r.sfs), C('money', r.isr), C('money', r.retenciones),
        C('money', r.ultima_neto), C('money', r.total_neto, true)
      ],
      totCols: (t) => [
        C('texto', ''), C('texto', ''), C('texto', 'Totales'),
        C('money', t.salario), C('texto', ''), C('texto', ''), C('texto', ''),
        C('money', t.extra), C('money', t.otros_ingresos), C('money', t.incentivo), C('money', t.vacaciones),
        C('texto', ''), C('texto', ''),
        C('money', t.afp), C('money', t.sfs), C('money', t.isr), C('money', t.retenciones),
        C('texto', ''), C('money', t.neto, true)
      ],
      cards: (t, count) => [
        ['Empleados', count, ''],
        ['Salario base', fmtRD(t.salario), ''],
        ['Horas/domingos/feriados', fmtRD(t.extra), ''],
        ['Otros ingresos', fmtRD(t.otros_ingresos), ''],
        ['Incentivos', fmtRD(t.incentivo), ''],
        ['Vacaciones', fmtRD(t.vacaciones), ''],
        ['Bruto', fmtRD(t.bruto), ''],
        ['Total AFP', fmtRD(t.afp), ''],
        ['Total SFS', fmtRD(t.sfs), ''],
        ['Total ISR', fmtRD(t.isr), ''],
        ['Total retenciones', fmtRD(t.retenciones), ''],
        ['Total neto', fmtRD(t.neto), ' stat-net']
      ]
    },
    diario: {
      label: 'Diario',
      fetch: (mes, anio, empId, depto) => window.api.calcularNominaDiaria(mes, anio, empId, depto),
      headers: ['Empleado', 'Cédula', 'Departamento', 'Salario', 'Salario diario', 'Hrs. extra', 'Domingos', 'Feriados', 'Extras RD$', 'Otros RD$', 'Incentivo RD$', 'Vacaciones RD$', 'Bruto', 'AFP', 'SFS', 'ISR', 'Retenciones', 'Neto a pagar'],
      cols: (r) => [
        C('texto', `${r.nombres} ${r.apellidos}`), C('texto', r.cedula || '—'), C('texto', r.departamento || ''),
        C('money', r.salario), C('money', r.salario_diario),
        C('num', r.horas_extra), C('num', r.domingos_extra), C('num', r.feriados_extra),
        C('money', r.extra), C('money', r.otros_ingresos), C('money', r.incentivo), C('money', r.vacaciones_pago),
        C('money', r.bruto), C('money', r.afp), C('money', r.sfs), C('money', r.isr), C('money', r.retenciones),
        C('money', r.neto, true)
      ],
      totCols: (t) => [
        C('texto', ''), C('texto', ''), C('texto', 'Totales'),
        C('money', t.salario), C('texto', ''),
        C('texto', ''), C('texto', ''), C('texto', ''),
        C('money', t.extra), C('money', t.otros_ingresos), C('money', t.incentivo), C('money', t.vacaciones),
        C('money', t.bruto), C('money', t.afp), C('money', t.sfs), C('money', t.isr), C('money', t.retenciones),
        C('money', t.neto, true)
      ],
      cards: (t, count) => [
        ['Empleados', count, ''],
        ['Salario base', fmtRD(t.salario), ''],
        ['Horas/domingos/feriados', fmtRD(t.extra), ''],
        ['Otros ingresos', fmtRD(t.otros_ingresos), ''],
        ['Incentivos', fmtRD(t.incentivo), ''],
        ['Vacaciones', fmtRD(t.vacaciones), ''],
        ['Bruto', fmtRD(t.bruto), ''],
        ['Total AFP', fmtRD(t.afp), ''],
        ['Total SFS', fmtRD(t.sfs), ''],
        ['Total ISR', fmtRD(t.isr), ''],
        ['Total retenciones', fmtRD(t.retenciones), ''],
        ['Neto a pagar', fmtRD(t.neto), ' stat-net']
      ]
    }
  };

  async function renderNominaVista(vista, mes, anio, empId, depto) {
    const def = NOMINA_VIEWS[vista] || NOMINA_VIEWS.mensual;
    $('nomina-table-card').classList.remove('hidden');
    try {
      const res = await def.fetch(mes, anio, empId, depto);
      if (!res.ok) throw new Error(res.error);
      const data = res.data;
      lastNominaData = { vista, data };
      $('nomina-empty').classList.toggle('hidden', data.rows.length > 0);
      $('nomina-thead').innerHTML = `<tr>${def.headers.map(h => `<th>${esc(h)}</th>`).join('')}<th></th></tr>`;
      const tb = $('nomina-tbody');
      tb.innerHTML = data.rows.length ? data.rows.map(r =>
        `<tr>${def.cols(r).map(nomColHtml).join('')}<td class="row-actions">${empId ? '' : `<button class="btn btn-ghost btn-sm" data-he="${r.id}">⏱ Extras</button>`}</td></tr>`).join('') : '';
      tb.querySelectorAll('[data-he]').forEach(b => b.addEventListener('click', () => {
        $('nomina-emp').value = b.dataset.he;
        loadNomina();
      }));
      const t = data.totales;
      $('nomina-tfoot').innerHTML = data.rows.length
        ? `<tr>${def.totCols(t).map(nomColHtml).join('')}<td></td></tr>`
        : '';
      const cards = def.cards(t, data.rows.length);
      $('nomina-totals').innerHTML = cards.map(([l, v, cls]) =>
        `<div class="card stat-card"><div class="stat-label">${esc(l)}</div><div class="stat-value${cls}">${esc(v)}</div></div>`).join('');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function saveHorasExtra() {
    const empId = Number($('nomina-emp').value);
    if (!empId) { toast('Seleccione un empleado', 'error'); return; }
    const mes = Number($('nomina-mes').value) || new Date().getMonth() + 1;
    const anio = Number($('nomina-anio').value) || new Date().getFullYear();
    try {
      const res = await window.api.saveHorasExtra({
        employee_id: empId,
        mes, anio,
        horas_extra: Number($('he-horas').value) || 0,
        domingos_extra: Number($('he-domingos').value) || 0,
        feriados_extra: Number($('he-feriados').value) || 0,
        otros_ingresos: Number($('he-otros').value) || 0,
        nota: $('he-nota').value
      });
      if (!res.ok) throw new Error(res.error);
      toast('Horas extra guardadas', 'success');
      loadNomina();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function renderIncentivos(empId, mes, anio) {
    const tb = $('incentivos-tbody');
    if (!tb) return;
    tb.innerHTML = '';
    $('inc-total').textContent = 'RD$ 0.00';
    if (!empId) return;
    try {
      const res = await window.api.listIncentivos(empId, mes, anio);
      if (!res.ok) throw new Error(res.error);
      const list = res.data || [];
      let total = 0;
      tb.innerHTML = list.length ? list.map(i => {
        total += Number(i.monto) || 0;
        return `<tr>
          <td class="num">${fmtRD(i.monto)}</td>
          <td>${esc(i.motivo || '')}</td>
          <td class="row-actions"><button class="btn btn-ghost btn-sm" title="Eliminar" data-inc-del="${i.id}">✕</button></td>
        </tr>`;
      }).join('') : '<tr><td colspan="3" class="muted center">Sin incentivos registrados en este período.</td></tr>';
      $('inc-total').textContent = fmtRD(total);
      tb.querySelectorAll('[data-inc-del]').forEach(b => b.addEventListener('click', async () => {
        try {
          const r = await window.api.deleteIncentivo(Number(b.dataset.incDel));
          if (!r.ok) throw new Error(r.error);
          toast('Incentivo eliminado', 'success');
          renderIncentivos(empId, mes, anio);
          loadNomina();
        } catch (e) { toast(e.message, 'error'); }
      }));
    } catch (e) { toast(e.message, 'error'); }
  }

  async function addIncentivo() {
    const empId = Number($('nomina-emp').value);
    if (!empId) { toast('Seleccione un empleado', 'error'); return; }
    const mes = Number($('nomina-mes').value) || new Date().getMonth() + 1;
    const anio = Number($('nomina-anio').value) || new Date().getFullYear();
    const monto = Number($('inc-monto').value);
    const motivo = $('inc-motivo').value.trim();
    if (!(monto > 0)) { toast('Ingrese un monto mayor que 0', 'error'); return; }
    if (!motivo) { toast('Indique qué hizo el empleado', 'error'); return; }
    try {
      const res = await window.api.createIncentivo({ employee_id: empId, mes, anio, monto, motivo });
      if (!res.ok) throw new Error(res.error);
      toast('Incentivo agregado', 'success');
      $('inc-monto').value = '';
      $('inc-motivo').value = '';
      renderIncentivos(empId, mes, anio);
      loadNomina();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function renderDeducciones(empId, mes, anio) {
    const tb = $('deducciones-tbody');
    if (!tb) return;
    tb.innerHTML = '';
    $('ded-total').textContent = 'RD$ 0.00';
    if (!empId) return;
    try {
      const res = await window.api.listDeducciones(empId, mes, anio);
      if (!res.ok) throw new Error(res.error);
      const list = res.data || [];
      let total = 0;
      tb.innerHTML = list.length ? list.map(d => {
        total += Number(d.monto) || 0;
        const qLabel = d.quincena === 1 ? '1ra' : d.quincena === 2 ? '2da' : 'Todas';
        return `<tr>
          <td class="num">${fmtRD(d.monto)}</td>
          <td>${qLabel}</td>
          <td>${esc(d.motivo || '')}</td>
          <td class="row-actions"><button class="btn btn-ghost btn-sm" title="Eliminar" data-ded-del="${d.id}">✕</button></td>
        </tr>`;
      }).join('') : '<tr><td colspan="4" class="muted center">Sin deducciones registradas en este período.</td></tr>';
      $('ded-total').textContent = fmtRD(total);
      tb.querySelectorAll('[data-ded-del]').forEach(b => b.addEventListener('click', async () => {
        try {
          const r = await window.api.deleteDeduccion(Number(b.dataset.dedDel));
          if (!r.ok) throw new Error(r.error);
          toast('Deducción eliminada', 'success');
          renderDeducciones(empId, mes, anio);
          loadNomina();
        } catch (e) { toast(e.message, 'error'); }
      }));
    } catch (e) { toast(e.message, 'error'); }
  }

  async function addDeduccion() {
    const empId = Number($('nomina-emp').value);
    if (!empId) { toast('Seleccione un empleado', 'error'); return; }
    const mes = Number($('nomina-mes').value) || new Date().getMonth() + 1;
    const anio = Number($('nomina-anio').value) || new Date().getFullYear();
    const monto = Number($('ded-monto').value);
    const motivo = $('ded-motivo').value.trim();
    const quincena = Number($('ded-quincena').value) || 0;
    if (!(monto > 0)) { toast('Ingrese un monto mayor que 0', 'error'); return; }
    if (!motivo) { toast('Indique el motivo de la deducción', 'error'); return; }
    try {
      const res = await window.api.createDeduccion({ employee_id: empId, mes, anio, quincena, monto, motivo });
      if (!res.ok) throw new Error(res.error);
      toast('Deducción agregada', 'success');
      $('ded-monto').value = '';
      $('ded-motivo').value = '';
      renderDeducciones(empId, mes, anio);
      loadNomina();
    } catch (e) { toast(e.message, 'error'); }
  }

  let vpDiario = 0;
  async function renderPagoVacaciones(empId, mes, anio) {
    if (!empId) return;
    try {
      const res = await window.api.getResumenPagoVacaciones(empId, mes, anio);
      if (!res.ok) throw new Error(res.error);
      const d = res.data;
      vpDiario = Number(d.salario_diario) || 0;
      $('vp-disponibles').value = d.disponibles;
      $('vp-diario').value = vpDiario.toLocaleString('es-DO', { maximumFractionDigits: 2 });
      const p = d.periodo || {};
      $('vp-modalidad').value = p.modalidad === 'completo' ? 'completo' : 'personalizada';
      const diasIni = Number(p.dias) || 0;
      $('vp-dias').value = diasIni;
      $('vp-dias').readOnly = $('vp-modalidad').value === 'completo';
      $('vp-monto').value = fmtRD(p.monto || 0);
      $('vp-nota').value = p.nota || '';
      $('btn-vp-delete').classList.toggle('hidden', !diasIni);
      $('vp-msg').textContent = d.guardados > 0
        ? `${d.guardados} día(s) guardados en el expediente · ${d.pagados_dias} ya pagados en nómina · ${d.disponibles} disponibles.`
        : 'Sin días guardados en el expediente. Use la modalidad personalizada o registre antes los días como "pagadas parcialmente".';
      if (!diasIni) recalcVpMonto();
    } catch (e) {
      $('vp-msg').textContent = e.message;
    }
  }

  function recalcVpMonto() {
    const dias = Number($('vp-dias').value) || 0;
    const monto = Math.round((dias * vpDiario) * 100) / 100;
    $('vp-monto').value = fmtRD(monto);
  }

  async function savePagoVacaciones() {
    const empId = Number($('nomina-emp').value);
    if (!empId) { toast('Seleccione un empleado', 'error'); return; }
    const mes = Number($('nomina-mes').value) || new Date().getMonth() + 1;
    const anio = Number($('nomina-anio').value) || new Date().getFullYear();
    const modalidad = $('vp-modalidad').value;
    const dias = Number($('vp-dias').value);
    if (!(dias > 0)) { toast('Indique los días a pagar', 'error'); return; }
    try {
      const res = await window.api.savePagoVacaciones({
        employee_id: empId, mes, anio, dias,
        modalidad, nota: $('vp-nota').value
      });
      if (!res.ok) throw new Error(res.error);
      toast('Pago de vacaciones guardado', 'success');
      loadNomina();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function deletePagoVacaciones() {
    const empId = Number($('nomina-emp').value);
    const mes = Number($('nomina-mes').value) || new Date().getMonth() + 1;
    const anio = Number($('nomina-anio').value) || new Date().getFullYear();
    if (!confirm('¿Eliminar el pago de vacaciones de este período?')) return;
    try {
      const res = await window.api.getResumenPagoVacaciones(empId, mes, anio);
      if (!res.ok || !res.data || !res.data.periodo || !res.data.periodo.id) { toast('No hay pago para eliminar', 'error'); return; }
      const del = await window.api.deletePagoVacacion(Number(res.data.periodo.id));
      if (!del.ok) throw new Error(del.error);
      toast('Pago de vacaciones eliminado', 'success');
      loadNomina();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function doExportExcel(filename, sheets) {
    try {
      const res = await window.api.exportExcel(filename, sheets);
      if (!res.ok) throw new Error(res.error);
      if (res.data) toast('Excel guardado: ' + res.data, 'success', 5000);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function exportCedulaPdf() {
    if (!modalRecord || !modalRecord.id) return;
    try {
      const res = await window.api.exportCedulaPdf(modalRecord.id);
      if (!res.ok) throw new Error(res.error);
      if (res.data) toast('PDF guardado: ' + res.data, 'success', 5000);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function exportConstancia() {
    if (!modalRecord || !modalRecord.id) return;
    const fmt = $('sel-export-format').value;
    try {
      const res = await window.api.exportConstanciaPdf(modalRecord.id, fmt);
      if (!res.ok) throw new Error(res.error);
      if (res.data) toast((fmt === 'docx' ? 'Word' : 'PDF') + ' guardado: ' + res.data, 'success', 5000);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function exportCartaSalario() {
    if (!modalRecord || !modalRecord.id) return;
    const fmt = $('sel-export-format').value;
    try {
      const res = await window.api.exportCartaSalarioPdf(modalRecord.id, fmt);
      if (!res.ok) throw new Error(res.error);
      if (res.data) toast((fmt === 'docx' ? 'Word' : 'PDF') + ' guardado: ' + res.data, 'success', 5000);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function exportSolicitud() {
    if (!modalRecord || !modalRecord.id) return;
    const fmt = $('sel-export-format').value;
    try {
      const res = await window.api.exportSolicitudPdf(modalRecord.id, fmt);
      if (!res.ok) throw new Error(res.error);
      if (res.data) toast((fmt === 'docx' ? 'Word' : 'PDF') + ' guardado: ' + res.data, 'success', 5000);
    } catch (e) { toast(e.message, 'error'); }
  }

  const HISTORIAL_LABELS = {
    cedula: 'Cédula', nombres: 'Nombres', apellidos: 'Apellidos', sexo: 'Sexo',
    fecha_nacimiento: 'Fecha de nacimiento', nacionalidad: 'Nacionalidad', lugar_nacimiento: 'Lugar de nacimiento',
    ciudad: 'Ciudad de residencia',
    estado_civil: 'Estado civil', profesion: 'Profesión', tipo_sangre: 'Tipo de sangre',
    puesto: 'Puesto', departamento: 'Departamento', sucursal: 'Sucursal',
    fecha_vencimiento: 'Fecha vencimiento cédula', nota: 'Observaciones', salario: 'Salario',
    tipo_salario: 'Tipo de salario', fecha_ingreso: 'Fecha de ingreso', nss: 'NSS',
    ars: 'ARS', afp: 'AFP', email: 'Correo', telefono: 'Teléfono', flota: 'Flota',
    banco: 'Banco', cuenta: 'Cuenta', tipo_contrato: 'Tipo de contrato', status: 'Estado'
  };

  async function loadHistorial(id) {
    const box = $('hoja-vida-section');
    if (!id) { box.innerHTML = '<p class="muted">Guarde primero el expediente para ver el historial de cambios.</p>'; return; }
    try {
      const res = await window.api.historialList(id);
      if (!res.ok) throw new Error(res.error);
      const items = res.data || [];
      if (!items.length) { box.innerHTML = '<p class="muted">Sin cambios registrados todavía.</p>'; return; }
      box.innerHTML = '<div class="timeline">' + items.map(h => `
        <div class="timeline-item">
          <div class="timeline-head"><strong>${esc(HISTORIAL_LABELS[h.campo] || h.campo)}</strong>
            <span class="muted small">${esc(h.created_at)}${h.autor ? ' · ' + esc(h.autor) : ''}</span></div>
          <div class="timeline-body">
            <span class="muted small">${h.valor_anterior ? '<s>' + esc(h.valor_anterior) + '</s>' : '(nuevo)'}</span>
            <span class="muted">→</span>
            <span>${esc(h.valor_nuevo)}</span>
          </div>
        </div>`).join('') + '</div>';
    } catch (e) { box.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; }
  }

  async function exportCedulasPdf() {
    try {
      const res = await window.api.exportCedulasPdf();
      if (!res.ok) throw new Error(res.error);
      if (res.data) toast('PDF guardado: ' + res.data, 'success', 5000);
    } catch (e) { toast(e.message, 'error'); }
  }

  // La fila de Excel usa los mismos valores de la vista, sin el HTML de la tabla.
  function nominaViewExcelRow(def, r) {
    return def.cols(r).map(nomColValue);
  }

  // Convierte una fila en su "footer" de subtotal: 'Subtotal depto' + sumas por columna.
  function subtotalRow(label, headers, firstRow) {
    const row = [label];
    for (let i = 1; i < headers.length; i++) {
      row.push(null); // lo llenamos con las sumas
    }
    return { row, firstRow, label };
  }

  function fillSubtotal(sub, rowsByDept, headers) {
    // sub: { row, firstRow } — firstRow define qué columnas sumar (numericas).
    const first = sub.firstRow || [];
    for (let i = 0; i < headers.length; i++) {
      if (i === 0) continue;
      const isNumeric = typeof first[i] === 'number' && !isNaN(first[i]);
      if (isNumeric) {
        sub.row[i] = Math.round(rowsByDept.reduce((a, r) => a + (Number(r[i]) || 0), 0) * 100) / 100;
      } else {
        sub.row[i] = '';
      }
    }
    return sub.row;
  }

  function groupNominaByDept(rows, rowFn, headers) {
    const groups = {};
    for (const r of rows) {
      const dept = (r.departamento || '').trim() || '(Sin departamento)';
      if (!groups[dept]) groups[dept] = [];
      groups[dept].push(rowFn(r));
    }
    const tables = Object.keys(groups).sort((a, b) => a.localeCompare(b)).map(dept => {
      const deptRows = groups[dept];
      const sub = subtotalRow('Subtotal ' + dept, headers, deptRows[0]);
      return { title: dept, headers, rows: deptRows, footer: fillSubtotal(sub, deptRows, headers) };
    });
    const all = [];
    for (const dept of Object.keys(groups).sort((a, b) => a.localeCompare(b))) all.push(...groups[dept]);
    const grand = subtotalRow(null, headers, all[0]);
    return { tables, grandTotal: fillSubtotal(grand, all, headers).slice(1) };
  }

  async function exportNominaExcel() {
    const mes = Number($('nomina-mes').value) || new Date().getMonth() + 1;
    const anio = Number($('nomina-anio').value) || new Date().getFullYear();
    const depto = $('nomina-depto').value || null;
    const vista = $('nomina-vista').value;
    if (!lastNominaData || lastNominaData.vista !== vista || !lastNominaData.data.rows.length) {
      toast('Calcule primero la nómina', 'error');
      return;
    }
    const def = NOMINA_VIEWS[vista] || NOMINA_VIEWS.mensual;
    const headers = def.headers;
    const g = groupNominaByDept(lastNominaData.data.rows, (r) => nominaViewExcelRow(def, r), headers);
    const t = lastNominaData.data.totales;
    const nom = `${vista === 'mensual' ? '' : vista + '_'}${mes}_${anio}`;
    const title = vista === 'mensual'
      ? `Nómina ${MESES_ES[mes - 1]} ${anio}`
      : `Nómina ${def.label.toLowerCase()} ${MESES_ES[mes - 1]} ${anio}`;
    return doExportExcel(`nomina_${nom}`, [{
      name: `${def.label} ${mes}/${anio}`,
      title,
      tables: g.tables,
      grandTotal: g.grandTotal
    }]);
  }

  /* ============ Regalía pascual ============ */
  let lastRegalia = null;
  async function loadRegalia() {
    const anio = Number($('nomina-anio').value) || new Date().getFullYear();
    try {
      const res = await window.api.calcularRegalia(anio);
      if (!res.ok) throw new Error(res.error);
      const data = res.data;
      lastRegalia = data;
      $('regalia-period').textContent = data.periodo;
      $('regalia-tbody').innerHTML = data.rows.length ? data.rows.map(r => {
        let cambiosHtml = '';
        if (r.cambios && r.cambios.length) {
          cambiosHtml = r.cambios.map(c => {
            const f = c.fecha ? new Date(c.fecha).toLocaleDateString('es-DO') : '—';
            return `<div class="salario-cambio"><span class="cambio-fecha">${f}</span>: ${fmtRD(c.anterior)} → ${fmtRD(c.nuevo)}${c.motivo ? ' <span class="cambio-motivo">(' + esc(c.motivo) + ')</span>' : ''}</div>`;
          }).join('');
        } else {
          cambiosHtml = '<span class="muted">—</span>';
        }
        return `
        <tr>
          <td><strong>${esc(r.nombres)} ${esc(r.apellidos)}</strong></td>
          <td>${esc(r.cedula || '—')}</td>
          <td>${esc(r.puesto || '')}</td>
          <td>${esc(r.departamento || '')}</td>
          <td class="num">${fmtRD(r.salario)}</td>
          <td class="num">${(Number(r.meses) || 0).toLocaleString('es-DO', { maximumFractionDigits: 2 })}</td>
          <td class="num"><strong>${fmtRD(r.regalia)}</strong></td>
          <td>${cambiosHtml}</td>
        </tr>`;
      }).join('')
        : '<tr><td colspan="8" class="muted center">Sin empleados con salario cargado.</td></tr>';
      $('regalia-total').textContent = fmtRD(data.total);
      $('nomina-table-card').classList.add('hidden');
      $('regalia-card').classList.remove('hidden');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function exportRegaliaExcel() {
    if (!lastRegalia || !lastRegalia.rows.length) {
      toast('Calcule primero la regalía', 'error');
      return;
    }
    return doExportExcel(`regalia_${lastRegalia.anio}`, [{
      name: 'Regalía pascual',
      headers: ['Empleado', 'Cédula', 'Puesto', 'Departamento', 'Salario', 'Meses', 'Regalía', 'Cambios salario'],
      rows: lastRegalia.rows.map(r => {
        const cambiosStr = (r.cambios || []).map(c => {
          const f = c.fecha ? new Date(c.fecha).toLocaleDateString('es-DO') : '';
          return f + ': ' + fmtRD(c.anterior) + ' → ' + fmtRD(c.nuevo) + (c.motivo ? ' (' + c.motivo + ')' : '');
        }).join('; ');
        return [r.nombres + ' ' + r.apellidos, r.cedula, r.puesto, r.departamento, r.salario, r.meses, r.regalia, cambiosStr];
      }),
      footer: ['TOTALES', '', '', '', '', '', lastRegalia.total, '']
    }]);
  }

  /* ============ Reportes ============ */
  let lastReport = null;
  let lastReportTitle = '';
  let lastReportKind = '';
  function initReportes() {
    const sel = $('rep-mes');
    if (sel.options.length === 0) {
      const now = new Date().getMonth();
      sel.innerHTML = MESES_ES.map((m, i) => `<option value="${i + 1}" ${i === now ? 'selected' : ''}>${m}</option>`).join('');
    }
    const anio = $('rep-anio');
    if (anio.options.length === 0) {
      const now = new Date().getFullYear();
      anio.innerHTML = [now - 1, now, now + 1].map((y) => `<option value="${y}" ${y === now ? 'selected' : ''}>${y}</option>`).join('');
    }
  }

  function renderReport(title, headers, rows, emptyMsg, kind) {
    lastReport = { headers, rows };
    lastReportTitle = title;
    lastReportKind = kind || '';
    const box = $('report-content');
    box.innerHTML = `
      <h3>${esc(title)}</h3>
      <table class="table">
        <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${esc(c == null ? '' : c)}</td>`).join('')}</tr>`).join('')
          : `<tr><td colspan="${headers.length}" class="muted center">${esc(emptyMsg)}</td></tr>`}</tbody>
      </table>`;
  }

  async function loadReportPlantilla() {
    try {
      const res = await window.api.reportePlantilla('activo');
      if (!res.ok) throw new Error(res.error);
      renderReport('Plantilla activa', ['Cédula', 'Nombre', 'Sexo', 'Puesto', 'Departamento', 'Salario', 'Ingreso', 'NSS', 'ARS', 'AFP', 'Contrato'],
        res.data.map(r => [r.cedula, `${r.nombres} ${r.apellidos}`, r.sexo, r.puesto, r.departamento, fmtRD(r.salario), r.fecha_ingreso, r.nss, r.ars, r.afp, CONTRATO_LABEL[r.tipo_contrato] || r.tipo_contrato || '']),
        'No hay empleados activos.');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadReportAntiguedad() {
    try {
      const res = await window.api.reporteAntiguedad();
      if (!res.ok) throw new Error(res.error);
      renderReport('Antigüedad', ['Cédula', 'Nombre', 'Puesto', 'Departamento', 'Fecha de ingreso'],
        res.data.map(r => [r.cedula, `${r.nombres} ${r.apellidos}`, r.puesto, r.departamento, r.fecha_ingreso]),
        'No hay empleados con fecha de ingreso registrada.');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadReportCumpleanos() {
    const mes = Number($('rep-mes').value) || new Date().getMonth() + 1;
    try {
      const res = await window.api.reporteCumpleanos(mes);
      if (!res.ok) throw new Error(res.error);
      renderReport('Cumpleaños de ' + MESES_ES[mes - 1], ['Cédula', 'Nombre', 'Fecha de nacimiento', 'Puesto', 'Departamento'],
        res.data.map(r => [r.cedula, `${r.nombres} ${r.apellidos}`, r.fecha_nacimiento, r.puesto, r.departamento]),
        'Sin cumpleaños este mes.');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadReportDepartamentos() {
    try {
      const res = await window.api.reporteDepartamentos();
      if (!res.ok) throw new Error(res.error);
      renderReport('Empleados por departamento', ['Departamento', 'Cantidad'],
        (res.data || []).map(d => [d.departamento, d.cantidad]),
        'Sin datos.');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadReportNominaDepartamentos() {
    try {
      const res = await window.api.reporteNominaDepartamentos();
      if (!res.ok) throw new Error(res.error);
      const rows = (res.data || []).map(d => [d.departamento, d.empleados, fmtRD(d.total_salario), d.mensual || 0, d.quincenal || 0, d.semanal || 0]);
      if (rows.length) {
        const tot = res.data.reduce((s, d) => s + Number(d.total_salario), 0);
        const emp = res.data.reduce((s, d) => s + Number(d.empleados), 0);
        rows.push(['TOTALES', emp, fmtRD(tot), '', '', '']);
      }
      renderReport('Costo de nómina por departamento', ['Departamento', 'Empleados', 'Nómina mensual', 'Mensual', 'Quincenal', 'Semanal'],
        rows, 'No hay empleados activos con salario.');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadReportEmpleados() {
    try {
      const res = await window.api.reporteEmpleados();
      if (!res.ok) throw new Error(res.error);
      renderReport('Informe de empleados activos', ['Cédula', 'Nombre', 'Puesto', 'Departamento', 'Salario', 'Tipo', 'Ingreso', 'Contrato', 'ARS', 'AFP'],
        (res.data || []).map(r => [r.cedula, `${r.nombres} ${r.apellidos}`, r.puesto, r.departamento, fmtRD(r.salario), r.tipo_salario, r.fecha_ingreso, CONTRATO_LABEL[r.tipo_contrato] || r.tipo_contrato || '', r.ars, r.afp]),
        'No hay empleados activos.');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadReportCedulasVencer() {
    try {
      const res = await window.api.reporteCedulasVencer();
      if (!res.ok) throw new Error(res.error);
      const rows = (res.data || []).map(r => {
        let estado = '—';
        if (r.fecha_vencimiento) {
          const p = r.fecha_vencimiento.split('/');
          const d = p.length === 3 ? new Date(+p[2], +p[1] - 1, +p[0]) : null;
          const diff = d ? Math.ceil((d - new Date()) / 86400000) : null;
          estado = diff == null ? '—' : diff < 0 ? 'Vencida' : diff <= 90 ? `Vence en ${diff} días` : 'Vigente';
        }
        return [r.cedula, `${r.nombres} ${r.apellidos}`, r.fecha_vencimiento, estado, r.puesto, r.departamento];
      });
      renderReport('Cédulas por vencer', ['Cédula', 'Nombre', 'Vencimiento', 'Estado', 'Puesto', 'Departamento'],
        rows, 'Sin cédulas con vencimiento registrado.');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadReportAniversarios() {
    const anio = Number($('rep-anio').value) || new Date().getFullYear();
    try {
      const res = await window.api.reporteAniversarios(anio);
      if (!res.ok) throw new Error(res.error);
      renderReport('Aniversarios laborales ' + anio, ['Cédula', 'Nombre', 'Fecha de ingreso', 'Años', 'Puesto', 'Departamento'],
        (res.data || []).map(r => [r.cedula, `${r.nombres} ${r.apellidos}`, r.fecha_ingreso, r.anios, r.puesto, r.departamento]),
        'Sin aniversarios calculados para ' + anio + '.');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadReportBeneficios() {
    try {
      const res = await window.api.reporteBeneficios();
      if (!res.ok) throw new Error(res.error);
      const rows = (res.data || []).map(r => [r.cedula, `${r.nombres} ${r.apellidos}`, r.ars || '—', r.afp || '—', r.nss || '—', r.puesto, r.departamento]);
      if (rows.length) {
        const arsCount = (res.data || []).filter(r => r.ars).length;
        const afpCount = (res.data || []).filter(r => r.afp).length;
        rows.push(['TOTALES', rows.length, `${arsCount} con ARS`, `${afpCount} con AFP`, '', '', '']);
      }
      renderReport('Informe de beneficios (ARS / AFP / NSS)', ['Cédula', 'Nombre', 'ARS', 'AFP', 'NSS', 'Puesto', 'Departamento'],
        rows, 'No hay empleados activos.');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadReport609() {
    const anio = Number($('rep-anio').value) || new Date().getFullYear();
    try {
      const res = await window.api.reporte609(anio);
      if (!res.ok) throw new Error(res.error);
      const data = res.data;
      const rows = data.rows.map(r => [
        r.cedula || '—', `${r.apellidos}, ${r.nombres}`, fmtRD(r.bruto),
        fmtRD(r.sfs), fmtRD(r.afp), fmtRD(r.isr), fmtRD(r.retenciones)
      ]);
      if (data.rows.length) {
        rows.push(['', 'TOTALES', fmtRD(data.totales.bruto), fmtRD(data.totales.sfs), fmtRD(data.totales.afp), fmtRD(data.totales.isr), fmtRD(data.totales.retenciones)]);
      }
      renderReport(`Reporte 609 · Planilla de pago ${anio}`, ['RNC / Cédula', 'Nombres', 'Salarios brutos', 'SFS', 'AFP', 'ISR', 'Total retenciones'],
        rows, 'No hay retenciones registradas para ' + anio + '.', '609');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function exportReportExcel() {
    if (lastReportKind === '609') {
      const anio = Number($('rep-anio').value) || new Date().getFullYear();
      try {
        const res = await window.api.reporte609Excel(anio);
        if (!res.ok) throw new Error(res.error);
        if (res.data) toast('Excel guardado: ' + res.data, 'success', 5000);
      } catch (e) { toast(e.message, 'error'); }
      return;
    }
    if (!lastReport || !lastReport.rows.length) {
      toast('Genere primero un reporte', 'error');
      return;
    }
    const fname = 'reporte_' + (lastReportTitle || 'planilla').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_');
    return doExportExcel(fname, [{
      name: lastReportTitle || 'Reporte',
      headers: lastReport.headers,
      rows: lastReport.rows,
      footer: null
    }]);
  }

  function buildReportHtml() {
    if (!lastReport || !lastReport.rows.length) {
      toast('Genere primero un reporte', 'error');
      return null;
    }
    const rowsHtml = lastReport.rows.map(r => `<tr>${r.map(c => `<td>${esc(c == null ? '' : c)}</td>`).join('')}</tr>`).join('');
    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
      <title>${esc(lastReportTitle || 'Reporte')}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 24px; color: #1a2030; }
        h2 { margin: 0 0 4px; }
        .sub { color: #6b7280; font-size: 12px; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { background: #1e3a8a; color: #fff; text-align: left; padding: 8px; }
        td { border: 1px solid #d1d5db; padding: 6px 8px; }
        tr:nth-child(even) td { background: #f3f4f6; }
      </style></head><body>
      <h2>${esc(lastReportTitle || 'Reporte')}</h2>
      <div class="sub">Generado el ${new Date().toLocaleString('es-DO')}</div>
      <table><thead><tr>${lastReport.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rowsHtml}</tbody></table>
    </body></html>`;
  }

  async function printReport() {
    const html = buildReportHtml();
    if (!html) return;
    try {
      const res = await window.api.reportePrint(lastReportTitle, html);
      if (!res.ok) throw new Error(res.error);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function exportReportPdf() {
    const html = buildReportHtml();
    if (!html) return;
    try {
      const res = await window.api.reportePdf(lastReportTitle, html);
      if (!res.ok) throw new Error(res.error);
      if (res.data) toast('PDF guardado: ' + res.data, 'success', 5000);
    } catch (e) { toast(e.message, 'error'); }
  }

  /* ============ Notificaciones ============ */
  const NOTIF_TIPOS = [
    ['pago', '💰 Pagos de nómina'],
    ['cumpleanos', '🎂 Cumpleaños'],
    ['aniversario', '🎉 Aniversarios laborales'],
    ['vacaciones', '🏖️ Vacaciones y permisos'],
    ['cedula', '🪪 Vencimientos de cédula']
  ];

  function updateNotifBadge(n) {
    const b = $('notif-badge');
    b.textContent = n;
    b.classList.toggle('hidden', !n);
  }

  function renderNotificaciones(data) {
    const events = (data && data.events) || [];
    const stats = (data && data.resumen) || {};
    const cards = [
      ['Alertas hoy', stats.hoy || 0, ' stat-net'],
      ['Cumpleaños hoy', stats.cumpleanos_hoy || 0, ''],
      ['Aniversarios hoy', stats.aniversarios_hoy || 0, ''],
      ['Pagos hoy', stats.pagos_hoy || 0, ''],
      ['Cédulas por vencer', stats.cedulas_hoy || 0, ''],
      ['Vacaciones hoy', stats.vacaciones_hoy || 0, '']
    ];
    $('notif-totals').innerHTML = cards.map(([l, v, cls]) =>
      `<div class="card stat-card"><div class="stat-label">${esc(l)}</div><div class="stat-value${cls}">${v}</div></div>`).join('');
    const box = $('notif-list');
    const descartadas = new Set(getNotifDismissed());
    const visibles = events.filter(e => !descartadas.has(e.id));
    if (!visibles.length) {
      box.innerHTML = '<h3 style="padding:16px 20px 0">Alertas</h3><div class="empty-state"><p>No hay alertas en los próximos días.</p></div>';
      return;
    }
    box.innerHTML = '<h3 style="padding:16px 20px 0">Alertas</h3>' + NOTIF_TIPOS.map(([t, label]) => {
      const group = visibles.filter(e => e.tipo === t);
      if (!group.length) return '';
      return `<h4 class="notif-group">${label} <span>(${group.length})</span></h4>` + group.map(e => {
        const badge = e.dias < 0 ? '<span class="badge-warn">Vencida</span>'
          : e.dias === 0 ? '<span class="badge-ok">Hoy</span>'
          : `<span class="notif-badge-plain">En ${e.dias} día${e.dias === 1 ? '' : 's'}</span>`;
        return `<div class="notif-item">
          <div class="notif-item-main"><strong>${esc(e.titulo)}</strong><div class="muted small">${esc(e.descripcion)}</div></div>
          <div class="notif-item-date"><span>${esc(e.fecha)}</span> ${badge}</div>
          <button class="notif-dismiss" data-dismiss-id="${esc(e.id)}" title="Descartar alerta">✕</button>
        </div>`;
      }).join('');
    }).join('');
  }

  function getNotifDismissed() {
    try { return JSON.parse(localStorage.getItem('notif_dismissed') || '[]'); } catch (e) { return []; }
  }
  function dismissNotif(id) {
    const set = new Set(getNotifDismissed());
    set.add(id);
    localStorage.setItem('notif_dismissed', JSON.stringify([...set]));
    loadNotificaciones();
  }

  async function loadNotificaciones() {
    try {
      const res = await window.api.listNotificaciones();
      if (!res.ok) throw new Error(res.error);
      updateNotifBadge(res.data.events.length);
      renderNotificaciones(res.data);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function loadNotifSettings() {
    try {
      const res = await window.api.getNotifSettings();
      if (!res.ok) throw new Error(res.error);
      const s = res.data || {};
      $('set-notif-activadas').checked = s.notif_activadas !== 'false';
      $('set-dias-cumpleanos').value = s.dias_cumpleanos;
      $('set-dias-pago').value = s.dias_pago;
      $('set-dias-cedula').value = s.dias_cedula;
      $('set-dias-vacaciones').value = s.dias_vacaciones;
      $('set-dias-aniversario').value = s.dias_aniversario;
    } catch (e) { toast(e.message, 'error'); }
  }

  async function saveNotifSettings() {
    try {
      const res = await window.api.saveNotifSettings({
        notif_activadas: $('set-notif-activadas').checked ? 'true' : 'false',
        dias_cumpleanos: Number($('set-dias-cumpleanos').value) || 7,
        dias_pago: Number($('set-dias-pago').value) || 3,
        dias_cedula: Number($('set-dias-cedula').value) || 30,
        dias_vacaciones: Number($('set-dias-vacaciones').value) || 7,
        dias_aniversario: Number($('set-dias-aniversario').value) || 7
      });
      if (!res.ok) throw new Error(res.error);
      toast('Configuración de alertas guardada', 'success');
      loadNotificaciones();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function testNotificacion() {
    try {
      const res = await window.api.testNotificacion();
      if (!res.ok) throw new Error(res.error);
      toast('Notificación de prueba enviada', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }

  /* ============ Sistema / Respaldos ============ */
  async function loadSistema() {
    $('backup-card').classList.toggle('hidden', !isAdmin());
    if (isAdmin()) {
      loadBackupSettings();
      loadBackups();
    }
    pendingImport = null;
    renderImportPreview(null);
    $('doc-settings').classList.toggle('hidden', !canEdit());
    if (canEdit()) loadDocSettings();
  }

  /* ============ Modelos de documentos ============ */
  let docLogoDataUrl = '';

  async function loadDocSettings() {
    docLogoDataUrl = '';
    try {
      const res = await window.api.docsGetSettings();
      if (!res.ok) throw new Error(res.error);
      const s = res.data.settings || {};
      $('doc-company-name').value = s.doc_company_name || '';
      $('doc-company-rnc').value = s.doc_company_rnc || '';
      $('doc-company-tel').value = s.doc_company_tel || '';
      $('doc-company-email').value = s.doc_company_email || '';
      $('doc-company-address').value = s.doc_company_address || '';
      $('doc-firma-nombre').value = s.doc_firma_nombre || '';
      $('doc-firma-cargo').value = s.doc_firma_cargo || '';
      $('doc-firma-celular').value = s.doc_firma_celular || '';
      $('doc-constancia-text').value = s.doc_constancia_text || '';
      $('doc-carta-text').value = s.doc_carta_text || '';
      $('doc-destinatario-tipo').value = s.doc_destinatario_tipo || 'banco';
      $('doc-destinatario').value = s.doc_destinatario || s.doc_banco || '';
      if (s.doc_logo) {
        docLogoDataUrl = s.doc_logo;
        $('doc-logo-name').textContent = 'Logo cargado (' + Math.round(docLogoDataUrl.length / 1024) + ' KB)';
      } else {
        $('doc-logo-name').textContent = '';
      }
      const chips = $('doc-placeholders');
      chips.innerHTML = (res.data.placeholders || []).map(p => `<span class="chip">${esc(p[0])}</span>`).join('');
    } catch (e) { toast(e.message, 'error'); }
  }

  function pickDocLogo() {
    $('doc-logo-file').click();
  }

  function handleDocLogoFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
      toast('Solo se permiten imágenes (PNG, JPG, WEBP, GIF)', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      docLogoDataUrl = reader.result;
      $('doc-logo-name').textContent = 'Logo cargado (' + Math.round(docLogoDataUrl.length / 1024) + ' KB)';
    };
    reader.readAsDataURL(file);
  }

  function removeDocLogo() {
    docLogoDataUrl = '';
    $('doc-logo-name').textContent = '';
    toast('Logo eliminado. Guarde los modelos para confirmar.', 'info');
  }

  async function saveDocSettings() {
    const msg = $('doc-save-msg');
    msg.textContent = '';
    try {
      const payload = {
        doc_company_name: $('doc-company-name').value,
        doc_company_rnc: $('doc-company-rnc').value,
        doc_company_tel: $('doc-company-tel').value,
        doc_company_email: $('doc-company-email').value,
        doc_company_address: $('doc-company-address').value,
        doc_firma_nombre: $('doc-firma-nombre').value,
        doc_firma_cargo: $('doc-firma-cargo').value,
        doc_firma_celular: $('doc-firma-celular').value,
        doc_logo: docLogoDataUrl,
        doc_constancia_text: $('doc-constancia-text').value,
        doc_carta_text: $('doc-carta-text').value,
        doc_destinatario_tipo: $('doc-destinatario-tipo').value,
        doc_destinatario: $('doc-destinatario').value
      };
      const res = await window.api.docsSaveSettings(payload);
      if (!res.ok) throw new Error(res.error);
      docLogoDataUrl = (res.data && res.data.doc_logo) || '';
      msg.textContent = 'Guardado ✓';
      setTimeout(() => { msg.textContent = ''; }, 3000);
      toast('Modelos de documentos guardados', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function resetDocSettings() {
    if (!confirm('¿Restablecer todos los modelos de documentos a los predeterminados del programa?\nSe quitarán el logo, las plantillas y los textos personalizados. Esta acción no se puede deshacer.')) return;
    const msg = $('doc-save-msg');
    msg.textContent = '';
    const payload = {
      doc_logo: '',
      doc_company_name: '', doc_company_rnc: '', doc_company_tel: '', doc_company_email: '', doc_company_address: '',
      doc_firma_nombre: '', doc_firma_cargo: '', doc_firma_celular: '',
      doc_constancia_text: '', doc_carta_text: '',
      doc_destinatario_tipo: 'banco', doc_destinatario: '',
      doc_tipo_constancia: '', doc_plantilla_constancia: '', doc_plantilla_constancia_name: '',
      doc_tipo_carta: '', doc_plantilla_carta: '', doc_plantilla_carta_name: '',
      doc_tipo_solicitud: '', doc_plantilla_solicitud: '', doc_plantilla_solicitud_name: ''
    };
    try {
      const res = await window.api.docsSaveSettings(payload);
      if (!res.ok) throw new Error(res.error);
      await loadDocSettings();
      msg.textContent = 'Restablecido ✓';
      setTimeout(() => { msg.textContent = ''; }, 3000);
      toast('Modelos restablecidos a los predeterminados', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadBackupSettings() {
    try {
      const res = await window.api.backupSettings();
      if (!res.ok) throw new Error(res.error);
      $('set-backup-auto').checked = !!(res.data && res.data.auto);
      $('set-backup-keep').value = (res.data && res.data.keep) || 5;
      $('set-backup-dir').value = (res.data && res.data.dir) || '';
    } catch (e) { toast(e.message, 'error'); }
  }

  async function saveBackupSettings() {
    try {
      const res = await window.api.backupSaveSettings($('set-backup-auto').checked, Number($('set-backup-keep').value) || 5, $('set-backup-dir').value.trim());
      if (!res.ok) throw new Error(res.error);
      toast('Configuración de respaldos guardada', 'success');
      loadBackups();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function pickBackupDir() {
    try {
      const res = await window.api.backupPickDir();
      if (!res.ok) throw new Error(res.error);
      if (res.data) $('set-backup-dir').value = res.data;
    } catch (e) { toast(e.message, 'error'); }
  }

  async function createBackup() {
    try {
      const res = await window.api.backupCreate(false);
      if (!res.ok) throw new Error(res.error);
      const data = res.data || {};
      if (data.secondary && data.secondary.error) {
        toast('Respaldo local creado, pero la copia adicional falló: ' + data.secondary.error, 'error', 8000);
      } else if (data.secondary) {
        toast('Respaldo creado (local y copia adicional): ' + data.file, 'success');
      } else {
        toast('Respaldo creado: ' + data.file, 'success');
      }
      loadBackups();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function resetSalarioHistorial() {
    const ok = confirm('¿Reiniciar el historial de salarios?\n\nBorra todos los cambios de salario registrados y deja el salario actual de cada empleado activo como base desde el 1 de enero del año.\n\nEsta acción NO se puede deshacer.');
    if (!ok) return;
    try {
      const res = await window.api.resetSalarioHistorial();
      if (!res.ok) throw new Error(res.error);
      const data = res.data || {};
      toast(`Historial reiniciado: base aplicada a ${data.registros || 0} empleados activos (año ${data.anio || ''}).`, 'success', 6000);
    } catch (e) { toast(e.message, 'error'); }
  }

  function fmtSize(bytes) {
    if (bytes == null) return '';
    const kb = bytes / 1024;
    return kb >= 1024 ? (kb / 1024).toFixed(2) + ' MB' : kb.toFixed(1) + ' KB';
  }

  async function loadBackups() {
    const box = $('backup-list');
    try {
      const res = await window.api.backupList();
      if (!res.ok) throw new Error(res.error);
      const list = res.data || [];
      box.innerHTML = list.length
        ? '<h4 style="margin-bottom:8px">Respaldos disponibles</h4>' + list.map(b => `
            <div class="backup-row">
              <span class="backup-name">💾 ${esc(b.file)}</span>
              <span class="muted">${fmtSize(b.size)} · ${esc((b.mtime || '').replace('T', ' ').slice(0, 19))}</span>
              ${isAdmin() ? `<button class="btn btn-ghost btn-sm" data-restore="${esc(b.file)}">Restaurar</button>` : ''}
            </div>`).join('')
        : '<p class="muted">No hay respaldos todavía. Cree uno para proteger sus datos.</p>';
      box.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', () => restoreBackup(b.dataset.restore)));
    } catch (e) {
      box.innerHTML = '<p class="muted">' + esc(e.message) + '</p>';
    }
  }

  async function restoreBackup(file) {
    if (!confirm(`¿Restaurar el respaldo "${file}"? Se reemplazarán todos los datos actuales y la aplicación se recargará.`)) return;
    try {
      const res = await window.api.backupRestore(file);
      if (!res.ok) throw new Error(res.error);
      toast('Respaldo restaurado. La app se recargará…', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function restoreBackupFile() {
    try {
      const res = await window.api.backupRestoreFile();
      if (!res.ok) throw new Error(res.error);
      if (res.data) toast('Respaldo restaurado. La app se recargará…', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }

  /* ============ Importación desde Excel ============ */
  let pendingImport = null;

  async function downloadImportTemplate() {
    try {
      const res = await window.api.importTemplate();
      if (!res.ok) throw new Error(res.error);
      if (res.data) toast('Plantilla guardada: ' + res.data, 'success', 5000);
    } catch (e) { toast(e.message, 'error'); }
  }

  function pickImportFile() {
    go('sistema');
    $('import-file').click();
  }

  async function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const res = await window.api.importParse(buf);
      if (!res.ok) throw new Error(res.error);
      go('sistema');
      pendingImport = res.data.rows;
      renderImportPreview(pendingImport);
      toast(`Archivo leído: ${pendingImport.length} empleado(s) detectados. Revise la vista previa y confirme.`, 'success');
    } catch (err) {
      pendingImport = null;
      renderImportPreview(null);
      toast(err.message, 'error');
    }
  }

  function renderImportPreview(rows) {
    const box = $('import-preview');
    if (!rows || !rows.length) { box.innerHTML = ''; return; }
    const sample = rows.slice(0, 5);
    box.innerHTML = `
      <h4>Vista previa (${rows.length} empleado(s))</h4>
      <table class="table">
        <thead><tr><th>Cédula</th><th>Nombre</th><th>Puesto</th><th>Departamento</th><th>Salario</th></tr></thead>
        <tbody>${sample.map(r => `<tr><td>${esc(r.cedula || '')}</td><td>${esc(r.nombres)} ${esc(r.apellidos)}</td><td>${esc(r.puesto || '')}</td><td>${esc(r.departamento || '')}</td><td>${fmtRD(r.salario)}</td></tr>`).join('')}</tbody>
      </table>
      ${rows.length > 5 ? `<p class="muted small">… y ${rows.length - 5} más</p>` : ''}
      <div class="form-row" style="margin-top:10px">
        <button class="btn btn-primary" id="btn-import-confirm">Importar ${rows.length} empleado(s)</button>
        <button class="btn btn-ghost" id="btn-import-cancel">Cancelar</button>
      </div>`;
    $('btn-import-confirm').addEventListener('click', confirmImport);
    $('btn-import-cancel').addEventListener('click', () => { pendingImport = null; renderImportPreview(null); });
  }

  async function confirmImport() {
    if (!pendingImport || !pendingImport.length) return;
    const btn = $('btn-import-confirm');
    btn.disabled = true;
    try {
      const res = await window.api.importRun(pendingImport);
      if (!res.ok) throw new Error(res.error);
      const d = res.data;
      let msg = `${d.imported} importado(s), ${d.skipped} omitido(s)`;
      if (d.errors.length) msg += `, ${d.errors.length} error(es)`;
      toast(msg, d.errors.length && !d.imported ? 'error' : 'success', 6000);
      if (d.duplicated.length) toast('Duplicados (omitidos): ' + d.duplicated.slice(0, 4).join(' · '), 'info', 6000);
      pendingImport = null;
      renderImportPreview(null);
      go('empleados');
      loadEmployees();
      loadStats();
    } catch (e) { toast(e.message, 'error'); }
    finally { if (btn) btn.disabled = false; }
  }

  /* ============ Correos ============ */
  let mailEmployees = [];
  let mailContacts = [];
  async function loadCorreo() {
    try {
      const [emps, contacts] = await Promise.all([window.api.listEmployees('', 'activo'), window.api.contactosList()]);
      if (emps.ok) {
        mailEmployees = (emps.data || []).filter(e => (e.email || '').trim());
      }
      if (contacts.ok) {
        mailContacts = contacts.data || [];
      }
    } catch (e) { toast(e.message, 'error'); }
    try {
      const ai = await window.api.getAiSettings();
      if (ai.ok && ai.data) {
        $('ai-gemini-key').value = ai.data.gemini || '';
        $('ai-openai-key').value = ai.data.openai || '';
      }
    } catch (e) { /* sin permisos */ }
    renderMailRecipients();
    renderMailContacts();
  }

  function renderMailRecipients() {
    const q = ($('mail-filter').value || '').toLowerCase();
    const list = mailEmployees.filter(e => !q || (e.nombres + ' ' + e.apellidos + ' ' + e.email).toLowerCase().includes(q));
    const box = $('mail-recipients');
    box.innerHTML = list.length ? list.map(e => `
      <label class="check-line mail-recipient">
        <input type="checkbox" class="mail-rec-cb" value="${e.id}" />
        <span><strong>${esc(e.nombres)} ${esc(e.apellidos)}</strong> <span class="muted">${esc(e.email)}</span>${e.has_images ? ' 📄' : ''}</span>
      </label>`).join('') : '<p class="muted">No hay empleados con correo registrado. Agréguelo en el expediente del empleado.</p>';
    updateMailCount();
  }

  function selectedMailIds() {
    return [...document.querySelectorAll('.mail-rec-cb:checked')].map(cb => Number(cb.value));
  }

  function updateMailCount() {
    $('mail-recipient-count').textContent = selectedMailIds().length + ' seleccionado(s) de ' + mailEmployees.length;
  }

  function renderMailContacts() {
    const box = $('mail-contacts');
    box.innerHTML = mailContacts.length ? mailContacts.map(c => `
      <label class="check-line mail-recipient">
        <input type="checkbox" class="mail-cont-cb" value="${c.id}" />
        <span><strong>${esc(c.nombre)}</strong> <span class="muted">${esc(c.email)}</span></span>
        <button type="button" class="btn btn-danger btn-sm" data-contact-del="${c.id}" title="Eliminar">✕</button>
      </label>`).join('') : '<p class="muted">Aún no hay contactos externos. Agréguelos arriba.</p>';
    box.querySelectorAll('[data-contact-del]').forEach(b => b.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      removeMailContact(Number(b.dataset.contactDel));
    }));
    updateCustomCount();
  }

  function selectedContactEmails() {
    return [...document.querySelectorAll('.mail-cont-cb:checked')].map(cb => {
      const c = mailContacts.find(x => x.id === Number(cb.value));
      return c ? c.email : '';
    }).filter(Boolean);
  }

  async function addMailContact() {
    const nombre = $('contacto-nombre').value.trim();
    const email = $('contacto-email').value.trim();
    if (!nombre) { toast('Indique el nombre del contacto', 'error'); return; }
    if (!email) { toast('Indique el correo del contacto', 'error'); return; }
    try {
      const res = await window.api.contactosCreate({ nombre, email });
      if (!res.ok) throw new Error(res.error);
      mailContacts.push(res.data);
      $('contacto-nombre').value = '';
      $('contacto-email').value = '';
      renderMailContacts();
      toast('Contacto agregado', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function removeMailContact(id) {
    try {
      const res = await window.api.contactosDelete(id);
      if (!res.ok) throw new Error(res.error);
      mailContacts = mailContacts.filter(c => c.id !== id);
      renderMailContacts();
      toast('Contacto eliminado', 'info');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function saveAiSettings() {
    try {
      const res = await window.api.saveAiSettings({
        GEMINI_API_KEY: $('ai-gemini-key').value.trim(),
        OPENAI_API_KEY: $('ai-openai-key').value.trim()
      });
      if (!res.ok) throw new Error(res.error);
      const cfg = await window.api.aiStatus();
      aiProviders = (cfg.ok && cfg.data && Array.isArray(cfg.data.providers)) ? cfg.data.providers : [];
      aiConfigured = aiProviders.length > 0;
      refreshAiControls();
      toast(aiConfigured ? `Claves de IA guardadas (${aiProviders.map(p => p === 'gemini' ? 'Gemini' : 'OpenAI').join(', ')})` : 'Claves guardadas, pero ninguna válida', aiConfigured ? 'success' : 'error');
    } catch (e) { toast(e.message, 'error'); }
  }

  function fillTemplate(text, e) {
    return String(text || '')
      .replace(/\{nombre\}/g, e.nombres || '')
      .replace(/\{apellidos\}/g, e.apellidos || '')
      .replace(/\{puesto\}/g, e.puesto || '')
      .replace(/\{departamento\}/g, e.departamento || '');
  }

  function openMailtoFor(to, subject, body, cc) {
    return window.api.openMailto(to, subject, body, cc);
  }

  function selectedMailEmployees() {
    const ids = selectedMailIds();
    return mailEmployees.filter(e => ids.includes(e.id));
  }

  async function sendSelectedMail() {
    const emps = selectedMailEmployees();
    if (!emps.length) { toast('Seleccione al menos un destinatario', 'error'); return; }
    const subject = $('mail-subject').value.trim();
    const body = $('mail-message').value;
    const cc = selectedContactEmails().join(', ');
    try {
      let opened = 0;
      for (const e of emps) {
        await openMailtoFor(e.email, fillTemplate(subject, e) || `Comunicado para ${e.nombres} ${e.apellidos}`, fillTemplate(body, e), cc);
        opened++;
      }
      toast(opened + ' correo(s) abierto(s) en tu app de correo', 'success', 5000);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function sendMailReminders() {
    try {
      const res = await window.api.listNotificaciones();
      if (!res.ok) throw new Error(res.error);
      const events = res.data && res.data.events ? res.data.events : (Array.isArray(res.data) ? res.data : []);
      const emps = mailEmployees.filter(e => e.id != null && e.email);
      let opened = 0;
      for (const e of emps) {
        const full = (e.nombres + ' ' + e.apellidos).toLowerCase();
        const mine = events.filter(ev =>
          ev.titulo && ev.titulo.toLowerCase().includes(full)
        );
        if (!mine.length) continue;
        const subject = 'Recordatorios pendientes — ' + e.nombres + ' ' + e.apellidos;
        const items = mine.map(ev => '• ' + (ev.titulo || ev.descripcion || ''));
        const body = `Estimado/a ${e.nombres}:\n\nLe recordamos lo siguiente en relación con su expediente:\n\n${items.join('\n')}\n\nReciba un cordial saludo.\nAtentamente,\nRecursos Humanos`;
        await openMailtoFor(e.email, subject, body);
        opened++;
      }
      toast(opened ? opened + ' recordatorio(s) generado(s) en tu app de correo' : 'No hay recordatorios pendientes para empleados con correo', opened ? 'success' : 'info', 5000);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadMailLog() {
    try {
      const res = await window.api.correoLog(50);
      if (!res.ok) throw new Error(res.error);
      const rows = res.data || [];
      $('mail-log-box').textContent = rows.length
        ? rows.map(l => l.created_at + '  ' + (l.status === 'ok' ? '✓' : '✗') + '  ' + l.to_email + ' — ' + l.subject + (l.error ? '  (' + l.error + ')' : '')).join('\n')
        : '(Sin envíos registrados)';
      $('mail-log-card').classList.toggle('hidden');
    } catch (e) { toast(e.message, 'error'); }
  }

  function updateCustomCount() {
    const extra = selectedContactEmails().length;
    $('mail-custom-count').textContent = (selectedMailIds().length ? selectedMailIds().length + ' empleado(s)' : 'Sin empleados') +
      (extra ? ' + ' + extra + ' contacto(s) en CC' : '');
  }

  async function openComposedMail() {
    const subject = $('mail-subject').value.trim();
    const body = $('mail-message').value;
    if (!subject && !body) { toast('Redacte un asunto o mensaje antes de abrir el correo', 'info'); return; }
    const emps = selectedMailEmployees();
    const extraTo = [$('mail-to-extra').value.trim(), ...selectedContactEmails()].filter(Boolean);
    const cc = extraTo.join(', ');
    try {
      let opened = 0;
      if (emps.length) {
        for (const e of emps) {
          await openMailtoFor(e.email, fillTemplate(subject, e), fillTemplate(body, e), cc);
          opened++;
        }
      } else if (extraTo.length) {
        await openMailtoFor(extraTo.join(','), subject, body);
        opened = 1;
      } else {
        toast('Indique un destinatario (empleado, correo o contacto en CC)', 'error');
        return;
      }
      toast(opened + ' correo(s) abierto(s) en tu app de correo', 'success', 4000);
    } catch (e) { toast(e.message, 'error'); }
  }

  const MAIL_TEMPLATES = {
    cumple: {
      subject: '¡Feliz cumpleaños, {nombre}!',
      text: 'Querido/a {nombre}:\n\nEn [nombre de la empresa] queremos desearte un feliz cumpleaños. Esperamos que pases un día especial rodeado/a de las personas que quieres.\n\nRecibe un abrazo de parte de todo el equipo.\n\nAtentamente,\nRecursos Humanos'
    },
    evento: {
      subject: 'Invitación a evento',
      text: 'Estimado/a {nombre}:\n\nNos complace invitarte a [nombre del evento], que se celebrará el [fecha] a las [hora] en [lugar].\n\nConfirma tu asistencia antes del [fecha límite] respondiendo a este correo.\n\nAtentamente,\nRecursos Humanos'
    },
    aviso: {
      subject: 'Aviso importante',
      text: 'Estimado/a {nombre}:\n\n[Escriba aquí el aviso]\n\nAtentamente,\nRecursos Humanos'
    },
    despido: {
      subject: 'Comunicación sobre la terminación de su relación laboral',
      text: 'Estimado/a {nombre}:\n\nPor medio de la presente le comunicamos que, a partir del [fecha], su relación laboral con [nombre de la empresa] llegará a su fin.\n\nAgradecemos los servicios prestados. Como parte del proceso, recibirá en los próximos días la liquidación correspondiente conforme a la ley, incluyendo los salarios adeudados, vacaciones proporcionales y demás prestaciones.\n\nLe solicitamos coordinar con Recursos Humanos la entrega de los materiales o bienes de la empresa que estén en su poder.\n\nLe deseamos éxito en sus futuros proyectos.\n\nAtentamente,\nRecursos Humanos'
    }
  };

  function applyMailTemplate(name) {
    const t = MAIL_TEMPLATES[name];
    if (!t) return;
    $('mail-subject').value = t.subject;
    $('mail-message').value = t.text;
    toast('Plantilla cargada. Edítela si lo desea.', 'info');
  }

  /* ============ Modal empleado ============ */
  function emptyRecord() {
    const f = {};
    [...FRONT_FIELDS, ...BACK_FIELDS, ...LABOR_FIELDS].forEach(([k]) => f[k] = '');
    f.nota = '';
    return f;
  }

  function buildLaborFieldHtml([key, label], readonly) {
    let control;
    if (key === 'tipo_salario') {
      control = `<select id="f-${key}" ${readonly ? 'disabled' : ''}>` +
        TIPO_SALARIO_OPTS.map(o => `<option value="${o}">${o ? (TIPO_SALARIO_LABEL[o] || o) : '(no especificado)'}</option>`).join('') + '</select>';
    } else if (key === 'tipo_contrato') {
      control = `<select id="f-${key}" ${readonly ? 'disabled' : ''}>` +
        CONTRATO_OPTS.map(o => `<option value="${o}">${o ? (CONTRATO_LABEL[o] || o) : '(no especificado)'}</option>`).join('') + '</select>';
    } else if (key === 'salario') {
      control = `<input id="f-${key}" type="number" step="0.01" min="0" ${readonly ? 'disabled' : ''} />`;
    } else if (key === 'ars' || key === 'afp') {
      control = `<input id="f-${key}" type="text" list="${key}-list" placeholder="Seleccione o escriba" ${readonly ? 'disabled' : ''} />`;
    } else {
      control = `<input id="f-${key}" type="text" ${readonly ? 'disabled' : ''} />`;
    }
    return `<div class="field"><label for="f-${key}">${label}</label>${control}</div>`;
  }

  function buildFieldHtml([key, label], readonly) {
    let control;
    if (key === 'sexo') {
      control = `<select id="f-${key}" ${readonly ? 'disabled' : ''}>` +
        SEXO_OPTS.map(o => `<option value="${o}">${o || '(no especificado)'}</option>`).join('') + '</select>';
    } else if (key === 'estado_civil') {
      control = `<select id="f-${key}" ${readonly ? 'disabled' : ''}>` +
        CIVIL_OPTS.map(o => `<option value="${o}">${o || '(no especificado)'}</option>`).join('') + '</select>';
    } else if (key === 'tipo_sangre') {
      control = `<select id="f-${key}" ${readonly ? 'disabled' : ''}>` +
        SANGRE_OPTS.map(o => `<option value="${o}">${o || '(no especificado)'}</option>`).join('') + '</select>';
    } else {
      control = `<input id="f-${key}" type="text" ${readonly ? 'disabled' : ''} />`;
    }
    return `<div class="field"><label for="f-${key}">${label}</label>${control}</div>`;
  }

  function fillField(key, value) {
    const el = $('f-' + key);
    if (!el) return;
    el.value = value == null ? '' : String(value);
  }

  function setSelect(key, value, opts) {
    const el = $('f-' + key);
    if (!el) return;
    const v = String(value || '');
    el.value = opts.includes(v) ? v : '';
  }

  function normalizeSexo(v) {
    const s = String(v || '').trim().toLowerCase();
    if (s.startsWith('m')) return 'Masculino';
    if (s.startsWith('f')) return 'Femenino';
    return SEXO_OPTS.includes(String(v)) ? String(v) : '';
  }

  function normalizeCivil(v) {
    const s = String(v || '').trim().toLowerCase();
    if (s.includes('solter')) return 'Soltero';
    if (s.includes('casad')) return 'Casado';
    if (s.includes('divor')) return 'Divorciado';
    if (s.includes('viud')) return 'Viudo';
    if (s.includes('unión') || s.includes('union') || s.includes('libre')) return 'Unión libre';
    return CIVIL_OPTS.includes(String(v)) ? String(v) : '';
  }

  function normalizeSangre(v) {
    const s = String(v || '').trim().toUpperCase().replace(/\s+/g, '');
    return SANGRE_OPTS.includes(s) ? s : '';
  }

  function normalizeTipoSalario(v) {
    const s = String(v || '').trim().toLowerCase();
    return TIPO_SALARIO_OPTS.includes(s) ? s : '';
  }

  function normalizeContrato(v) {
    const s = String(v || '').trim().toLowerCase();
    return CONTRATO_OPTS.includes(s) ? s : '';
  }

  function cropDataUrl(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cw = img.naturalWidth;
        const ch = img.naturalHeight;
        if (!cw || !ch) { resolve(dataUrl); return; }
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        let id;
        try { id = ctx.getImageData(0, 0, cw, ch); } catch (e) { resolve(dataUrl); return; }
        const d = id.data;
        const th = 245;
        let minX = cw, minY = ch, maxX = -1, maxY = -1;
        for (let y = 0; y < ch; y += 3) {
          for (let x = 0; x < cw; x += 3) {
            const i = (y * cw + x) * 4;
            if (d[i] < th || d[i + 1] < th || d[i + 2] < th) {
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < minX || maxY < minY) { resolve(dataUrl); return; }
        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        if (bw >= cw * 0.97 && bh >= ch * 0.97) { resolve(dataUrl); return; }
        const pad = 10;
        const sx = Math.max(0, minX - pad);
        const sy = Math.max(0, minY - pad);
        const sw = Math.min(cw - sx, bw + pad * 2);
        const sh = Math.min(ch - sy, bh + pad * 2);
        const out = document.createElement('canvas');
        out.width = sw; out.height = sh;
        const octx = out.getContext('2d');
        octx.fillStyle = '#ffffff';
        octx.fillRect(0, 0, sw, sh);
        octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        console.log(`[KARDEX] Vista previa recortada: ${cw}x${ch} -> ${sw}x${sh}`);
        resolve(out.toDataURL('image/png'));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  async function showImage(containerId, dataUrl, recordKey) {
    const wrap = $(containerId);
    const dimsEl = $(containerId + '-dims');
    wrap.innerHTML = '';
    if (dimsEl) dimsEl.textContent = '';
    if (dataUrl) {
      let shown = dataUrl;
      try { shown = await cropDataUrl(dataUrl); } catch (e) { shown = dataUrl; }
      if (recordKey && shown !== dataUrl && modalRecord) modalRecord[recordKey] = shown;
      const img = document.createElement('img');
      img.src = shown;
      img.onload = () => {
        if (dimsEl) dimsEl.textContent = `${img.naturalWidth}×${img.naturalHeight}px`;
      };
      wrap.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'preview-placeholder';
      ph.textContent = 'Sin imagen';
      wrap.appendChild(ph);
    }
  }

  function renderModalFields(record, readonly) {
    const fg = $('front-fields');
    const bg = $('back-fields');
    const lg = $('labor-fields');
    fg.innerHTML = FRONT_FIELDS.map(k => buildFieldHtml(k, readonly)).join('');
    bg.innerHTML = BACK_FIELDS.map(k => buildFieldHtml(k, readonly)).join('');
    lg.innerHTML = LABOR_FIELDS.map(k => buildLaborFieldHtml(k, readonly)).join('');
    FRONT_FIELDS.forEach(([k]) => fillField(k, record[k]));
    BACK_FIELDS.forEach(([k]) => fillField(k, record[k]));
    LABOR_FIELDS.forEach(([k]) => fillField(k, record[k]));
    setSelect('sexo', normalizeSexo(record.sexo), SEXO_OPTS);
    setSelect('estado_civil', normalizeCivil(record.estado_civil), CIVIL_OPTS);
    setSelect('tipo_sangre', normalizeSangre(record.tipo_sangre), SANGRE_OPTS);
    setSelect('tipo_salario', normalizeTipoSalario(record.tipo_salario), TIPO_SALARIO_OPTS);
    setSelect('tipo_contrato', normalizeContrato(record.tipo_contrato), CONTRATO_OPTS);
    $('f-nota').value = record.nota || '';
    $('f-nota').disabled = readonly;
  }

  function collectRecord() {
    const r = {};
    [...FRONT_FIELDS, ...BACK_FIELDS, ...LABOR_FIELDS].forEach(([k]) => {
      const el = $('f-' + k);
      r[k] = el ? el.value.trim() : '';
    });
    r.nota = $('f-nota').value.trim();
    r.frente = modalRecord.frente || null;
    r.reverso = modalRecord.reverso || null;
    return r;
  }

  async function openEmployee(id) {
    try {
      const res = await window.api.getEmployee(id);
      if (!res.ok) throw new Error(res.error);
      modalRecord = res.data;
      editId = id;
      showEmployeeModal();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function showEmployeeModal() {
    if (!modalRecord) return;
    const editing = !!editId;
    const readonly = !canEdit();
    setModalTab('identificacion');
    $('employee-modal-title').textContent = editing ? 'Expediente #' + editId : 'Nuevo expediente';
    $('btn-save-employee').textContent = editing ? 'Guardar cambios' : 'Guardar expediente';
    $('btn-save-employee').disabled = readonly;
    $('btn-delete-employee').classList.toggle('hidden', !(editing && canEdit()));
    $('btn-load-front').disabled = readonly;
    $('btn-load-back').disabled = readonly;
    $('btn-reprocess').disabled = readonly;
    $('btn-reprocess').classList.toggle('hidden', !lastFrontFile);
    refreshAiControls();
    renderModalFields(modalRecord, readonly);
    renderVacaciones(editId || null, canEdit());
    showImage('preview-front', modalRecord.frente, 'frente');
    showImage('preview-back', modalRecord.reverso, 'reverso');
    $('ocr-text').textContent = modalRecord.ocrText || '(sin OCR)';
    $('employee-modal').classList.remove('hidden');
    const docsVisible = editing && canEdit();
    $('btn-export-constancia').classList.toggle('hidden', !docsVisible);
    $('btn-export-carta-salario').classList.toggle('hidden', !docsVisible);
    $('btn-export-solicitud').classList.toggle('hidden', !docsVisible);
    $('sel-export-format').classList.toggle('hidden', !docsVisible);
    loadHistorial(editId);
  }

  function refreshAiControls() {
    const show = !!(aiConfigured && canEdit() && modalRecord && modalRecord.frente);
    const aiBtn = $('btn-ai-extract');
    aiBtn.classList.toggle('hidden', !show);
    aiBtn.disabled = false;
    const label = aiProviderLabel();
    aiBtn.textContent = aiConfigured
      ? `✨ Extraer con IA${label ? ` (${label})` : ''}`
      : '✨ Extraer con IA (falta clave de IA)';
    $('ai-provider').classList.toggle('hidden', !(show && aiProviders.length > 1));
  }

  function aiProviderLabel() {
    const v = $('ai-provider').value;
    return v === 'gemini' ? 'Gemini' : v === 'openai' ? 'OpenAI' : '';
  }

  function closeEmployeeModal() {
    $('employee-modal').classList.add('hidden');
    editId = null;
    modalRecord = null;
    closeCedulaLightbox();
  }

  function setModalTab(name) {
    document.querySelectorAll('#employee-modal .modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('#employee-modal .tab-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === name));
  }

  function showCedulaAmpliada(side) {
    const src = modalRecord && (side === 'frente' ? modalRecord.frente : modalRecord.reverso);
    const img = $('lightbox-img');
    const title = side === 'frente' ? 'Cédula — Frente' : 'Cédula — Reverso';
    if (!src) { toast('No hay imagen de ' + (side === 'frente' ? 'frente' : 'reverso') + ' para mostrar.', 'info'); return; }
    $('lightbox-title').textContent = title;
    img.src = src;
    $('cedula-lightbox').classList.remove('hidden');
  }

  function closeCedulaLightbox() {
    $('cedula-lightbox').classList.add('hidden');
    $('lightbox-img').src = '';
  }

  function setLoading(on, text) {
    $('cedula-loading').classList.toggle('hidden', !on);
    if (text) $('cedula-loading-text').textContent = text;
  }

  async function loadCedula(filePath, front) {
    try {
      setLoading(true, front ? 'Leyendo cédula: OCR + código de barras…' : 'Cargando imagen del reverso…');
      const res = await window.api.processCedula(filePath);
      if (!res.ok) throw new Error(res.error);
      const r = res.data;
      if (front) {
        lastFrontFile = filePath;
        modalRecord.frente = r.front;
        if (r.back) modalRecord.reverso = r.back;
        if (r.barcode) modalRecord.cedula = r.barcode;
        Object.assign(modalRecord, r.fields);
        $('ocr-text').textContent = r.ocrText;
        renderModalFields(modalRecord, !canEdit());
        toast('Campos rellenados automáticamente', 'success');
      } else {
        modalRecord.reverso = r.front;
        showImage('preview-back', r.front);
        toast('Reverso actualizado', 'success');
      }
      showImage('preview-front', modalRecord.frente, 'frente');
      showImage('preview-back', modalRecord.reverso, 'reverso');
      refreshAiControls();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function swapSides() {
    if (!modalRecord) return;
    const t = modalRecord.frente;
    modalRecord.frente = modalRecord.reverso;
    modalRecord.reverso = t;
    showImage('preview-front', modalRecord.frente, 'frente');
    showImage('preview-back', modalRecord.reverso, 'reverso');
    toast('Lados intercambiados', 'info');
  }

  async function saveEmployee() {
    try {
      const data = collectRecord();
      if (!data.cedula && !data.nombres && !data.apellidos) {
        throw new Error('Complete al menos la cédula o el nombre del empleado');
      }
      const res = editId
        ? await window.api.updateEmployee(editId, data)
        : await window.api.createEmployee(data);
      if (!res.ok) throw new Error(res.error);
      toast(editId ? 'Expediente actualizado' : 'Expediente creado', 'success');
      closeEmployeeModal();
      refreshEmployeeLists();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function deleteEmployee() {
    if (!editId) return;
    if (!confirm('¿Eliminar este expediente? Esta acción no se puede deshacer.')) return;
    try {
      const res = await window.api.deleteEmployee(editId);
      if (!res.ok) throw new Error(res.error);
      toast('Expediente eliminado', 'success');
      closeEmployeeModal();
      refreshEmployeeLists();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  /* ============ Usuarios ============ */
  async function loadUsers() {
    try {
      const res = await window.api.listUsers();
      if (!res.ok) throw new Error(res.error);
      const tb = $('users-tbody');
      tb.innerHTML = res.data.map(u => `
        <tr>
          <td><strong>${esc(u.username)}</strong></td>
          <td>${esc(u.full_name || '')}</td>
          <td><span class="role-badge ${roleClass(u.role)}">${roleLabel(u.role)}</span></td>
          <td class="row-actions">
            <button class="btn btn-ghost" data-role="editor" data-uid="${u.id}">Editor</button>
            <button class="btn btn-ghost" data-role="admin" data-uid="${u.id}">Admin</button>
            <button class="btn btn-ghost" data-role="invitado" data-uid="${u.id}">Invitado</button>
            <button class="btn btn-danger" data-del="${u.id}">Eliminar</button>
          </td>
        </tr>`).join('');
      tb.querySelectorAll('[data-role]').forEach(b => b.addEventListener('click', async () => {
        try {
          const r = await window.api.updateUser({ id: Number(b.dataset.uid), role: b.dataset.role });
          if (!r.ok) throw new Error(r.error);
          toast('Rol actualizado', 'success');
          loadUsers();
        } catch (e) { toast(e.message, 'error'); }
      }));
      tb.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        const id = Number(b.dataset.del);
        if (id === currentUser.id) { toast('No puede eliminar su propia cuenta', 'error'); return; }
        if (!confirm('¿Eliminar este usuario?')) return;
        try {
          const r = await window.api.deleteUser(id);
          if (!r.ok) throw new Error(r.error);
          toast('Usuario eliminado', 'success');
          loadUsers();
        } catch (e) { toast(e.message, 'error'); }
      }));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function createUser(ev) {
    ev.preventDefault();
    try {
      const r = await window.api.createUser({
        username: $('user-username').value,
        full_name: $('user-fullname').value,
        password: $('user-password').value,
        role: $('user-role-select').value
      });
      if (!r.ok) throw new Error(r.error);
      toast('Usuario creado', 'success');
      $('user-form').reset();
      loadUsers();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  /* ============ Bitácora ============ */
  async function loadAudit() {
    try {
      const res = await window.api.listAudit(100);
      if (!res.ok) throw new Error(res.error);
      $('audit-tbody').innerHTML = res.data.map(a => `
        <tr>
          <td>${esc(a.created_at)}</td>
          <td>${esc(a.username)}</td>
          <td><code>${esc(a.action)}</code></td>
          <td>${esc(a.detail)}</td>
        </tr>`).join('');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  /* ============ Event wiring ============ */
  function wire() {
    $('login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      $('login-btn').disabled = true;
      try {
        const res = await window.api.login($('login-user').value, $('login-pass').value);
        if (!res.ok) throw new Error(res.error);
        currentUser = res.data;
        showApp();
        if (res.data.licenseWarning) {
          toast('Advertencia: ' + res.data.licenseWarning + '. Contacte al administrador.', 'warning', 6000);
        }
      } catch (e) {
        const box = $('login-error');
        box.textContent = e.message;
        box.classList.remove('hidden');
      } finally {
        $('login-btn').disabled = false;
      }
    });

    $('btn-server-config').addEventListener('click', openServerConfig);
    $('server-modal-close').addEventListener('click', closeServerConfig);
    $('btn-server-cancel').addEventListener('click', closeServerConfig);
    $('server-modal').addEventListener('click', (e) => { if (e.target === $('server-modal')) closeServerConfig(); });
    $('btn-cloud-test').addEventListener('click', testCloudConnection);
    $('btn-cloud-login').addEventListener('click', connectCloud);
    ['cloud-url', 'cloud-user', 'cloud-pass'].forEach((id) =>
      $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') connectCloud(); }));
    $('btn-server-save').addEventListener('click', saveServerConfig);
    document.querySelectorAll('#conn-mode-cards .mode-card').forEach((card) =>
      card.addEventListener('click', () => setConnMode(card.dataset.mode)));
    document.querySelectorAll('#wizard-mode-cards .mode-card').forEach((card) =>
      card.addEventListener('click', () => setWizardMode(card.dataset.mode)));
    $('btn-wizard-next').addEventListener('click', wizardContinue);
    $('btn-wizard-cancel').addEventListener('click', async () => {
      try { await window.api.wizardDone(); } catch (e) { /* noop */ }
      $('wizard-modal').classList.add('hidden');
    });

    $('btn-license').addEventListener('click', openLicenseModal);
    $('license-modal-close').addEventListener('click', () => $('license-modal').classList.add('hidden'));
    $('btn-license-cancel').addEventListener('click', () => $('license-modal').classList.add('hidden'));
    $('license-modal').addEventListener('click', (e) => { if (e.target === $('license-modal')) $('license-modal').classList.add('hidden'); });
    $('btn-license-activate').addEventListener('click', activateLicense);
    $('btn-license-file').addEventListener('click', () => $('license-file').click());
    $('license-file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { $('license-key').value = String(reader.result || '').trim(); };
      reader.readAsText(f);
      e.target.value = '';
    });

    $('logout-btn').addEventListener('click', async () => {
      try { await window.api.logout(); } catch (e) {}
      currentUser = null;
      editId = null;
      modalRecord = null;
      showLogin();
    });

    $('sidebar-toggle').addEventListener('click', () => {
      const sb = $('sidebar');
      sb.classList.toggle('collapsed');
      const btn = $('sidebar-toggle');
      btn.title = sb.classList.contains('collapsed') ? 'Expandir menú' : 'Colapsar menú';
    });

    document.querySelectorAll('.nav-item').forEach(n =>
      n.addEventListener('click', () => go(n.dataset.view)));

    let searchTimer = null;
    $('search-input').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadEmployees, 300);
    });

    $('emp-prev').addEventListener('click', () => {
      if (empPage > 1) { empPage--; renderEmployeesPage(); }
    });
    $('emp-next').addEventListener('click', () => {
      if (empPage < Math.ceil(empAllRows.length / EMP_PAGE_SIZE)) { empPage++; renderEmployeesPage(); }
    });

    let searchInactiveTimer = null;
    $('search-inactive').addEventListener('input', () => {
      clearTimeout(searchInactiveTimer);
      searchInactiveTimer = setTimeout(loadInactiveEmployees, 300);
    });

    $('inactive-prev').addEventListener('click', () => {
      if (inactivePage > 1) { inactivePage--; renderInactivePage(); }
    });
    $('inactive-next').addEventListener('click', () => {
      if (inactivePage < Math.ceil(inactiveAllRows.length / INACTIVE_PAGE_SIZE)) { inactivePage++; renderInactivePage(); }
    });

    $('btn-new-employee').addEventListener('click', () => {
      editId = null;
      lastFrontFile = null;
      modalRecord = emptyRecord();
      showEmployeeModal();
    });

    $('btn-open-empleados').addEventListener('click', () => go('empleados'));

    $('btn-export-cedulas-pdf').addEventListener('click', exportCedulasPdf);
    $('btn-export-cedula-pdf').addEventListener('click', exportCedulaPdf);
    $('btn-export-constancia').addEventListener('click', exportConstancia);
    $('btn-export-carta-salario').addEventListener('click', exportCartaSalario);
    $('btn-export-solicitud').addEventListener('click', exportSolicitud);

    $('employee-modal-close').addEventListener('click', closeEmployeeModal);
    $('btn-cancel-employee').addEventListener('click', closeEmployeeModal);
    $('employee-modal').addEventListener('click', (e) => { if (e.target === $('employee-modal')) closeEmployeeModal(); });

    $('btn-save-employee').addEventListener('click', saveEmployee);
    $('btn-delete-employee').addEventListener('click', deleteEmployee);

    $('btn-load-front').addEventListener('click', async () => {
      try {
        const res = await window.api.pickCedulaFile();
        if (!res.ok) throw new Error(res.error);
        if (!res.data) return;
        await loadCedula(res.data, true);
      } catch (e) { toast(e.message, 'error'); }
    });

    $('btn-load-back').addEventListener('click', async () => {
      try {
        const res = await window.api.pickCedulaFile();
        if (!res.ok) throw new Error(res.error);
        if (!res.data) return;
        await loadCedula(res.data, false);
      } catch (e) { toast(e.message, 'error'); }
    });

    $('btn-swap-sides').addEventListener('click', swapSides);

    document.querySelectorAll('#employee-modal .modal-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        setModalTab(tab.dataset.tab);
        tab.scrollIntoView({ block: 'nearest' });
      });
    });

    document.querySelectorAll('.btn-view-full').forEach(btn => {
      btn.addEventListener('click', () => showCedulaAmpliada(btn.getAttribute('data-side')));
    });
    $('lightbox-close').addEventListener('click', closeCedulaLightbox);
    $('lightbox-close-btn').addEventListener('click', closeCedulaLightbox);
    $('cedula-lightbox').addEventListener('click', (e) => {
      if (e.target === $('cedula-lightbox')) closeCedulaLightbox();
    });

    $('btn-reprocess').addEventListener('click', async () => {
      if (!lastFrontFile) return;
      try {
        setLoading(true, 'Reprocesando OCR…');
        const res = await window.api.processCedula(lastFrontFile);
        if (!res.ok) throw new Error(res.error);
        Object.assign(modalRecord, res.data.fields);
        if (res.data.barcode) modalRecord.cedula = res.data.barcode;
        $('ocr-text').textContent = res.data.ocrText;
        renderModalFields(modalRecord, !canEdit());
        toast('OCR actualizado', 'success');
      } catch (e) { toast(e.message, 'error'); }
      finally { setLoading(false); }
    });

    $('btn-ai-extract').addEventListener('click', async () => {
      if (!modalRecord || !modalRecord.frente) {
        toast('Primero cargue el frente de la cédula', 'error');
        return;
      }
      if (!aiConfigured) {
        toast('No hay ninguna clave de IA configurada. Vaya a Correos → Inteligencia Artificial para guardarla', 'error');
        return;
      }
      const btn = $('btn-ai-extract');
      const provider = $('ai-provider').value || undefined;
      btn.disabled = true;
      btn.textContent = `✨ Analizando con ${aiProviderLabel() || 'IA'}…`;
      try {
        const res = await window.api.extractWithAI(modalRecord.frente, modalRecord.reverso || null, provider);
        if (!res.ok) throw new Error(res.error);
        Object.assign(modalRecord, res.data.fields);
        renderModalFields(modalRecord, !canEdit());
        const filled = Object.values(res.data.fields).filter((v) => v && String(v).trim()).length;
        toast(`La IA rellenó ${filled} campo(s)`, 'success');
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        btn.disabled = false;
        refreshAiControls();
      }
    });

    $('ai-provider').addEventListener('change', refreshAiControls);

    $('user-form').addEventListener('submit', createUser);

    $('nomina-mes').value = new Date().getMonth() + 1;
    $('nomina-anio').value = new Date().getFullYear();
    $('btn-nomina-calcular').addEventListener('click', loadNomina);
    $('btn-nomina-regalia').addEventListener('click', loadRegalia);
    $('btn-nomina-csv').addEventListener('click', exportNominaExcel);
    $('btn-regalia-csv').addEventListener('click', exportRegaliaExcel);
    $('btn-he-save').addEventListener('click', saveHorasExtra);
    $('btn-inc-add').addEventListener('click', addIncentivo);
    $('btn-ded-add').addEventListener('click', addDeduccion);
    $('btn-vp-save').addEventListener('click', savePagoVacaciones);
    $('btn-vp-delete').addEventListener('click', deletePagoVacaciones);
    $('vp-modalidad').addEventListener('change', () => {
      const vp = $('vp-modalidad').value;
      $('vp-dias').readOnly = vp === 'completo';
      if (vp === 'completo') $('vp-dias').value = $('vp-disponibles').value;
      recalcVpMonto();
    });
    $('vp-dias').addEventListener('input', recalcVpMonto);
    $('nomina-emp').addEventListener('change', loadNomina);
    $('nomina-depto').addEventListener('change', loadNomina);
    $('nomina-vista').addEventListener('change', loadNomina);
    const goNomina = () => loadNomina();
    $('nomina-mes').addEventListener('change', goNomina);
    $('nomina-anio').addEventListener('change', goNomina);

    $('btn-rep-plantilla').addEventListener('click', loadReportPlantilla);
    $('btn-rep-antiguedad').addEventListener('click', loadReportAntiguedad);
    $('btn-rep-cumpleanos').addEventListener('click', loadReportCumpleanos);
    $('btn-rep-deptos').addEventListener('click', loadReportDepartamentos);
    $('btn-rep-609').addEventListener('click', loadReport609);
    $('btn-rep-nomina-deptos').addEventListener('click', loadReportNominaDepartamentos);
    $('btn-rep-empleados').addEventListener('click', loadReportEmpleados);
    $('btn-rep-cedulas').addEventListener('click', loadReportCedulasVencer);
    $('btn-rep-aniversarios').addEventListener('click', loadReportAniversarios);
    $('btn-rep-beneficios').addEventListener('click', loadReportBeneficios);
    $('btn-rep-csv').addEventListener('click', exportReportExcel);
    $('btn-rep-imprimir').addEventListener('click', printReport);
    $('btn-rep-pdf').addEventListener('click', exportReportPdf);

    $('btn-backup-create').addEventListener('click', createBackup);
    $('btn-salarios-reset').addEventListener('click', resetSalarioHistorial);
    $('btn-backup-save-settings').addEventListener('click', saveBackupSettings);
    $('btn-backup-dir').addEventListener('click', pickBackupDir);
    $('btn-backup-restore-file').addEventListener('click', restoreBackupFile);
    $('btn-import-template').addEventListener('click', downloadImportTemplate);
    $('btn-import-excel').addEventListener('click', pickImportFile);
    $('btn-import-excel-header').addEventListener('click', pickImportFile);
    $('import-file').addEventListener('change', handleImportFile);

    $('btn-notif-test').addEventListener('click', testNotificacion);
    $('btn-notif-refresh').addEventListener('click', () => { loadNotificaciones(); loadNotifSettings(); });
    $('btn-notif-save').addEventListener('click', saveNotifSettings);
    $('notif-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.notif-dismiss');
      if (btn) dismissNotif(btn.dataset.dismissId);
    });

    $('btn-ai-save').addEventListener('click', saveAiSettings);
    $('btn-mail-send').addEventListener('click', sendSelectedMail);
    $('btn-mail-reminders').addEventListener('click', sendMailReminders);
    $('btn-mail-log').addEventListener('click', loadMailLog);
    $('btn-mail-open').addEventListener('click', openComposedMail);
    $('btn-contacto-add').addEventListener('click', addMailContact);
    $('contacto-email').addEventListener('keydown', (e) => { if (e.key === 'Enter') addMailContact(); });
    $('mail-contacts').addEventListener('change', updateCustomCount);
    document.querySelectorAll('[data-mail-template]').forEach(b => b.addEventListener('click', () => applyMailTemplate(b.dataset.mailTemplate)));
    $('mail-filter').addEventListener('input', renderMailRecipients);
    $('mail-recipients').addEventListener('change', () => { updateMailCount(); updateCustomCount(); });
    $('mail-select-all').addEventListener('change', () => {
      document.querySelectorAll('.mail-rec-cb').forEach(cb => { cb.checked = $('mail-select-all').checked; });
      updateMailCount();
      updateCustomCount();
    });

    window.api.onNotificacionesUpdate((payload) => {
      if (!payload) return;
      updateNotifBadge((payload.events || []).length);
      if (!$('view-notificaciones').classList.contains('hidden')) renderNotificaciones(payload);
    });

    $('liquidacion-modal-close').addEventListener('click', closeLiquidacion);
    $('btn-liquidacion-cancel').addEventListener('click', closeLiquidacion);
    $('liquidacion-modal').addEventListener('click', (e) => { if (e.target === $('liquidacion-modal')) closeLiquidacion(); });
    $('btn-liquidacion-confirm').addEventListener('click', confirmLiquidacion);
    ['liq-fecha-baja', 'liq-preaviso', 'liq-cesantia', 'liq-vacaciones', 'liq-navidad']
      .forEach(id => $(id).addEventListener('change', recalcularLiquidacion));

    $('finiquito-modal-close').addEventListener('click', () => $('finiquito-modal').classList.add('hidden'));
    $('btn-finiquito-close').addEventListener('click', () => $('finiquito-modal').classList.add('hidden'));
    $('finiquito-modal').addEventListener('click', (e) => { if (e.target === $('finiquito-modal')) $('finiquito-modal').classList.add('hidden'); });
    $('finiquito-list').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del-liq]');
      if (del) deleteLiquidacion(Number(del.dataset.delLiq));
    });

    $('btn-historial-finiquitos').addEventListener('click', showHistorialFiniquitos);
    $('btn-inactivos-excel').addEventListener('click', exportInactivosExcel);
    $('historial-modal-close').addEventListener('click', () => $('historial-modal').classList.add('hidden'));
    $('btn-historial-close').addEventListener('click', () => $('historial-modal').classList.add('hidden'));
    $('historial-modal').addEventListener('click', (e) => { if (e.target === $('historial-modal')) $('historial-modal').classList.add('hidden'); });
    $('historial-tbody').addEventListener('click', (e) => {
      const ver = e.target.closest('[data-ver-liq]');
      if (ver) showFiniquito(Number(ver.dataset.verLiq));
    });

    $('reintegrar-modal-close').addEventListener('click', closeReintegrar);
    $('btn-reintegrar-cancel').addEventListener('click', closeReintegrar);
    $('reintegrar-modal').addEventListener('click', (e) => { if (e.target === $('reintegrar-modal')) closeReintegrar(); });
    $('btn-reintegrar-confirm').addEventListener('click', confirmReintegrar);
    $('reintegrar-mismo-puesto').addEventListener('change', function() {
      $('reintegrar-cambios').classList.toggle('hidden', this.checked);
    });

    $('btn-doc-logo').addEventListener('click', pickDocLogo);
    $('doc-logo-file').addEventListener('change', handleDocLogoFile);
    $('btn-doc-save').addEventListener('click', saveDocSettings);
    $('btn-doc-reset').addEventListener('click', resetDocSettings);
    $('btn-doc-logo-remove').addEventListener('click', removeDocLogo);
  }

  wire();
  init();

  /* ============ AUTO-UPDATE BAR ============ */
  const ubBar = $('update-bar');
  const ubText = $('update-bar-text');
  const ubVersion = $('update-bar-version');
  const ubIcon = $('update-bar-icon');
  const ubProgressWrap = $('update-bar-progress-wrap');
  const ubProgressFill = $('update-bar-progress-fill');
  const ubPercent = $('update-bar-percent');
  const ubActions = $('update-bar-actions');
  const ubBtnInstall = $('update-bar-btn-install');
  const ubBtnClose = $('update-bar-btn-close');

  function showUpdateBar() { ubBar.classList.remove('hidden'); }
  function hideUpdateBar() { ubBar.classList.add('hidden'); }

  if (window.api.onUpdateAvailable) {
    window.api.onUpdateAvailable((data) => {
      showUpdateBar();
      ubIcon.innerHTML = '&#8635;';
      ubText.textContent = 'Nueva version disponible — descargando...';
      ubVersion.textContent = 'v' + data.version;
      ubProgressWrap.classList.remove('hidden');
      ubActions.classList.add('hidden');
      ubProgressFill.style.width = '0%';
      ubPercent.textContent = '0%';
    });
  }
  if (window.api.onUpdateProgress) {
    window.api.onUpdateProgress((data) => {
      ubProgressFill.style.width = data.percent + '%';
      ubPercent.textContent = data.percent + '%';
    });
  }
  if (window.api.onUpdateDownloaded) {
    window.api.onUpdateDownloaded((data) => {
      ubIcon.innerHTML = '&#10003;';
      ubText.textContent = 'Actualizacion v' + data.version + ' lista para instalar.';
      ubProgressWrap.classList.add('hidden');
      ubActions.classList.remove('hidden');
    });
  }
  if (window.api.onUpdateError) {
    window.api.onUpdateError((data) => {
      ubIcon.innerHTML = '&#10007;';
      ubText.textContent = 'Error: ' + (data.message || 'No se pudo descargar la actualizacion.');
      ubVersion.textContent = '';
      ubProgressWrap.classList.add('hidden');
      ubActions.classList.remove('hidden');
      ubBtnInstall.classList.add('hidden');
    });
  }
  ubBtnInstall.addEventListener('click', () => { window.api.updateInstall(); });
  ubBtnClose.addEventListener('click', () => { hideUpdateBar(); ubBtnInstall.classList.remove('hidden'); });
})();
