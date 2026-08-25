const init = require('sql.js');
const path = require('path');

(async () => {
  const SQL = await init({ locateFile: (f) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', f) });
  const d = new SQL.Database();
  d.run(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'invitado',
      full_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
  const stmt = d.prepare('SELECT COUNT(*) AS c FROM users');
  const row = stmt.getAsObject();
  console.log('count row:', JSON.stringify(row));
  d.run('INSERT INTO users (username,password_hash,role,full_name,created_at) VALUES (?,?,?,?,?)', ['admin', 'hash', 'admin', 'Administrador', '2020-01-01']);
  console.log('after insert:', JSON.stringify(d.exec('SELECT id,username,role FROM users')));
  process.exit(0);
})();
