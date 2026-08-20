'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const RULE_TCP = 'KARDEX Digital (servidor) TCP';
const RULE_UDP = 'KARDEX Digital (servidor) UDP';

function runPs(script, { timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64],
      { timeout, windowsHide: true },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', error: err && err.message }));
  });
}

// Ejecuta un script con privilegios de administrador (muestra UAC) y escribe el
// resultado en resultFile. Devuelve { ok, error, canceled }.
function runPsElevated(script, resultFile) {
  return new Promise((resolve) => {
    const innerB64 = Buffer.from(script, 'utf16le').toString('base64');
    const launcher = "Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','" + innerB64 + "')";
    const outerB64 = Buffer.from(launcher, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', outerB64],
      { timeout: 90000, windowsHide: true },
      (err) => {
        let result = null;
        try {
          result = fs.readFileSync(resultFile, 'utf8');
          try { fs.unlinkSync(resultFile); } catch (e) { /* noop */ }
        } catch (e) { /* sin resultado */ }
        const canceled = !result && !!err && /cancel/i.test(err.message);
        resolve({
          ok: result === 'OK',
          canceled,
          error: result && result.startsWith('ERR')
            ? result.slice(5).trim()
            : (canceled ? 'Permiso cancelado. Puedes pulsar "Permitir en el Firewall" cuando quieras.' : (err && err.message || null))
        });
      });
  });
}

// Crea las reglas de entrada para TCP y UDP (Firewall de Windows).
async function addRules({ tcpPort, udpPort, exePath } = {}) {
  const tcp = Number(tcpPort) || 18006;
  const udp = Number(udpPort) || 18007;
  const prog = String(exePath || process.execPath).replace(/'/g, "''");
  const resultFile = path.join(os.tmpdir(), 'kardex-fw-' + crypto.randomBytes(6).toString('hex') + '.txt');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$prog = '" + prog + "'",
    "try {",
    "  if (-not (Get-NetFirewallRule -DisplayName '" + RULE_TCP + "' -ErrorAction SilentlyContinue)) {",
    "    New-NetFirewallRule -DisplayName '" + RULE_TCP + "' -Direction Inbound -Action Allow -Profile Any -Program $prog -Protocol TCP -LocalPort " + tcp + " | Out-Null",
    "  }",
    "  if (-not (Get-NetFirewallRule -DisplayName '" + RULE_UDP + "' -ErrorAction SilentlyContinue)) {",
    "    New-NetFirewallRule -DisplayName '" + RULE_UDP + "' -Direction Inbound -Action Allow -Profile Any -Program $prog -Protocol UDP -LocalPort " + udp + " | Out-Null",
    "  }",
    "  Set-Content -LiteralPath '" + resultFile + "' -Value 'OK' -Encoding ASCII",
    "} catch {",
    "  try { Set-Content -LiteralPath '" + resultFile + "' -Value ('ERR: ' + $_.Exception.Message) -Encoding ASCII } catch {}",
    "}"
  ].join('\n');
  const res = await runPsElevated(script, resultFile);
  return Object.assign({ tcpPort: tcp, udpPort: udp }, res);
}

// Devuelve si existen las reglas. available=false si no se pudo consultar.
async function rulesStatus() {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$out = @{}",
    "foreach ($n in @('" + RULE_TCP + "','" + RULE_UDP + "')) {",
    "  try { $out[$n] = [bool](Get-NetFirewallRule -DisplayName $n) } catch { $out[$n] = $null }",
    "}",
    "$out | ConvertTo-Json -Compress"
  ].join('\n');
  const res = await runPs(script);
  if (!res.ok || !res.stdout) return { tcp: null, udp: null, available: false };
  try {
    const j = JSON.parse(res.stdout.trim());
    return { tcp: !!j[RULE_TCP], udp: !!j[RULE_UDP], available: true };
  } catch (e) {
    return { tcp: null, udp: null, available: false };
  }
}

// Detecta antivirus de terceros registrados en el sistema.
async function detectAntivirus() {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "try {",
    "  $names = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | Select-Object -ExpandProperty displayName)",
    "} catch { $names = @() }",
    "ConvertTo-Json -InputObject $names -Compress"
  ].join('\n');
  const res = await runPs(script);
  if (!res.ok || !res.stdout) return [];
  try {
    const j = JSON.parse(res.stdout.trim());
    if (Array.isArray(j)) return j.map((s) => String(s));
    if (typeof j === 'string') return [j];
    return [];
  } catch (e) {
    return [];
  }
}

module.exports = { addRules, rulesStatus, detectAntivirus };
