const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('booth', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  list: () => ipcRenderer.invoke('lib:list'),
  save: (payload) => ipcRenderer.invoke('lib:save', payload),
  overwrite: (payload) => ipcRenderer.invoke('lib:overwrite', payload),
  saveThumb: (payload) => ipcRenderer.invoke('lib:saveThumb', payload),
  remove: (name) => ipcRenderer.invoke('lib:delete', name),
  undoDelete: () => ipcRenderer.invoke('lib:undoDelete'),
  canUndo: () => ipcRenderer.invoke('lib:canUndo'),
  open: (name) => ipcRenderer.invoke('lib:open', name),
  reveal: (name) => ipcRenderer.invoke('lib:reveal', name),
  copy: (name) => ipcRenderer.invoke('lib:copy', name),
  exportItem: (name) => ipcRenderer.invoke('lib:export', name),
  startDrag: (name) => ipcRenderer.send('lib:drag', name),

  listBackdrops: () => ipcRenderer.invoke('backdrop:list'),
  setBackdrop: (slot, file) => ipcRenderer.invoke('backdrop:set', { slot, file }),
  clearBackdrop: (slot) => ipcRenderer.invoke('backdrop:clear', slot),
  pathForFile: (file) => webUtils.getPathForFile(file),

  close: () => ipcRenderer.send('win:close'),
  minimize: () => ipcRenderer.send('win:minimize'),
  zoom: () => ipcRenderer.send('win:zoom'),
  toggleFullscreen: () => ipcRenderer.send('win:fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('win:isFullscreen'),

  popupShare: (item) => ipcRenderer.send('menu:share', item),
  popupMenu: (state) => ipcRenderer.send('menu:popup', state),
  onCommand: (cb) => ipcRenderer.on('command', (_e, cmd, arg) => cb(cmd, arg)),
  onFullscreen: (cb) => ipcRenderer.on('fullscreen', (_e, v) => cb(v)),
});
