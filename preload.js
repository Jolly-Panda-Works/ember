const { contextBridge, ipcRenderer } = require('electron');
const call = (n) => (...a) => ipcRenderer.invoke(n, ...a);
contextBridge.exposeInMainWorld('ember', {
  list: call('list'), add: call('add'), update: call('update'), remove: call('remove'),
  start: call('start'), stop: call('stop'), logs: call('logs'),
  openUrl: call('openUrl'), openFolder: call('openFolder'),
  settings: call('settings'), setSettings: call('setSettings'),
  onEvent: (cb) => ipcRenderer.on('evt', (_, e) => cb(e)),
});
