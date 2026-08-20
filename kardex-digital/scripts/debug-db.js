const db = require('../services/db');
const path = require('path');

(async () => {
  await db.open(path.join(__dirname, '..', 'test', 'test-data', 'kardex-test.db'));
  const dbFile = path.join(__dirname, '..', 'test', 'test-data', 'kardex-test.db');
  const fs = require('fs');
  const init = require('sql.js');
  const SQL = await init({ locateFile: (f) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', f) });
  const raw = new SQL.Database(fs.readFileSync(dbFile));
  const stmt = raw.prepare('SELECT id, username, role, password_hash FROM users');
  while (stmt.step()) {
    const r = stmt.getAsObject();
    console.log('user:', r.username, 'role:', r.role);
    console.log('hash:', r.password_hash);
    const parts = String(r.password_hash).split('$');
    console.log('parts:', parts.length);
    const crypto = require('crypto');
    const calc = crypto.scryptSync('admin123', parts[1], 64).toString('hex');
    console.log('calc===hash?', calc === parts[2]);
  }
  stmt.free();
  process.exit(0);
})();
