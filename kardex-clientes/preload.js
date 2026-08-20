'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  clientsList: () => ipcRenderer.invoke('clients:list'),
  clientsGet: (id) => ipcRenderer.invoke('clients:get', id),
  clientsSave: (c) => ipcRenderer.invoke('clients:save', c),
  clientsDelete: (id) => ipcRenderer.invoke('clients:delete', id),
  clientsState: (id, estado) => ipcRenderer.invoke('clients:state', id, estado),
  paymentsAdd: (p) => ipcRenderer.invoke('payments:add', p),
  paymentsDelete: (id) => ipcRenderer.invoke('payments:delete', id),
  summaryGet: (month) => ipcRenderer.invoke('summary:get', month),
  rncSearch: (q) => ipcRenderer.invoke('rnc:search', q),
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSave: (s) => ipcRenderer.invoke('settings:save', s),
  exportExcel: (which) => ipcRenderer.invoke('export:xlsx', which)
});
