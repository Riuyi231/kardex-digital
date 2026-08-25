'use strict';

const os = require('os');
const crypto = require('crypto');

// ID estable de máquina para vincular licencias a una PC concreta.
function machineId() {
  let guid = '';
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], {
      encoding: 'utf8',
      timeout: 3000
    });
    for (const line of out.split(/\r?\n/)) {
      const l = line.trim();
      if (l.startsWith('MachineGuid')) {
        const parts = l.split(/\s+/);
        guid = parts[parts.length - 1] || '';
        break;
      }
    }
  } catch (e) { /* noop */ }

  let user = '';
  try { user = os.userInfo().username; } catch (e) { /* noop */ }

  const src = os.hostname() + '|' + user + '|' + guid;
  return crypto.createHash('sha256').update(src, 'utf8').digest('hex').slice(0, 32).toUpperCase();
}

module.exports = { machineId };
