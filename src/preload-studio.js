'use strict';

// The studio's only privileged surface: send SDK lifecycle commands and
// receive in-memory status, validation, metric, and preview packets. No
// filesystem, shell, or network API is exposed to the page.
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
const windowModeListeners = new Set();

ipcRenderer.on('kin:sdk-event', (_event, payload) => {
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      /* one page listener must not break the others */
    }
  }
});

ipcRenderer.on('kin:window-mode', (_event, payload) => {
  for (const listener of windowModeListeners) {
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
  onWindowMode(callback) {
    if (typeof callback !== 'function') return () => {};
    windowModeListeners.add(callback);
    return () => windowModeListeners.delete(callback);
  },
  // Camera settings: capture rate/size and self-view rate only. The main
  // process validates every value against a fixed list before saving.
  getCameraSettings() {
    return ipcRenderer.invoke('kin:settings-get');
  },
  setCameraSettings(settings) {
    if (!settings || typeof settings !== 'object') return Promise.resolve(null);
    return ipcRenderer.invoke('kin:settings-set', {
      captureFps: Number(settings.captureFps),
      resolution: String(settings.resolution || ''),
      selfView: String(settings.selfView || ''),
      cameraMode: String(settings.cameraMode || ''),
    });
  },
  // Direct mode: one camera frame (raw pixels, in memory) for the SDK in the
  // main process. Resolves once the SDK has taken it, so the studio keeps at
  // most one frame in flight.
  sendFrame(frame) {
    if (!frame || !(frame.buffer instanceof ArrayBuffer || ArrayBuffer.isView(frame.buffer))) {
      return Promise.resolve(false);
    }
    return ipcRenderer.invoke('kin:frame', {
      session: Number(frame.session),
      buffer: frame.buffer,
      width: Number(frame.width),
      height: Number(frame.height),
      stride: Number(frame.stride),
      pixelFormat: Number(frame.pixelFormat),
      timestampUs: Number(frame.timestampUs),
    });
  },
  windowControl(action) {
    if (['minimize', 'maximize', 'fullscreen', 'close'].includes(action)) {
      ipcRenderer.send('kin:window', action);
    }
  },
});
