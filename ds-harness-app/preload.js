'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Bridge between the embedded H5 page / local UI windows and the main process.
contextBridge.exposeInMainWorld('dshApp', {
  // dsh lifecycle
  restart: () => ipcRenderer.send('restart-dsh'),
  reload: () => ipcRenderer.send('restart-dsh'),

  // settings (persisted in resources/app/settings.json)
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),

  // open dedicated windows
  openSettings: () => ipcRenderer.send('open-settings'),
  openHelp: () => ipcRenderer.send('open-help'),

  // version / update
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getLocalDshVersion: () => ipcRenderer.invoke('get-local-dsh-version'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  openReleasePage: () => ipcRenderer.send('open-release-page')
});
