'use strict';

// Inventario compartido de operaciones de la base de datos. Lo usan tanto el
// servidor RPC (para validar lo que se ejecuta) como el cliente (para exponer
// un espejo del API síncrono de services/db.js).

const NS_METHODS = {
  auth: ['login'],
  users: ['list', 'get', 'create', 'update', 'delete', 'countAdmins'],
  employees: ['list', 'get', 'stats', 'setStatus', 'create', 'update', 'delete'],
  horasExtra: ['get', 'listForPeriod', 'save'],
  liquidaciones: ['listForEmployee', 'listAll', 'save', 'delete'],
  incentivos: ['listForPeriod', 'list', 'create', 'update', 'delete'],
  deduccionesManuales: ['listForPeriod', 'listForEmployee', 'create', 'update', 'delete'],
  salarioHistorial: ['listForEmployee', 'record', 'getSalarioPromedio', 'resetBaseline'],
  pagoVacaciones: ['get', 'listForPeriod', 'totalDiasPagados', 'save', 'delete'],
  vacaciones: ['list', 'create', 'delete'],
  reportes: ['plantilla', 'antiguedad', 'cumpleanos', 'departamentos', 'nominaDepartamentos', 'empleadosCompleto', 'cedulasVencer', 'aniversarios', 'beneficios'],
  audit: ['add', 'list'],
  mailLog: ['add', 'list'],
  contactos: ['list', 'get', 'create', 'update', 'delete'],
  settings: ['get', 'set'],
  historial: ['list', 'log', 'logCreate', 'logUpdate'],
  backups: ['dir', 'create', 'list', 'restore']
};

const TOP_METHODS = ['persistNow'];

module.exports = { NS_METHODS, TOP_METHODS };
