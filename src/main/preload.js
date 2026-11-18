'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

// Seules ces fonctions sont accessibles à l'interface (pas d'accès direct à Node.js).
contextBridge.exposeInMainWorld('api', {
  appInfo: call('app:info'),
  config: {
    get: call('config:get'),
    setReadOnly: call('config:setReadOnly'),
  },
  monitor: {
    staticInfo: call('monitor:static'),
    live: call('monitor:live'),
    processes: call('monitor:processes'),
    kill: call('monitor:kill'),
  },
  cleaner: {
    scan: call('cleaner:scan'),
    clean: call('cleaner:clean'),
  },
  startup: {
    list: call('startup:list'),
    toggle: call('startup:toggle'),
  },
  tweaks: {
    list: call('tweaks:list'),
    apply: call('tweaks:apply'),
    revert: call('tweaks:revert'),
    restorePoint: call('tweaks:restorePoint'),
  },
  security: {
    status: call('security:status'),
    update: call('security:update'),
    scan: call('security:scan'),
    scanState: call('security:scanState'),
    threats: call('security:threats'),
    removeThreats: call('security:removeThreats'),
    audit: call('security:audit'),
    onScanFinished: (cb) => {
      const listener = (_e, state) => cb(state);
      ipcRenderer.on('security:scan-finished', listener);
      return () => ipcRenderer.removeListener('security:scan-finished', listener);
    },
  },
  diagnostics: {
    run: call('diagnostics:run'),
  },
  util: {
    showItem: call('shell:showItem'),
    choosePath: call('dialog:choosePath'),
    copy: call('clipboard:write'),
  },
});
