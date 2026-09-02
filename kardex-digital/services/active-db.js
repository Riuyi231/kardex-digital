'use strict';

// Registro de la base de datos activa. main.js resuelve la base según el modo
// (local SQLite o cliente de nube) y la registra aquí. Los servicios que necesitan
// la base (plantillas, documentos, correos, importación) la consumen a través de
// este proxy en lugar de `require('./db')` directamente, para que en modo nube
// no lean/guarden en la base SQLite local (que en ese modo está cerrada/vacía).
//
// Uso en un servicio:
//   const db = require('./active-db');
//   db.settings.get('doc_company_name')   // usa la base activa (local o nube)

const localDb = require('./db');

let _active = null;

const handler = {
  get(target, prop) {
    const src = _active || localDb;
    if (prop === 'setActive') return setActive;
    return src[prop];
  }
};

function setActive(db) {
  _active = db || null;
}

module.exports = new Proxy({}, handler);
