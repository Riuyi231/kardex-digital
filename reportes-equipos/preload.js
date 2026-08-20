'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  app: {
    getVersion: () => ipcRenderer.invoke('app:version'),
    installUpdate: () => ipcRenderer.invoke('app:install-update'),
    onUpdateAvailable: (cb) => ipcRenderer.on('app:update-available', (_e, info) => cb(info)),
    onUpdateProgress: (cb) => ipcRenderer.on('app:update-progress', (_e, info) => cb(info)),
    onUpdateDownloaded: (cb) => ipcRenderer.on('app:update-downloaded', (_e, info) => cb(info))
  },
  clients: {
    list: () => ipcRenderer.invoke('clients:list'),
    save: (c) => ipcRenderer.invoke('clients:save', c),
    remove: (id) => ipcRenderer.invoke('clients:delete', id)
  },
  equipos: {
    list: (clientId) => ipcRenderer.invoke('equipos:list', clientId),
    save: (e) => ipcRenderer.invoke('equipos:save', e),
    remove: (id) => ipcRenderer.invoke('equipos:delete', id)
  },
  reportes: {
    list: () => ipcRenderer.invoke('reportes:list'),
    save: (r) => ipcRenderer.invoke('reportes:save', r),
    setEstado: (id, estado) => ipcRenderer.invoke('reportes:setEstado', id, estado),
    setTecnico: (id, tecnicoId) => ipcRenderer.invoke('reportes:setTecnico', id, tecnicoId),
    setArchivado: (id, archivado) => ipcRenderer.invoke('reportes:setArchivado', id, archivado),
    resolver: (id, solucion, adjuntosNuevos, adjuntosEliminados, adjuntosExistentes) => ipcRenderer.invoke('reportes:resolver', id, solucion, adjuntosNuevos, adjuntosEliminados, adjuntosExistentes),
    historial: (id) => ipcRenderer.invoke('reportes:historial', id),
    nota: (id, texto) => ipcRenderer.invoke('reportes:nota', id, texto),
    remove: (id) => ipcRenderer.invoke('reportes:delete', id),
    export: (rows) => ipcRenderer.invoke('reportes:export', rows),
    resumen: () => ipcRenderer.invoke('reportes:resumen'),
    resumenXlsx: () => ipcRenderer.invoke('reportes:resumenXlsx'),
    recordatorioRun: () => ipcRenderer.invoke('reportes:recordatorioRun'),
    pdf: (id) => ipcRenderer.invoke('reportes:pdf', id),
    pdfEnviar: (id) => ipcRenderer.invoke('reportes:pdfEnviar', id),
    backup: () => ipcRenderer.invoke('reportes:backup')
  },
  adjuntos: {
    pick: () => ipcRenderer.invoke('adjuntos:pick'),
    read: (name) => ipcRenderer.invoke('adjuntos:read', name),
    preview: (path) => ipcRenderer.invoke('adjuntos:preview', path)
  },
  tecnicos: {
    list: () => ipcRenderer.invoke('tecnicos:list'),
    save: (t) => ipcRenderer.invoke('tecnicos:save', t),
    remove: (id) => ipcRenderer.invoke('tecnicos:delete', id),
    pickFile: () => ipcRenderer.invoke('tecnicos:pickFile'),
    previewImport: (path) => ipcRenderer.invoke('tecnicos:previewImport', path),
    importSave: (names) => ipcRenderer.invoke('tecnicos:importSave', names)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (s) => ipcRenderer.invoke('settings:save', s)
  },
  sync: {
    status: () => ipcRenderer.invoke('sync:status'),
    run: () => ipcRenderer.invoke('sync:run'),
    setTecnicoPass: (id, opts) => ipcRenderer.invoke('sync:setTecnicoPass', id, opts),
    onChanged: (cb) => ipcRenderer.on('app:changed', () => cb())
  },
  license: {
    status: () => ipcRenderer.invoke('license:status'),
    activate: (key) => ipcRenderer.invoke('license:activate', { key }),
    deactivate: () => ipcRenderer.invoke('license:deactivate')
  },
  wa: {
    status: () => ipcRenderer.invoke('wa:status'),
    connect: () => ipcRenderer.invoke('wa:connect'),
    disconnect: () => ipcRenderer.invoke('wa:disconnect'),
    resetSession: () => ipcRenderer.invoke('wa:resetSession'),
    send: (payload) => ipcRenderer.invoke('wa:send', payload),
    mensajesList: () => ipcRenderer.invoke('wa:mensajes:list'),
    mensajesGrupo: (jid) => ipcRenderer.invoke('wa:mensajes:grupo', jid),
    mensajesLeer: (ids) => ipcRenderer.invoke('wa:mensajes:leer', ids),
    mensajesBorrar: (id) => ipcRenderer.invoke('wa:mensajes:borrar', id),
    mensajesBorrarTodos: () => ipcRenderer.invoke('wa:mensajes:borrarTodos'),
    mensajesCliente: (info) => ipcRenderer.invoke('wa:mensajes:cliente', info),
    mensajesEnviar: (payload) => ipcRenderer.invoke('wa:mensajes:enviar', payload),
    mensajesMedia: (fileName, mime) => ipcRenderer.invoke('wa:mensajes:media', fileName, mime),
    mensajesAbrirMedia: (fileName) => ipcRenderer.invoke('wa:mensajes:abrirMedia', fileName),
    importarStickers: (archivos) => ipcRenderer.invoke('wa:mensajes:importarStickers', archivos),
    descargarMedia: (fileName, nombre) => ipcRenderer.invoke('wa:mensajes:descargar', fileName, nombre),
    onStatus: (cb) => ipcRenderer.on('wa:status', (_e, s) => cb(s)),
    onChanged: (cb) => ipcRenderer.on('app:changed', () => cb()),
    onNuevoMensaje: (cb) => ipcRenderer.on('wa:newmensaje', (_e, m) => cb(m)),
    onGoPendientes: (cb) => ipcRenderer.on('app:goto-pendientes', () => cb()),
    onGoMensajes: (cb) => ipcRenderer.on('app:goto-mensajes', () => cb()),
    onMensajesUpdate: (cb) => ipcRenderer.on('wa:mensajes:update', () => cb())
  }
});
