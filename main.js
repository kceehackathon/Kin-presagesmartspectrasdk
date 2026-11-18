'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Menu, session, shell, screen, ipcMain } = require('electron');

// Kin is a fixed 1280x696 canvas designed for a 1280x720 projector/demo
// capture. On a 150%-scaled display the default DIP scaling would make that
// canvas 1920 physical pixels wide and clip it, so pin the app to 1x. The
// layout still reflows for smaller work areas; this only removes the
// surprise of a fixed-size window rendered off-screen.
app.commandLine.appendSwitch('force-device-scale-factor', '1');

// In a packaged build the native closure lives in resources/smartspectra/,
// outside app.asar. Point the SDK resolver there before loading the binding.
if (app.isPackaged && !process.env.SMARTSPECTRA_CAPI_PATH) {
  process.env.SMARTSPECTRA_CAPI_PATH = path.join(
    process.resourcesPath,
    'smartspectra',
    'smartspectra_capi.dll',
  );
}

// With SMARTSPECTRA_CAPI_PATH set, the SDK asks Windows to resolve the
// runtime's imports through the normal search order. The VC++ runtime DLLs
// ship beside the CAPI in resources/smartspectra, so put that directory on
// PATH before the binding loads. (In development the SDK uses its scoped
// LoadLibraryExW path instead, which already searches beside the DLL.)
if (process.env.SMARTSPECTRA_CAPI_PATH) {
  const runtimeDir = path.dirname(process.env.SMARTSPECTRA_CAPI_PATH);
  process.env.PATH = `${runtimeDir};${process.env.PATH || ''}`;
}

const {
  SmartSpectraSDK,
  CameraSelection,
  SmartSpectraLogLevel,
} = require('@smartspectra/node-sdk');

// Optional operator key: a demo/judges build can read a key from the
// environment or a local kin.key file so viewers never need to sign up. The
// public repository never contains a key; this only reads one the operator
// supplies at run time. See README.md#operator-key.
function readOperatorKey() {
  const candidate = (process.env.KIN_API_KEY || '').trim();
  if (candidate.length >= 8) return candidate;

  const directories = [
    process.env.PORTABLE_EXECUTABLE_DIR,
    path.dirname(app.getPath('exe')),
    __dirname,
  ].filter(Boolean);

  for (const directory of directories) {
    try {
      const value = fs.readFileSync(path.join(directory, 'kin.key'), 'utf8')
        .split(/\r?\n/)[0]
        .trim();
      if (value.length >= 8 && !value.startsWith('#')) return value;
    } catch {
      /* no operator key in this location */
    }
  }
  return null;
}

function injectOperatorKey(win, operatorKey) {
  if (!operatorKey) return;
  win.webContents.on('did-finish-load', () => {
    // The renderer has no custom preload; hand it the key in memory only.
    const value = JSON.stringify(operatorKey);
    win.webContents.executeJavaScript(
      `window.__kinOperatorKey = ${value}; window.dispatchEvent(new Event('kin-operator-key'));`,
    ).catch(() => {
      /* the page may have navigated away */
    });
  });
}

const STAGE_URL = pathToFileURL(path.join(__dirname, 'stage.html')).href;
const EXTERNAL_HOSTS = new Set([
  'physiology.presagetech.com',
  'smartspectra.presagetech.com',
  'github.com',
  'dev.to',
]);

let studioWindow = null;
let nativeSdk = null;
let nativeSessionToken = null;
let nativeChain = Promise.resolve();
let lastPreviewAt = 0;

function sendToStudio(payload) {
  if (!studioWindow || studioWindow.isDestroyed()) return;
  studioWindow.webContents.send('kin:sdk-event', payload);
}

function toArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return value;
}

async function stopNativeSession() {
  nativeSessionToken = null;
  const sdk = nativeSdk;
  nativeSdk = null;
  if (!sdk) return;

  const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
  try {
    await Promise.race([sdk.stopAsync(), timeout]);
  } catch (error) {
    console.error('[kin] native stop failed', error);
  }
  try {
    await sdk.destroy();
  } catch (error) {
    console.error('[kin] native destroy failed', error);
  }
}

async function startNativeSession({ session, apiKey, requestedMetrics }) {
  const sdk = new SmartSpectraSDK({
    apiKey,
    requestedMetrics,
    enableAccumulatedOutput: false,
    enableTelemetry: false,
    // The app surfaces SDK errors and validation through its own UI. Keep the
    // native diagnostic log at the quietest level so it does not leave a
    // session log file behind.
    logLevel: SmartSpectraLogLevel.kNone,
  });

  nativeSdk = sdk;
  nativeSessionToken = session;
  lastPreviewAt = 0;

  sdk.on('processingStatus', (status) => {
    if (nativeSessionToken === session) sendToStudio({ type: 'status', session, status });
  });
  sdk.on('validationStatus', (code, timestampUs, hint) => {
    if (nativeSessionToken === session) {
      sendToStudio({ type: 'validation', session, code, hint, timestampUs: Number(timestampUs) });
    }
  });
  sdk.on('metrics', (buffer, timestampUs) => {
    if (nativeSessionToken === session) {
      sendToStudio({ type: 'metrics', session, buffer: toArrayBuffer(buffer), timestampUs: Number(timestampUs) });
    }
  });
  sdk.on('error', (code, message, retryable) => {
    if (nativeSessionToken === session) {
      sendToStudio({ type: 'error', session, code, message, retryable });
    }
  });

  // The native pipeline already renders a processed frame for its own graph.
  // Reuse it as the self-view: 640x480 RGB at 30 fps from the camera owner,
  // throttled to ~15 fps for the IPC hop. No second camera reader and no
  // renderer-side frame pump, so measurement keeps its full frame budget.
  sdk.on('videoOutput', (buffer, width, height, stride, pixelFormat, timestampUs) => {
    if (nativeSessionToken !== session) return;
    const now = Date.now();
    if (now - lastPreviewAt < 66) return;
    lastPreviewAt = now;
    sendToStudio({
      type: 'preview',
      session,
      buffer: toArrayBuffer(buffer),
      width,
      height,
      stride,
      pixelFormat,
      timestampUs: Number(timestampUs),
    });
  });

  sdk.useCamera(CameraSelection.default, { width: 640, height: 480, fps: 30 });
  await sdk.start();
}

function installSdkIpc() {
  ipcMain.on('kin:sdk-command', (event, command) => {
    if (!studioWindow || studioWindow.isDestroyed() || event.sender !== studioWindow.webContents) {
      return;
    }
    if (!command || typeof command.type !== 'string') return;

    if (command.type === 'stop') {
      nativeChain = nativeChain
        .then(() => stopNativeSession())
        .catch((error) => console.error('[kin] native stop command failed', error));
      return;
    }

    if (command.type !== 'start') return;
    const session = Number(command.session);
    const apiKey = typeof command.apiKey === 'string' ? command.apiKey.trim() : '';
    const requestedMetrics = Array.isArray(command.requestedMetrics)
      ? command.requestedMetrics.filter((code) => Number.isInteger(code))
      : undefined;
    if (!Number.isFinite(session) || apiKey.length < 8) {
      sendToStudio({
        type: 'error',
        session,
        code: 2,
        message: 'A Presage key is required.',
        retryable: false,
      });
      return;
    }

    nativeChain = nativeChain
      .then(async () => {
        await stopNativeSession();
        await startNativeSession({ session, apiKey, requestedMetrics });
      })
      .catch((error) => {
        console.error('[kin] native start failed', error);
        sendToStudio({
          type: 'error',
          session,
          code: (error && error.code) || 0,
          message: (error && error.message) || 'The measurement engine could not start.',
          retryable: Boolean(error && error.retryable),
        });
      });
  });
}

function isStageUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    return parsed.href === STAGE_URL;
  } catch {
    return false;
  }
}

function isAllowedExternal(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && EXTERNAL_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function openExternal(url) {
  if (isAllowedExternal(url)) shell.openExternal(url);
}

function hardenWebContents(contents, { allowStage = false } = {}) {
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    // The frame window is born at about:blank and then loads stage.html.
    if (allowStage && isStageUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

function portraitPanelWidth(area) {
  if (area.width < 860 + 360) return 0;
  return Math.min(520, Math.max(360, Math.round(area.width * 0.31)));
}

function createStudioWindow() {
  // Work in device-independent pixels: a 1280x720 screen at 125% scaling has
  // a 1024x576 work area, and a 1280-DIP window would hang off the edge.
  const primary = screen.getPrimaryDisplay();
  const workArea = primary.workArea;
  const portraitWidth = portraitPanelWidth(workArea);
  const companionWidth = portraitWidth || Math.min(420, Math.round(workArea.width * 0.33));
  const sideBySide = workArea.width - companionWidth >= 860;
  if (!app.isPackaged) {
    console.log(
      `[kin] display ${primary.size.width}x${primary.size.height} ` +
      `work ${workArea.width}x${workArea.height} scale ${primary.scaleFactor}`,
    );
  }
  const width = Math.min(1280, sideBySide ? workArea.width - companionWidth : workArea.width);
  const height = Math.min(696, workArea.height);

  const win = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width,
    height,
    minWidth: Math.min(860, width),
    minHeight: Math.min(620, height),
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#100d0b',
    show: false,
    title: 'Kin',
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#100d0b',
      symbolColor: '#f2e8d7',
      height: 36,
    },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'preload-studio.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
      partition: 'kin',
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  injectOperatorKey(win, readOperatorKey());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isStageUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: Math.min(520, workArea.width),
          height: Math.min(720, workArea.height),
          minWidth: Math.min(420, workArea.width),
          minHeight: Math.min(520, workArea.height),
          frame: false,
          show: true,
          backgroundColor: '#0d0b0a',
          title: 'Kin — frame',
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            devTools: !app.isPackaged,
            partition: 'kin',
            backgroundThrottling: false,
            spellcheck: false,
          },
        },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    openExternal(url);
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  win.webContents.on('did-create-window', (child) => {
    hardenWebContents(child.webContents, { allowStage: true });

    // Put the portrait beside the studio when there is room, so the live
    // camera preview and the living portrait can be seen together. On a
    // smaller display the portrait sits at the right edge instead.
    const studioBounds = win.getBounds();
    const area = screen.getDisplayMatching(studioBounds).workArea;
    const companionWidth = portraitPanelWidth(area) || Math.min(420, Math.round(area.width * 0.33));
    const companionHeight = Math.min(studioBounds.height, area.height);
    const x = Math.min(
      studioBounds.x + studioBounds.width,
      area.x + area.width - companionWidth,
    );
    const y = Math.max(area.y, Math.min(studioBounds.y, area.y + area.height - companionHeight));
    child.setBounds({ x, y, width: companionWidth, height: companionHeight });
    win.focus();
  });

  if (!app.isPackaged) {
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
  }

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
      return;
    }
    if (!app.isPackaged && input.control && input.key.toLowerCase() === 'r') {
      win.reload();
      event.preventDefault();
      return;
    }
    if (!app.isPackaged && input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  win.once('ready-to-show', () => {
    win.show();
    if (process.argv.includes('--dev')) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  win.on('closed', () => {
    studioWindow = null;
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  studioWindow = win;
  return win;
}

function installCameraPermissionPolicy() {
  // 'kin' has no persist: prefix, so Electron keeps this session in memory.
  // The camera belongs to the native SmartSpectra SDK in the main process.
  // The page renders only the processed preview frames the SDK sends it, so
  // renderer media requests are denied outright. Audio is never granted.
  const kinSession = session.fromPartition('kin');
  kinSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  kinSession.setPermissionCheckHandler(() => false);

  kinSession.setSpellCheckerEnabled(false);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setName('Kin');
  app.setAppUserModelId('com.kin.livingportrait');

  app.on('second-instance', () => {
    if (!studioWindow) return;
    if (studioWindow.isMinimized()) studioWindow.restore();
    studioWindow.show();
    studioWindow.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    installCameraPermissionPolicy();
    installSdkIpc();
    createStudioWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createStudioWindow();
    });
  });

  app.on('before-quit', () => {
    if (nativeSdk) {
      try {
        nativeSdk.stopAsync();
      } catch {
        /* the engine is already down */
      }
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
