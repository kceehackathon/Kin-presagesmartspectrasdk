'use strict';

// The studio's only privileged surface: send SDK lifecycle commands and
// receive in-memory status, validation, metric, and preview packets. No
// filesystem, shell, or network API is exposed to the page.
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();

ipcRenderer.on('kin:sdk-event', (_event, payload) => {
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      /* one page listener must not break the others */
    }
  }
});

contextBridge.exposeInMainWorld('kin', {
  sendSdkCommand(command) {
    if (!command || typeof command.type !== 'string') return;
    ipcRenderer.send('kin:sdk-command', command);
  },
  onSdkEvent(callback) {
    if (typeof callback !== 'function') return () => {};
    listeners.add(callback);
    return () => listeners.delete(callback);
  },
});
