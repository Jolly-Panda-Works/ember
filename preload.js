const { contextBridge, ipcRenderer } = require('electron');
const call = (n) => (...a) => ipcRenderer.invoke(n, ...a);
contextBridge.exposeInMainWorld('ember', {
  platform: process.platform,
  lang: ipcRenderer.sendSync('lang'),   // read before the page draws, so it never flashes in the other language
  list: call('list'), add: call('add'), update: call('update'), remove: call('remove'),
  start: call('start'), stop: call('stop'), logs: call('logs'), clearLog: call('clearLog'),
  openProject: call('openProject'), editProject: call('editProject'),
  openUrl: call('openUrl'), openFolder: call('openFolder'), openData: call('openData'),
  pickLogo: call('pickLogo'), setLogoMode: call('setLogoMode'),
  categories: call('categories'), setCategories: call('setCategories'),
  settings: call('settings'), setSettings: call('setSettings'),
  checkProjects: call('checkProjects'), markTested: call('markTested'), pull: call('pull'),
  checkAppUpdate: call('checkAppUpdate'), installAppUpdate: call('installAppUpdate'),
  dismissJustUpdated: call('dismissJustUpdated'),
  onEvent: (cb) => ipcRenderer.on('evt', (_, e) => cb(e)),
});
