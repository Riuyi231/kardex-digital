'use strict';
const BASE = process.env.NEXALERT_SERVER_URL || 'http://127.0.0.1:3200';
let deviceToken = process.env.DEVICE_TOKEN || '';
let failures = 0;

function check(name, cond, extra) {
  if (cond) console.log('  OK  ' + name);
  else { console.log('  FAIL ' + name + (extra ? ' -> ' + extra : '')); failures++; }
}

async function post(path, body, token) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body || {})
  });
  return { status: res.status, json: await res.json() };
}

async function get(path, token) {
  const res = await fetch(BASE + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  return { status: res.status, json: await res.json() };
}

(async () => {
  console.log('nexalert-server API test');
  console.log('base:', BASE);

  const h = await get('/api/health');
  check('health', h.status === 200 && h.json.ok);

  if (!deviceToken) {
    const reg = await post('/api/device/register', { nombre: 'test' });
    check('registro dispositivo', reg.status === 200 && reg.json.deviceToken);
    deviceToken = reg.json.deviceToken;
  }
  console.log('deviceToken:', deviceToken);

  const ts = Date.now();
  const push = await post('/api/sync', {
    deviceToken,
    sinceSeq: 0,
    push: {
      tecnicos: [{ id: 9001, nombre: 'Tecnico Test', usuario: 'test' + ts, pass: 'abc123' }],
      reportes: [{
        id: 9100, client_id: 1, client_nombre: 'Cliente Test', equipo_nombre: 'Equipo A',
        descripcion: 'Descripcion test', fecha: '2026-08-16', estado: 'abierto',
        tecnico_id: 9001, tecnico_nombre: 'Tecnico Test', updated_at: new Date().toISOString()
      }, {
        id: 9101, client_id: 1, client_nombre: 'Cliente Test', equipo_nombre: 'Equipo B',
        descripcion: 'Otro reporte', fecha: '2026-08-16', estado: 'abierto',
        tecnico_id: 9999, tecnico_nombre: 'Otra persona', updated_at: new Date().toISOString()
      }]
    }
  });
  check('push reportes+tecnico', push.status === 200 && push.json.applied.reportes.length === 2 && push.json.applied.tecnicos.length === 1);

  const login = await post('/api/auth/login', { usuario: 'test' + ts, pass: 'abc123' });
  check('login', login.status === 200 && login.json.token);
  const token = login.json.token;

  const list = await get('/api/reportes', token);
  check('solo reportes asignados', list.status === 200 && list.json.data.length === 1 && list.json.data[0].id === 9100,
    JSON.stringify(list.json.data && list.json.data.map(r => r.id)));

  const det = await get('/api/reportes/9100', token);
  check('detalle reporte', det.status === 200 && det.json.data.id === 9100 && Array.isArray(det.json.data.notas));

  const detOtro = await get('/api/reportes/9101', token);
  check('denegado reporte no asignado', detOtro.status === 404);

  const st = await post('/api/reportes/9100/estado', { estado: 'resuelto' }, token);
  check('cambio estado', st.status === 200 && st.json.data.estado === 'resuelto' && st.json.data.resuelto_at);

  const stBad = await post('/api/reportes/9100/estado', { estado: 'inventado' }, token);
  check('estado invalido rechazado', stBad.status === 400);

  const nt = await post('/api/reportes/9100/notas', { texto: '  Comentario test  ' }, token);
  check('agregar nota', nt.status === 200 && nt.json.data.texto === 'Comentario test');

  const ntBad = await post('/api/reportes/9100/notas', { texto: '   ' }, token);
  check('nota vacia rechazada', ntBad.status === 400);

  const pull = await post('/api/sync', { deviceToken, sinceSeq: push.json.seq - 1, push: {} });
  check('pull incremental', pull.status === 200 && Array.isArray(pull.json.cambios) && pull.json.cambios.length >= 2);
  const estados = pull.json.cambios.filter(c => c.tipo === 'estado');
  const notas = pull.json.cambios.filter(c => c.tipo === 'nota');
  check('pull tiene 1 estado + 1 nota (sin duplicado)', estados.length === 1 && notas.length === 1,
    'estados=' + estados.length + ' notas=' + notas.length);

  const badToken = await get('/api/reportes', 'token-invalido');
  check('token invalido rechazado', badToken.status === 401);

  const badDevice = await post('/api/sync', { deviceToken: 'no-existe', sinceSeq: 0, push: {} });
  check('deviceToken invalido rechazado', badDevice.status === 401);

  const me = await get('/api/auth/me', token);
  check('auth/me', me.status === 200 && me.json.tecnico.id === 9001);

  console.log(failures === 0 ? '\nTODO OK' : '\n' + failures + ' fallo(s)');
  process.exit(failures === 0 ? 0 : 1);
})();
