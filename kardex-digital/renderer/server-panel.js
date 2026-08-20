(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let status = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function render(s) {
    status = s;
    if (!s) return;
    const addrs = (s.ips && s.ips.length ? s.ips : ['127.0.0.1']).map((ip) => 'http://' + ip + ':' + s.port);
    const list = $('url-list');
    if (addrs.length === 1) {
      list.innerHTML = '<li>' + esc(addrs[0]) + '</li><li class="hint">Solo se detectó la IP local. Si otros equipos están en otra red, la IP aparecerá aquí al arrancar el servidor.</li>';
    } else {
      list.innerHTML = addrs.map((a) => '<li>' + esc(a) + '</li>').join('');
    }
    $('token').value = s.token || '';
    $('token-warn').style.display = s.tokenRequired ? 'none' : '';
    $('data-dir').textContent = s.dataDir || '';
    $('port').textContent = s.port || '-';
    $('port2').textContent = s.port || '-';
    const name = s.name || 'kardex';
    $('server-name').value = name;
    $('name-display').textContent = name;
    const nodeList = s.nodes || [];
    const max = Number(s.maxNodes) || 0;
    $('nodes-summary').textContent = max > 0
      ? nodeList.length + ' de ' + max + ' puesto(s) en uso. Cada equipo conectado ocupa un puesto; se libera tras 10 min de inactividad.'
      : 'Sin límite de puestos (licencia sin restricción de red).';
    $('nodes-list').innerHTML = nodeList.length
      ? nodeList.map((n) => {
          const ago = Math.max(0, Math.round((Date.now() - n.lastSeen) / 60000));
          return '<li>' + esc(n.id) + ' · último acceso hace ' + ago + ' min</li>';
        }).join('')
      : '<li class="hint">Aún no hay equipos conectados.</li>';
  }

  async function refresh() {
    try {
      const s = await window.api.serverStatus();
      render(s);
    } catch (e) { /* noop */ }
  }

  $('btn-toggle-token').addEventListener('click', () => {
    const t = $('token');
    if (t.type === 'password') { t.type = 'text'; $('btn-toggle-token').textContent = 'Ocultar'; }
    else { t.type = 'password'; $('btn-toggle-token').textContent = 'Mostrar'; }
  });

  $('btn-copy-token').addEventListener('click', () => {
    const t = $('token');
    t.type = 'text';
    t.select();
    try { document.execCommand('copy'); } catch (e) { /* noop */ }
    t.type = 'password';
  });

  $('btn-regenerate').addEventListener('click', async () => {
    try {
      const r = await window.api.serverRegenerateToken();
      if (r && r.ok) {
        $('token').value = r.token;
        $('token-warn').style.display = 'none';
      }
    } catch (e) { /* noop */ }
  });

  $('btn-save-name').addEventListener('click', async () => {
    const v = $('server-name').value.trim();
    if (!v) return;
    $('btn-save-name').disabled = true;
    try {
      const r = await window.api.serverSetName(v);
      if (r && r.ok) $('name-display').textContent = r.name;
    } catch (e) {
      $('btn-save-name').textContent = 'Error: revisa el nombre';
      setTimeout(() => { $('btn-save-name').textContent = 'Guardar'; $('btn-save-name').disabled = false; }, 2500);
      return;
    }
    $('btn-save-name').textContent = 'Guardado ✓';
    setTimeout(() => { $('btn-save-name').textContent = 'Guardar'; $('btn-save-name').disabled = false; }, 2000);
  });

  $('btn-open-folder').addEventListener('click', () => window.api.serverOpenDataFolder());
  $('btn-to-local').addEventListener('click', () => window.api.serverToLocal());
  $('btn-stop').addEventListener('click', () => window.api.serverStop());

  /* ============ Visibilidad en la red ============ */
  const KNOWN_AV = [
    { match: /norton/i, tip: 'Norton: abre el panel y en "Firewall / Red" permite KARDEX Digital.' },
    { match: /mcafee/i, tip: 'McAfee: en el Firewall, permite la aplicación KARDEX Digital.' },
    { match: /avast|avg/i, tip: 'Avast/AVG: Configuración → Excepciones → añade KARDEX Digital.' },
    { match: /kaspersky/i, tip: 'Kaspersky: Configuración → Protección de red → aplicaciones de confianza → añade KARDEX Digital.' },
    { match: /eset|nod32/i, tip: 'ESET: Configuración → Red → Firewall → añade KARDEX Digital.' },
    { match: /bitdefender/i, tip: 'Bitdefender: Firewall → reglas de aplicación → permite KARDEX Digital.' },
    { match: /malwarebytes/i, tip: 'Malwarebytes: Configuración → Seguridad → permite KARDEX Digital en la red.' }
  ];
  let avList = [];

  function isDefender(n) { return /windows defender/i.test(String(n)); }

  function avGuide(names) {
    const third = names.filter((n) => !isDefender(n));
    if (!third.length) {
      return 'Solo Windows Defender (antivirus de Microsoft). Con "Permitir en el Firewall" de arriba debería bastar.';
    }
    const port = (status && status.port) || 18006;
    return third.map((n) => {
      for (const k of KNOWN_AV) {
        if (k.match.test(n)) return '· <b>' + esc(n) + '</b>: ' + k.tip;
      }
      return '· <b>' + esc(n) + '</b>: abre su Firewall y permite KARDEX Digital (o los puertos TCP ' + port + ' y UDP 18007).';
    }).join('<br/>');
  }

  async function loadFirewall() {
    try {
      const r = await window.api.serverFirewallStatus();
      if (!r || !r.ok || !r.data) return;
      const st = r.data;
      const el = $('fw-status');
      if (!st.available) {
        el.textContent = 'No se pudo comprobar el Firewall. Si los clientes no ven el servidor, pulsa "Permitir en el Firewall".';
      } else if (st.tcp && st.udp) {
        el.textContent = '✓ El Firewall ya permite este servidor.';
      } else if (st.tcp || st.udp) {
        el.textContent = '⚠️ Falta una regla del Firewall. Pulsa "Permitir en el Firewall".';
      } else {
        el.textContent = '⚠️ El Firewall puede estar bloqueando a los clientes. Pulsa "Permitir en el Firewall".';
      }
    } catch (e) { /* noop */ }
  }

  async function loadAv() {
    try {
      const r = await window.api.serverAvDetect();
      if (!r || !r.ok || !r.data || !Array.isArray(r.data.list)) return;
      avList = r.data.list;
      const third = avList.filter((n) => !isDefender(n));
      $('av-status').innerHTML = third.length
        ? 'Detectados: <b>' + third.map((n) => esc(n)).join('</b>, <b>') + '</b>.'
        : 'Solo Windows Defender (sin antivirus de terceros).';
      $('av-guide').innerHTML = avGuide(avList);
    } catch (e) { /* noop */ }
  }

  function setFwMsg(text, ok) {
    const m = $('fw-msg');
    m.className = 'fw-msg' + (ok ? ' fw-ok' : (ok === false ? ' fw-bad' : ''));
    m.textContent = text;
  }

  $('btn-firewall-fix').addEventListener('click', async () => {
    const btn = $('btn-firewall-fix');
    btn.disabled = true;
    setFwMsg('Solicitando permiso de administrador… Acepta la ventana de Windows.', null);
    try {
      const r = await window.api.serverFirewallFix({ tcpPort: (status && status.port) || 18006, udpPort: 18007 });
      if (r && r.ok) {
        setFwMsg('✓ Firewall configurado. Tu servidor ya es visible en la red.', true);
        loadFirewall();
      } else {
        setFwMsg((r && r.error) || 'No se pudo configurar el Firewall.', false);
      }
    } catch (e) {
      setFwMsg((e && e.message) || 'No se pudo configurar el Firewall.', false);
    } finally {
      btn.disabled = false;
    }
  });

  $('btn-self-ping').addEventListener('click', async () => {
    setFwMsg('Probando el servidor…', null);
    try {
      const r = await window.api.serverSelfPing();
      if (r && r.ok && r.data) {
        if (r.data.reachable) {
          setFwMsg('✓ El servidor responde correctamente (' + (r.data.latencyMs || 0) + ' ms).', true);
        } else {
          setFwMsg('⚠️ El servidor no responde. Detalle: ' + (r.data.error || 'sin respuesta'), false);
        }
      }
    } catch (e) { /* noop */ }
  });

  function copyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* noop */ }
    document.body.removeChild(ta);
    return ok;
  }

  $('btn-copy-av').addEventListener('click', () => {
    const ips = (status && status.ips && status.ips.length) ? status.ips : [];
    const port = (status && status.port) || 18006;
    const name = (status && status.name) || 'kardex';
    const lines = [
      'KARDEX Digital · Instrucciones para el administrador de red',
      '',
      'Servidor: ' + name + ' · puerto TCP ' + port + ' · detección UDP 18007',
      'Direcciones: ' + (ips.length ? ips.map((i) => 'http://' + i + ':' + port).join(', ') : '(revisar el panel del servidor)'),
      '',
      '1) En el equipo servidor: abrir el panel y pulsar "Permitir en el Firewall" (se pide permiso de administrador).'
    ];
    const third = avList.filter((n) => !isDefender(n));
    if (third.length) {
      lines.push('2) Antivirus externo detectado (' + third.join(', ') + '): permitir KARDEX Digital, o los puertos TCP ' + port + ' y UDP 18007, en su Firewall.');
    } else {
      lines.push('2) No se detectaron antivirus de terceros; Windows Defender se configura con "Permitir en el Firewall".');
    }
    lines.push('3) En cada cliente: escribir "' + name + '" en el campo "Nombre del servidor" de "Conectar al servidor".');
    copyText(lines.join('\n'));
    const b = $('btn-copy-av');
    b.textContent = '✓ Copiado';
    setTimeout(() => { b.textContent = '📋 Copiar instrucciones para el administrador'; }, 1800);
  });

  refresh();
  setInterval(refresh, 5000);
  setInterval(loadFirewall, 30000);
  loadFirewall();
  loadAv();
})();
