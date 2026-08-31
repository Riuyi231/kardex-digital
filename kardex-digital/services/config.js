'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 18006;
const DEFAULT_NAME = 'kardex';

function parseCli() {
  const argv = process.argv;
  const out = {};
  if (argv.includes('--server')) out.isServer = true;
  const grab = (flag) => {
    const i = argv.indexOf(flag);
    if (i >= 0 && argv[i + 1] != null) return argv[i + 1];
    const prefix = flag + '=';
    const hit = argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  const url = grab('--server-url');
  if (url) out.url = url;
  const token = grab('--server-token');
  if (token !== undefined) out.token = token;
  const port = grab('--server-port');
  if (port) out.port = Number(port) || DEFAULT_PORT;
  return out;
}

// Carga la configuración combinando archivo, variables de entorno y CLI.
function load(configPath) {
  const cfg = { serverUrl: null, token: '', serverPort: DEFAULT_PORT, serverName: DEFAULT_NAME, isServer: false, serverMode: 'local', wizardDone: false, configPath: configPath || null, cloud: {} };
  if (configPath && fs.existsSync(configPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
      if (j && typeof j.wizardDone === 'boolean') cfg.wizardDone = j.wizardDone;
      if (j && j.cloud) {
        if (typeof j.cloud.url === 'string' && j.cloud.url.trim()) cfg.cloud.url = j.cloud.url.trim().replace(/\/+$/, '');
        if (typeof j.cloud.token === 'string') cfg.cloud.token = j.cloud.token;
        if (typeof j.cloud.enabled === 'boolean') cfg.cloud.enabled = j.cloud.enabled;
      }
      if (j && j.server) {
        if (typeof j.server.url === 'string' && j.server.url.trim()) {
          cfg.serverUrl = j.server.url.trim().replace(/\/+$/, '');
        }
        if (typeof j.server.token === 'string') cfg.token = j.server.token;
        if (j.server.port) cfg.serverPort = Number(j.server.port) || DEFAULT_PORT;
        if (typeof j.server.name === 'string' && j.server.name.trim()) {
          cfg.serverName = j.server.name.trim();
        }
        if (typeof j.server.mode === 'string' && ['local', 'client', 'server'].includes(j.server.mode)) {
          cfg.serverMode = j.server.mode;
        }
      }
    } catch (e) {
      console.error('[KARDEX] Error leyendo configuración:', e.message);
    }
  }
  const cli = parseCli();
  if (cli.isServer) cfg.isServer = true;
  if (cli.url) cfg.serverUrl = cli.url;
  if (cli.token !== undefined) cfg.token = cli.token;
  if (cli.port) cfg.serverPort = cli.port;
  if (process.env.KARDEX_SERVER_URL && process.env.KARDEX_SERVER_URL.trim()) {
    cfg.serverUrl = process.env.KARDEX_SERVER_URL.trim().replace(/\/+$/, '');
  }
  if (process.env.KARDEX_SERVER_TOKEN !== undefined) cfg.token = process.env.KARDEX_SERVER_TOKEN;
  if (process.env.KARDEX_SERVER_PORT) cfg.serverPort = Number(process.env.KARDEX_SERVER_PORT) || DEFAULT_PORT;
  return cfg;
}

// Guarda solo la sección "server" del archivo de configuración.
function save(configPath, server) {
  let existing = {};
  try {
    if (fs.existsSync(configPath)) existing = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')) || {};
  } catch (e) { /* archivo corrupto: se sobreescribe */ }
  existing.server = existing.server || {};
  if (server.url !== undefined) existing.server.url = server.url;
  if (server.token !== undefined) existing.server.token = server.token;
  if (server.port !== undefined) existing.server.port = Number(server.port);
  if (server.name !== undefined) existing.server.name = server.name;
  if (server.mode !== undefined) existing.server.mode = server.mode;
  if (server.cloud !== undefined) {
    existing.cloud = existing.cloud || {};
    if (server.cloud.url !== undefined) existing.cloud.url = server.cloud.url;
    if (server.cloud.token !== undefined) existing.cloud.token = server.cloud.token;
    if (server.cloud.enabled !== undefined) existing.cloud.enabled = server.cloud.enabled;
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
  return existing.server;
}

// Marca la guía de primer arranque como completada.
function markWizardDone(configPath) {
  let existing = {};
  try {
    if (fs.existsSync(configPath)) existing = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')) || {};
  } catch (e) { /* archivo corrupto: se sobreescribe */ }
  existing.wizardDone = true;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
  return true;
}

module.exports = { load, save, markWizardDone, DEFAULT_PORT, DEFAULT_NAME };
