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

// Windows can mark a fully covered Electron window as occluded and drop its
// renderer to about 1 fps even when backgroundThrottling is disabled. The
// self-view and the studio are driven by requestAnimationFrame, so occlusion
// shows up as a frozen camera and a stalled UI. Keep the render loop alive for
// the studio and focus it when it opens.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

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
let lastVideoAt = 0;
let previewCredit = 0;

// The first Kin build captured the self-view at a native 640x480/30. Keep that
// camera profile and its roughly 15 fps preview cadence: the self-view is a
// direct, light-weight rendering of the SDK's own processed frames, with no
// second camera reader and no renderer-side frame pump competing for CPU.
const CAMERA_CAPTURE = Object.freeze({ width: 640, height: 480, fps: 30 });
const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 480;
const PREVIEW_INTERVAL_MS = 66;
let previewFrame = Buffer.allocUnsafe(PREVIEW_WIDTH * PREVIEW_HEIGHT * 4);

// The SDK's video output is RGB/RGBA, not necessarily the RGBA layout the
// canvas wants. Center-crop to the 4:3 self-view and convert once here so the
// renderer can hand the buffer straight to its WebGL texture upload.
function makePreviewFrame(buffer, width, height, stride, pixelFormat) {
  const channels = pixelFormat === 2 || pixelFormat === 3
    ? 4
    : (pixelFormat === 0 || pixelFormat === 1 ? 3 : 0);
  if (!channels || !buffer || !buffer.length) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) return null;
  if (!Number.isFinite(stride) || stride < width * channels) return null;
  const swap = pixelFormat === 1 || pixelFormat === 3;

  const targetAspect = PREVIEW_WIDTH / PREVIEW_HEIGHT;
  let cropWidth = width;
  let cropHeight = height;
  let cropX = 0;
  let cropY = 0;
  if (width / height > targetAspect) {
    cropWidth = Math.max(1, Math.round(height * targetAspect));
    cropX = Math.floor((width - cropWidth) / 2);
  } else if (width / height < targetAspect) {
    cropHeight = Math.max(1, Math.round(width / targetAspect));
    cropY = Math.floor((height - cropHeight) / 2);
  }

  const sourceX = new Uint32Array(PREVIEW_WIDTH);
  for (let x = 0; x < PREVIEW_WIDTH; x += 1) {
    sourceX[x] = cropX + Math.min(cropWidth - 1, Math.floor((x * cropWidth) / PREVIEW_WIDTH));
  }

  for (let y = 0; y < PREVIEW_HEIGHT; y += 1) {
    const sourceY = cropY + Math.min(cropHeight - 1, Math.floor((y * cropHeight) / PREVIEW_HEIGHT));
    const srcRow = sourceY * stride;
    const dstRow = y * PREVIEW_WIDTH * 4;
    for (let x = 0; x < PREVIEW_WIDTH; x += 1) {
      const src = srcRow + sourceX[x] * channels;
      const dst = dstRow + x * 4;
      previewFrame[dst] = buffer[src + (swap ? 2 : 0)];
      previewFrame[dst + 1] = buffer[src + 1];
      previewFrame[dst + 2] = buffer[src + (swap ? 0 : 2)];
      previewFrame[dst + 3] = 255;
    }
  }
  return previewFrame;
}

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
  lastVideoAt = 0;
  previewCredit = 0;

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
  // Reuse it as the self-view: the same 640x480/30 camera frame the first
  // build used, center-cropped to 4:3 and converted once, then capped near
  // 15 fps for the IPC hop. No second camera reader and no renderer-side
  // frame pump, so measurement keeps its full frame budget.
  sdk.on('videoOutput', (buffer, width, height, stride, pixelFormat, timestampUs) => {
    if (nativeSessionToken !== session) return;
    const now = Date.now();
    const elapsed = lastVideoAt ? Math.min(200, now - lastVideoAt) : PREVIEW_INTERVAL_MS;
    lastVideoAt = now;
    previewCredit += elapsed;
    if (previewCredit < PREVIEW_INTERVAL_MS) return;
    previewCredit = Math.min(previewCredit - PREVIEW_INTERVAL_MS, PREVIEW_INTERVAL_MS);

    const frame = makePreviewFrame(buffer, width, height, stride, pixelFormat);
    if (!frame) return;
    sendToStudio({
      type: 'preview',
      session,
      buffer: toArrayBuffer(frame),
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      stride: PREVIEW_WIDTH * 4,
      pixelFormat: 2,
      timestampUs: Number(timestampUs),
    });
  });

  sdk.useCamera(CameraSelection.default, CAMERA_CAPTURE);
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
    maximizable: true,
    fullscreenable: true,
    fullscreen: true,
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

  // The studio starts fullscreen. Keep the page in sync so it can hide the
  // window drag strip and avoid opening a second frame window over itself.
  const sendWindowMode = () => {
    if (win.isDestroyed()) return;
    win.webContents.send('kin:window-mode', { fullscreen: win.isFullScreen() });
  };
  win.on('enter-full-screen', sendWindowMode);
  win.on('leave-full-screen', sendWindowMode);
  win.webContents.on('did-finish-load', sendWindowMode);

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
    // camera preview and the living portrait can be seen together. If the
    // display is too small, float it over the studio instead of covering the
    // rail and its End action.
    const studioBounds = win.getBounds();
    const area = screen.getDisplayMatching(studioBounds).workArea;
    const companionWidth = portraitPanelWidth(area) || Math.min(420, Math.round(area.width * 0.33));
    const companionHeight = Math.min(studioBounds.height, area.height);
    const fitsBeside = studioBounds.x + studioBounds.width + companionWidth <= area.x + area.width;
    const x = fitsBeside
      ? studioBounds.x + studioBounds.width
      : Math.min(area.x + 16, area.x + area.width - companionWidth);
    const desiredY = fitsBeside ? studioBounds.y : studioBounds.y + 16;
    const y = Math.max(area.y, Math.min(desiredY, area.y + area.height - companionHeight));
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
    win.focus();
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
