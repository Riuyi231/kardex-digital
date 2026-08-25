'use strict';

const dgram = require('dgram');
const os = require('os');

const DEFAULT_PORT = 18007;
const MAGIC = 'KARDEX_DISCOVERY_V1';

let sock = null;

function lanIps() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

function broadcastAddresses(ips) {
  const addrs = [];
  for (const ip of ips) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4) continue;
    addrs.push(p.slice(0, 3).concat([255]).join('.'));
    if (p[0] === 10) addrs.push('10.255.255.255');
    else if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) addrs.push('172.31.255.255');
    else if (p[0] === 192 && p[1] === 168) addrs.push('192.168.255.255');
  }
  addrs.push('255.255.255.255');
  return [...new Set(addrs)];
}

// Responde a los mensajes de descubrimiento de los clientes.
function startDiscovery({ port = DEFAULT_PORT, rpcPort, name = 'Servidor KARDEX', tokenRequired = false } = {}) {
  return new Promise((resolve, reject) => {
    if (sock) { resolve(true); return; }
    const s = dgram.createSocket('udp4');
    s.on('error', (e) => { if (sock === s) sock = null; reject(e); });
    s.on('message', (msg, rinfo) => {
      const text = msg.toString('utf8').trim();
      if (!text.startsWith(MAGIC)) return;
      const payload = JSON.stringify({
        name: String(name),
        port: Number(rpcPort) || 0,
        tokenRequired: !!tokenRequired
      });
      try { s.send(Buffer.from(payload), rinfo.port, rinfo.address); } catch (e) { /* noop */ }
    });
    s.bind(port, () => {
      try { s.setBroadcast(true); } catch (e) { /* noop */ }
      sock = s;
      resolve(true);
    });
  });
}

// Escanea la LAN (broadcast + sondeo del /24) y devuelve los servidores encontrados.
function discoverServers({ port = DEFAULT_PORT, timeout = 2500, sweep = true } = {}) {
  return new Promise((resolve) => {
    const out = new Map();
    const s = dgram.createSocket('udp4');
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      try { s.close(); } catch (e) { /* noop */ }
      resolve([...out.values()]);
    };
    const timer = setTimeout(done, timeout);
    s.on('error', () => { clearTimeout(timer); done(); });
    s.on('message', (msg, rinfo) => {
      let j;
      try { j = JSON.parse(msg.toString('utf8')); } catch (e) { return; }
      if (!j || typeof j.port !== 'number' || !j.port) return;
      const host = rinfo.address;
      const key = host + ':' + j.port;
      if (!out.has(key)) {
        out.set(key, {
          host,
          ip: host,
          port: j.port,
          name: j.name || 'Servidor KARDEX',
          tokenRequired: !!j.tokenRequired
        });
      }
    });
    s.bind(0, () => {
      try { s.setBroadcast(true); } catch (e) { /* noop */ }
      const msg = Buffer.from(MAGIC);
      const ips = lanIps();
      for (const addr of broadcastAddresses(ips)) {
        try { s.send(msg, port, addr); } catch (e) { /* noop */ }
      }
      if (sweep) {
        for (const ip of ips) {
          const p = ip.split('.').map(Number);
          if (p.length !== 4) continue;
          for (let i = 1; i <= 254; i++) {
            try { s.send(msg, port, p.slice(0, 3).concat([i]).join('.')); } catch (e) { /* noop */ }
          }
        }
      }
    });
  });
}

function stopDiscovery() {
  if (sock) { try { sock.close(); } catch (e) { /* noop */ } sock = null; }
}

module.exports = { startDiscovery, discoverServers, stopDiscovery, DEFAULT_PORT, lanIps, broadcastAddresses };
