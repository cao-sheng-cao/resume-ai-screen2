const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('resumeApp', {
  getDefaultStandard: () => ipcRenderer.invoke('app:get-default-standard'),
  getDeepSeekModels: () => ipcRenderer.invoke('app:get-deepseek-models'),
  loadKey: () => ipcRenderer.invoke('settings:load-key'),
  saveKey: (apiKey) => ipcRenderer.invoke('settings:save-key', apiKey),
  clearKey: () => ipcRenderer.invoke('settings:clear-key'),
  saveModel: (modelKey) => ipcRenderer.invoke('settings:save-model', modelKey),
  saveStrictness: (level) => ipcRenderer.invoke('settings:save-strictness', level),
  loadStandard: () => ipcRenderer.invoke('standard:load'),
  saveStandard: (standard) => ipcRenderer.invoke('standard:save', standard),
  clearStandard: () => ipcRenderer.invoke('standard:clear'),
  selectAndParseResume: () => ipcRenderer.invoke('resume:select-and-parse'),
  analyze: (payload) => ipcRenderer.invoke('ai:analyze', payload),
  loadLeaderboard: () => ipcRenderer.invoke('leaderboard:load'),
  saveLeaderboard: (items) => ipcRenderer.invoke('leaderboard:save', items),
  clearLeaderboard: () => ipcRenderer.invoke('leaderboard:clear'),
  loadProjects: () => ipcRenderer.invoke('projects:load'),
  saveProjects: (projects) => ipcRenderer.invoke('projects:save', projects),
  getActiveProjectId: () => ipcRenderer.invoke('projects:get-active'),
  saveActiveProjectId: (projectId) => ipcRenderer.invoke('projects:save-active', projectId),
  exportBackup: (options) => ipcRenderer.invoke('backup:export', options),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  openDataFolder: () => ipcRenderer.invoke('app:open-data-folder')
});
