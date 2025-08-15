// src/preload.cjs  (CommonJS)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /* Security */
  securityGetConfig: () => ipcRenderer.invoke('security:getConfig'),
  securityEnable: (passcode, useBiometrics) =>
    ipcRenderer.invoke('security:enable', { passcode, useBiometrics }),
  securityUnlock: (passcode) => ipcRenderer.invoke('security:unlock', { passcode }),
  securityLock: () => ipcRenderer.invoke('security:lock'),

  /* DB merged view */
  loadDB: () => ipcRenderer.invoke('db:load'),

  /* Projects */
  addProject: (name) => ipcRenderer.invoke('project:add', name),
  renameProject: (id, name) => ipcRenderer.invoke('project:rename', { id, name }),
  deleteProject: (id) => ipcRenderer.invoke('project:delete', id),

  /* Tasks */
  addTask: (task) => ipcRenderer.invoke('task:add', task),
  updateTask: (partial) => ipcRenderer.invoke('task:update', partial),
  deleteTask: (id) => ipcRenderer.invoke('task:delete', id),

  /* Backup */
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
});
