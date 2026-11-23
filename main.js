'use strict';

const fs = require('node:fs');
const os = require('node:os');
const { monitorEventLoopDelay } = require('node:perf_hooks');
// Dev diagnostics: how long work waits on this (main) thread, which also
// relays every SDK callback and every frame the studio pushes.
// Diagnostics (event-loop delay, 5 s perf log) only with KIN_PERF=1: a 100 Hz
// sampler on the thread that relays every SDK callback is not free.
const PERF_LOG = process.env.KIN_PERF === '1';
const loopDelay = PERF_LOG ? monitorEventLoopDelay({ resolution: 20 }) : null;
if (loopDelay) loopDelay.enable();
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Menu, session, shell, screen, ipcMain, powerMonitor } = require('electron');
const cameraSettings = require('./src/camera-settings.cjs');

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

// Direct mode does not use the SDK's processed video frames (the self-view is
// the camera stream itself), but the SDK always registers a video callback:
// every frame then costs a render, two ~900 KB copies, and a blocking hop
// onto this thread, which starved the frames Kin pushes in. The SDK's C shim
// treats a null callback slot as "do not dispatch", so for direct sessions
// the video-output thunk is simply not registered. Guarded: if the SDK's
// internals ever change shape, this does nothing and Kin still works.
let skipSdkVideoOutput = false;
let skipSdkFrameSent = false;
try {
  const sdkRoot = path.dirname(require.resolve('@smartspectra/node-sdk/package.json'));
  const { Session } = require(path.join(sdkRoot, 'js', 'ffi.js'));
  const register = Session && Session.prototype && Session.prototype._registerThunk;
  if (typeof register === 'function') {
    Session.prototype._registerThunk = function registerThunk(jsFn, protoTypeName, makeAdapter) {
      if (skipSdkVideoOutput && protoTypeName === 'smartspectra_on_video_output *') return null;
      // Never used by Kin: accumulated metrics (disabled) and insights.
      if (protoTypeName === 'smartspectra_on_accumulated_metrics *' || protoTypeName === 'smartspectra_on_insight *') return null;
      // Per-frame 'frameSentThrough' (~30 blocking hops/s) is only needed to
      // count skipped frames in direct mode.
      if (skipSdkFrameSent && protoTypeName === 'smartspectra_on_frame *') return null;
      return register.call(this, jsFn, protoTypeName, makeAdapter);
    };
  }
} catch (error) {
  console.warn('[kin] SDK video-output hook unavailable', error && error.message);
}

const {
  SmartSpectraSDK,
  CameraSelection,
  FrameTransform,
  SmartSpectraLogLevel,
} = require('@smartspectra/node-sdk');

// Operator key: the operator's own Presage key, so users never see the key
// page. Read, in order, from the environment, a `.env` file, or a `kin.key`
// file. `.env` and `kin.key` are git-ignored; the public repository never
// contains a key. A packaged build ships the operator's `.env` in its
// resources folder (package.json build.extraResources). See
// README.md#operator-key.
const KEY_NAMES = ['KIN_API_KEY', 'SMARTSPECTRA_API_KEY', 'PRESAGE_API_KEY'];

function validKey(value) {
  const key = String(value || '').trim().replace(/^['"]|['"]$/g, '').trim();
  return key.length >= 8 && !key.startsWith('#') ? key : null;
}

// Minimal .env reader: KEY=value lines, optional quotes, # comments.
function keyFromDotEnv(text) {
  const values = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/\s+#.*$/, '');
  }
  for (const name of KEY_NAMES) {
    const key = validKey(values[name]);
    if (key) return key;
  }
  return null;
}

function readOperatorKey() {
  for (const name of KEY_NAMES) {
    const key = validKey(process.env[name]);
    if (key) return key;
  }

  const directories = [
    process.env.PORTABLE_EXECUTABLE_DIR, // folder of the portable .exe
    path.dirname(app.getPath('exe')),    // install folder
    app.isPackaged ? process.resourcesPath : null, // .env shipped with the build
    __dirname,                           // project root in development
  ].filter(Boolean);

  for (const directory of directories) {
    try {
      const key = keyFromDotEnv(fs.readFileSync(path.join(directory, '.env'), 'utf8'));
      if (key) return key;
    } catch {
      /* no .env in this location */
    }
    try {
      const key = validKey(fs.readFileSync(path.join(directory, 'kin.key'), 'utf8').split(/\r?\n/)[0]);
      if (key) return key;
    } catch {
      /* no kin.key in this location */
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
// IMPORTANT — why the self-view used to lag once pulse readings started:
// koffi delivers every SDK callback by queueing it onto this (main) thread and
// BLOCKING the SDK's native worker thread until the JS callback returns
// (node_modules/koffi/src/koffi/src/call.cc: napi_tsfn_blocking + cv.wait).
// Any work done inside 'videoOutput' therefore stalls the measurement graph.
// Once pulse estimation runs, the graph has no slack left, frames back up
// inside the SDK, and the preview drifts behind real time.
//
// So the callback below only stores a reference to the newest frame and
// returns. Packing and IPC happen afterwards on setImmediate, outside the
// blocking window. Frames are sent as raw RGB/RGBA (the renderer's WebGL
// texture upload handles the channel order on the GPU), and at most one
// preview is in flight: the renderer acks each paint, so a slow paint drops
// stale frames instead of queueing them.
// Capture size/rate and self-view rate come from the user's camera settings
// (src/camera-settings.cjs). On a two-core laptop every extra captured or
// previewed frame costs CPU/GPU that the SDK needs once pulse runs.
let activeSettings = { ...cameraSettings.DEFAULTS };
let deviceInfo = null;
let lastSessionSummary = null;
// Only used by the fallback path (SDK camera + processed-frame preview).
// Every other camera frame (15 fps). The verified 5-minute run had ample headroom (3-4 ms frame delay); 12 fps decimated to 10 on a 30 fps camera and read as laggy.
// With the expression mirror on, the SDK also runs three face models; on the
// two-core test laptop that pushed it to its limit (two error-14 restarts in
// 4 minutes), so the self-view drops to every third frame (10 fps) then.
const PREVIEW_INTERVAL_MS = (1000 / 15) * 0.96;
const PREVIEW_INTERVAL_FACE_MS = (1000 / 10) * 0.96;
let previewIntervalMs = PREVIEW_INTERVAL_MS;
// 'direct': the studio owns the camera stream (native <video> self-view) and
// pushes frames to the SDK. 'sdk': fallback when the studio cannot open the
// camera; the SDK captures and Kin previews its processed frames.
let nativeSource = 'direct';
const PREVIEW_ACK_TIMEOUT_MS = 250; // never stall if an ack is lost


// Session health, always on (unlike the dev-only perf log): it feeds the
// live readout in camera settings and the next recommendation.
const health = {
  windowAt: 0,
  frames: 0,
  previews: 0,
  lagSum: 0,
  lagCount: 0,
  lagMax: 0,
  session: null, // { startedAt, frames, lagSum, lagCount, lagHigh, lowFrameRate, requestedFps }
};

function resetHealth(requestedFps) {
  health.windowAt = Date.now();
  health.frames = 0;
  health.previews = 0;
  health.lagSum = 0;
  health.lagCount = 0;
  health.lagMax = 0;
  health.session = {
    startedAt: Date.now(),
    frames: 0,
    lagSum: 0,
    lagCount: 0,
    lagHigh: 0,
    sent: 0,
    dropped: 0,
    lowFrameRate: false,
    requestedFps,
  };
}

function summarizeSession(s) {
  if (!s) return null;
  const seconds = (Date.now() - s.startedAt) / 1000;
  if (seconds < 5 || !s.frames) return null;
  return {
    seconds,
    cameraFps: s.frames / seconds,
    requestedFps: s.requestedFps,
    lagAvg: s.lagCount ? s.lagSum / s.lagCount : 0,
    lagHighShare: s.lagCount ? s.lagHigh / s.lagCount : 0,
    dropShare: s.sent + s.dropped ? s.dropped / (s.sent + s.dropped) : 0,
    lowFrameRate: s.lowFrameRate,
  };
}

function closeHealthSession() {
  const summary = summarizeSession(health.session);
  health.session = null;
  if (summary) lastSessionSummary = summary;
}

setInterval(() => {
  if (!health.session || !nativeSdk) return;
  const seconds = Math.max(0.001, (Date.now() - health.windowAt) / 1000);
  sendToStudio({
    type: 'health',
    session: nativeSessionToken,
    cameraFps: health.frames / seconds,
    previewFps: health.previews / seconds,
    source: nativeSource,
    dropShare: health.session.sent + health.session.dropped
      ? health.session.dropped / (health.session.sent + health.session.dropped) : 0,
    lagAvg: health.lagCount ? health.lagSum / health.lagCount : 0,
    lagMax: health.lagMax,
    requestedFps: health.session.requestedFps,
    elapsedSeconds: (Date.now() - health.session.startedAt) / 1000,
  });
  health.windowAt = Date.now();
  health.frames = 0;
  health.previews = 0;
  health.lagSum = 0;
  health.lagCount = 0;
  health.lagMax = 0;
}, 2000).unref?.();
let previewSourceLogged = false;
let pendingVideo = null;
let videoFlushScheduled = false;
let previewInFlight = false;
let previewSentAt = 0;
let videoBaseline = null; // smallest (wall clock - frame timestamp) seen this session
let lastValidationLogged = null;
let sdkAccepting = false; // direct mode: graph reported Running
let pushFailures = 0; // consecutive sendFrame rejections while running
let firstPushLogged = false;

// Delay of SDK output behind its own best case, from a frame or metrics
// timestamp (epoch µs). A steady value means real time; growth = backlog.
function recordLag(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return;
  const offsetMs = Date.now() - ts / 1000;
  if (videoBaseline == null || offsetMs < videoBaseline) videoBaseline = offsetMs;
  const age = offsetMs - videoBaseline;
  perf.ageTotal += age;
  perf.ageCount += 1;
  if (age > perf.ageMax) perf.ageMax = age;
  health.lagSum += age;
  health.lagCount += 1;
  if (age > health.lagMax) health.lagMax = age;
  if (health.session) {
    health.session.lagSum += age;
    health.session.lagCount += 1;
    if (age > 300) health.session.lagHigh += 1;
  }
}

// Development-only counters. These stay out of the packaged demo UI and logs;
// they make a live lag check measurable instead of a guess: camera callbacks/s,
// preview packets/s, metrics/s, conversion time, and the worst camera gap.
const perf = {
  windowAt: Date.now(),
  video: 0,
  preview: 0,
  metrics: 0,
  metricBytes: 0,
  lastVideoAt: 0,
  maxVideoGap: 0,
  callbackTotal: 0,
  callbackMax: 0,
  packMax: 0,
  ageTotal: 0,
  ageMax: 0,
  ageCount: 0,
  skippedInFlight: 0,
  pushed: 0,
  pushTotal: 0,
  pushMax: 0,
};
if (PERF_LOG) {
  setInterval(() => {
    if (!perf.video && !perf.metrics && !perf.pushed && !nativeSdk) return;
    const seconds = Math.max(0.001, (Date.now() - perf.windowAt) / 1000);
    const callbackAvg = perf.video ? perf.callbackTotal / perf.video : 0;
    const ageAvg = perf.ageCount ? perf.ageTotal / perf.ageCount : 0;
    // Per-process CPU as Electron reports it. The Browser entry includes the
    // SDK's native worker threads.
    let cpu = '';
    try {
      cpu = app.getAppMetrics()
        .map((m) => `${m.type === 'Browser' ? 'main+sdk' : m.type}:${Math.round(m.cpu.percentCPUUsage)}%`)
        .join(' ');
    } catch {
      cpu = 'n/a';
    }
    console.log(
      `[kin-perf] camera ${(perf.video / seconds).toFixed(1)} fps · ` +
      `preview ${(perf.preview / seconds).toFixed(1)} fps · ` +
      `metrics ${perf.metrics} (${(perf.metricBytes / 1024).toFixed(0)} KiB) · ` +
      `camera gap max ${perf.maxVideoGap} ms · ` +
      `callback ${callbackAvg.toFixed(2)} ms avg/${perf.callbackMax.toFixed(2)} ms max · ` +
      `pack max ${perf.packMax.toFixed(2)} ms · ` +
      `frame lag ${ageAvg.toFixed(0)} ms avg/${perf.ageMax.toFixed(0)} ms max · ` +
      `dropped (renderer busy) ${perf.skippedInFlight} · ` +
      `pushed ${perf.pushed} (${(perf.pushed / seconds).toFixed(1)} fps, sendFrame ${perf.pushed ? (perf.pushTotal / perf.pushed).toFixed(1) : 0} ms avg/${perf.pushMax.toFixed(1)} max) · ` +
      `main loop delay ${loopDelay ? (loopDelay.mean / 1e6).toFixed(0) : '-'} ms avg/${loopDelay ? (loopDelay.max / 1e6).toFixed(0) : '-'} max · ` +
      `graph took ${health.session ? health.session.sent : 0}/skipped ${health.session ? health.session.dropped : 0} (session) · cpu ${cpu}`,
    );
    perf.windowAt = Date.now();
    perf.video = 0;
    perf.preview = 0;
    perf.metrics = 0;
    perf.metricBytes = 0;
    perf.lastVideoAt = 0;
    perf.maxVideoGap = 0;
    perf.callbackTotal = 0;
    perf.callbackMax = 0;
    perf.packMax = 0;
    perf.ageTotal = 0;
    perf.ageMax = 0;
    perf.ageCount = 0;
    perf.skippedInFlight = 0;
    perf.pushed = 0;
    if (loopDelay) loopDelay.reset();
    perf.pushTotal = 0;
    perf.pushMax = 0;
  }, 5000).unref?.();
}

// Pixel formats from the SDK: 0 RGB, 1 BGR, 2 RGBA, 3 BGRA. The renderer
// uploads 3- or 4-channel bytes straight into a WebGL texture and swaps R/B
// in the shader when needed, so no per-pixel work happens in this process.
function channelsFor(pixelFormat) {
  if (pixelFormat === 2 || pixelFormat === 3) return 4;
  if (pixelFormat === 0 || pixelFormat === 1) return 3;
  return 0;
}

// Returns a tightly packed buffer (row length = width * channels). The SDK's
// buffer is already an owned copy and is normally tight (640x480 RGB has a
// 1920-byte stride), so this is usually a no-op. Padded rows are compacted
// with native memcpy, never a JS pixel loop.
function packFrame(buffer, width, height, stride, channels) {
  const row = width * channels;
  if (stride === row) return buffer.length >= row * height ? buffer : null;
  if (stride < row || buffer.length < stride * (height - 1) + row) return null;
  const packed = Buffer.allocUnsafe(row * height);
  for (let y = 0; y < height; y += 1) {
    buffer.copy(packed, y * row, y * stride, y * stride + row);
  }
  return packed;
}

function flushVideo() {
  videoFlushScheduled = false;
  const frame = pendingVideo;
  pendingVideo = null;
  if (!frame || frame.session !== nativeSessionToken) return;

  const now = Date.now();
  if (previewInFlight && now - previewSentAt < PREVIEW_ACK_TIMEOUT_MS) {
    perf.skippedInFlight += 1;
    return;
  }
  if (now - previewSentAt < previewIntervalMs) return;

  const channels = channelsFor(frame.pixelFormat);
  if (!channels || frame.width < 2 || frame.height < 2) return;
  const packStart = process.hrtime.bigint();
  const bytes = packFrame(frame.buffer, frame.width, frame.height, frame.stride, channels);
  const packMs = Number(process.hrtime.bigint() - packStart) / 1e6;
  if (packMs > perf.packMax) perf.packMax = packMs;
  if (!bytes) return;

  previewInFlight = true;
  previewSentAt = now;
  perf.preview += 1;
  health.previews += 1;
  sendToStudio({
    type: 'preview',
    session: frame.session,
    buffer: bytes,
    width: frame.width,
    height: frame.height,
    channels,
    pixelFormat: frame.pixelFormat,
    timestampUs: frame.timestampUs,
  });
}

function sendToStudio(payload) {
  if (!studioWindow || studioWindow.isDestroyed()) return;
  studioWindow.webContents.send('kin:sdk-event', payload);
}

async function stopNativeSession() {
  closeHealthSession();
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

// The SDK's measurement threads live in this process. On a two-core laptop
// they compete with Chromium's GPU and renderer processes (and anything else
// running) once pulse estimation starts; when they lose, the SDK's frames back
// up (the self-view lags by seconds) and its frame-rate watchdog ends the
// session (error 14). Above-normal priority lets measurement, and the preview
// frames it produces, keep pace. Set KIN_PRIORITY=normal to opt out.
//
// Raising only this process starved Chromium's GPU and renderer processes
// (they composite and paint the self-view), so the preview stuttered even
// though measurement kept up. All of Kin's processes get the same class: Kin
// as a whole wins over background apps, and inside Kin the scheduler shares
// time fairly. Re-applied at each session start because Chromium can restart
// its GPU process or create new renderers.
// Windows only: raise the calling (main JS) thread to THREAD_PRIORITY_HIGHEST
// within its process class. Uses koffi, which ships with the SDK.
let relayThreadRaised = false;
function raiseRelayThread() {
  if (relayThreadRaised) return true;
  if (process.platform !== 'win32') return false;
  try {
    const koffi = require('koffi');
    const kernel32 = koffi.load('kernel32.dll');
    const GetCurrentThread = kernel32.func('void * __stdcall GetCurrentThread()');
    const SetThreadPriority = kernel32.func('int __stdcall SetThreadPriority(void *hThread, int nPriority)');
    const THREAD_PRIORITY_HIGHEST = 2;
    relayThreadRaised = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST) !== 0;
  } catch (error) {
    console.warn('[kin] could not raise the relay thread', error && error.message);
  }
  return relayThreadRaised;
}

function raiseMeasurementPriority() {
  if ((process.env.KIN_PRIORITY || '').toLowerCase() === 'normal') return;
  const level = os.constants.priority.PRIORITY_ABOVE_NORMAL;
  const raised = [];
  // Order matters on a two-core laptop. In direct mode the camera pipeline
  // (capture -> studio -> this thread) is cheap but must never wait, while
  // the SDK's ~54 measurement threads can absorb whatever CPU is left (its
  // graph skips a frame when busy). With the SDK above normal, its pulse
  // stage starved the pipeline (camera feed 29 -> 12 fps, SDK error 14), so
  // the SDK's process stays at normal and the pipeline outranks it. In the
  // fallback mode the SDK captures the camera itself and keeps the boost.
  try {
    if (nativeSource === 'direct') {
      os.setPriority(0, os.constants.priority.PRIORITY_NORMAL);
      raised.push('main+sdk(normal)');
      // This JS thread relays every frame into the SDK, so it alone is lifted
      // above the SDK's worker threads that share this process.
      if (raiseRelayThread()) raised.push('relay-thread(highest)');
    } else {
      os.setPriority(0, level);
      raised.push('main+sdk');
    }
  } catch (error) {
    console.warn('[kin] could not set process priority', error && error.message);
  }
  try {
    for (const metric of app.getAppMetrics()) {
      // Chromium captures the camera in a Utility process (the video capture
      // service). Left at normal priority, the SDK's measurement threads
      // starved it once pulse started: the camera feed fell 30 -> 23 -> 17
      // fps and the SDK ended the session (error 14), although the camera
      // alone holds 30.0 fps. Capture is light but timing-critical, so it
      // gets HIGH priority.
      const capture = metric.type === 'Utility'
        && /video[_ ]?capture/i.test(String(metric.serviceName || metric.name || ''));
      if (metric.type !== 'GPU' && metric.type !== 'Tab' && !capture) continue;
      try {
        os.setPriority(metric.pid, capture ? os.constants.priority.PRIORITY_HIGH : level);
        raised.push(capture ? 'VideoCapture(high)' : metric.type);
      } catch {
        /* the process may have exited between listing and raising */
      }
    }
  } catch {
    /* metrics are unavailable before the app is ready */
  }
  if (!app.isPackaged) console.log(`[kin] priority above normal: ${raised.join(', ')}`);
}

async function startNativeSession({ session, apiKey, requestedMetrics, source }) {
  const faceMetrics = Array.isArray(requestedMetrics) && requestedMetrics.some((code) => code === 12 || code === 13 || code === 14);
  previewIntervalMs = faceMetrics ? PREVIEW_INTERVAL_FACE_MS : PREVIEW_INTERVAL_MS;
  nativeSource = source === 'sdk' ? 'sdk' : 'direct';
  // Must be set before the SDK creates its native session (on start()).
  skipSdkVideoOutput = nativeSource === 'direct';
  skipSdkFrameSent = nativeSource !== 'direct';
  raiseMeasurementPriority();
  if (!app.isPackaged) {
    const names = ['PRESAGE_FORCE_CPU_INFERENCE', 'PRESAGE_CPU_INFER_THREADS', 'OPENCV_FOR_THREADS_NUM'];
    console.log(`[kin] sdk env: ${names.map((n) => `${n}=${process.env[n] || '(unset)'}`).join(' ')}`);
  }
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
  pendingVideo = null;
  previewInFlight = false;
  previewSentAt = 0;
  videoBaseline = null;
  firstPushLogged = false;
  lastValidationLogged = null;
  sdkAccepting = false;
  pushFailures = 0;
  perf.pushErrorLogged = false;

  sdk.on('processingStatus', (status) => {
    if (!app.isPackaged) console.log(`[kin] processing status ${status}`);
    // Stopping (4) or error (5): stop taking frames.
    if (nativeSessionToken === session && (status === 4 || status === 5)) sdkAccepting = false;
    if (nativeSessionToken === session) sendToStudio({ type: 'status', session, status });
  });
  sdk.on('validationStatus', (code, timestampUs, hint) => {
    if (code === 11 && health.session) health.session.lowFrameRate = true; // kFrameRateTooLow
    if (!app.isPackaged && code !== lastValidationLogged) {
      lastValidationLogged = code;
      console.log(`[kin] validation ${code}${hint ? ` (${hint})` : ''}`);
    }
    if (nativeSessionToken === session) {
      sendToStudio({ type: 'validation', session, code, hint, timestampUs: Number(timestampUs) });
    }
  });
  sdk.on('metrics', (buffer, timestampUs) => {
    if (nativeSessionToken === session) {
      perf.metrics += 1;
      perf.metricBytes += buffer && buffer.length ? buffer.length : 0;
      // Direct mode has no processed video frames, so the reading delay is
      // measured on the metrics packets instead (same baseline method).
      if (nativeSource === 'direct') recordLag(Number(timestampUs));
      // The SDK hands us an owned Buffer for each packet. Electron's structured
      // clone copies it during send, so avoid an extra full-packet slice here.
      sendToStudio({ type: 'metrics', session, buffer, timestampUs: Number(timestampUs) });
    }
  });
  // Whether each pushed frame entered the graph or was skipped by its flow
  // limiter because measurement was still busy: the clearest sign that this
  // device cannot keep up at the chosen rate.
  sdk.on('frameSentThrough', (sent) => {
    if (!health.session) return;
    if (sent) health.session.sent += 1;
    else health.session.dropped += 1;
  });
  sdk.on('error', (code, message, retryable) => {
    if (nativeSessionToken === session) {
      sendToStudio({ type: 'error', session, code, message, retryable });
    }
  });

  // The native pipeline already renders a processed frame for its own graph.
  // Reuse it as the self-view. This callback runs while the SDK's worker
  // thread is blocked (see the note at the top of this file), so it only
  // keeps the newest frame and returns; flushVideo does the rest later.
  sdk.on('videoOutput', (buffer, width, height, stride, pixelFormat, timestampUs) => {
    if (nativeSessionToken !== session) return;
    const callbackStart = process.hrtime.bigint();
    const now = Date.now();
    perf.video += 1;
    if (perf.lastVideoAt) {
      const gap = now - perf.lastVideoAt;
      if (gap > perf.maxVideoGap) perf.maxVideoGap = gap;
    }
    perf.lastVideoAt = now;

    // Frame lag: how far behind its own best-case delivery this frame is.
    // A steady value means real time; a growing one means a backlog.
    const ts = Number(timestampUs);
    if (Number.isFinite(ts) && ts > 0) {
      const offsetMs = now - ts / 1000;
      if (videoBaseline == null || offsetMs < videoBaseline) videoBaseline = offsetMs;
      const age = offsetMs - videoBaseline;
      perf.ageTotal += age;
      perf.ageCount += 1;
      if (age > perf.ageMax) perf.ageMax = age;
      health.lagSum += age;
      health.lagCount += 1;
      if (age > health.lagMax) health.lagMax = age;
      if (health.session) {
        health.session.lagSum += age;
        health.session.lagCount += 1;
        if (age > 300) health.session.lagHigh += 1;
      }
    }
    if (nativeSource !== 'direct') {
      health.frames += 1;
      if (health.session) health.session.frames += 1;
    }

    // In direct mode the studio shows the camera stream itself; the SDK's
    // processed frame is only used above for the delay measurement.
    pendingVideo = nativeSource === 'direct' || activeSettings.selfView === 'off'
      ? null
      : { session, buffer, width, height, stride, pixelFormat, timestampUs: ts };
    if (pendingVideo && !videoFlushScheduled) {
      videoFlushScheduled = true;
      setImmediate(flushVideo);
    }

    const callbackMs = Number(process.hrtime.bigint() - callbackStart) / 1e6;
    perf.callbackTotal += callbackMs;
    if (callbackMs > perf.callbackMax) perf.callbackMax = callbackMs;
    if (!previewSourceLogged && !app.isPackaged) {
      previewSourceLogged = true;
      console.log(`[kin] videoOutput ${width}x${height} stride=${stride} format=${pixelFormat}`);
    }
  });

  const capture = cameraSettings.captureOptions(activeSettings);
  if (!app.isPackaged) console.log(`[kin] source ${nativeSource} · ${capture.width}x${capture.height} @ ${capture.fps} fps · self-view ${activeSettings.selfView}`);
  resetHealth(capture.fps);
  if (nativeSource === 'direct') sdk.useCustomInput(FrameTransform.kNone);
  else sdk.useCamera(CameraSelection.default, capture);
  await sdk.start();
  // Direct mode handshake. sdk.start() blocks this thread for seconds while
  // the models load; frames captured meanwhile would reach the SDK with a
  // multi-second jump after the first one, which it rejects as a "gap between
  // camera frame timestamps" (and then rejects everything). So the studio
  // forwards nothing until told the graph is armed, then streams the live
  // camera continuously from that frame on. The graph needs these frames to
  // reach Running, so this must not wait for status 3.
  if (nativeSource === 'direct' && nativeSessionToken === session) {
    sdkAccepting = true;
    sendToStudio({ type: 'accepting', session });
  }
}

// NV12 (4) and NV21 (5) carry a half-height interleaved chroma plane.
function frameBytes(width, height, stride, pixelFormat) {
  if (pixelFormat === 4 || pixelFormat === 5) return stride * height + stride * Math.ceil(height / 2);
  return stride * height;
}

// Direct mode: the studio pushes camera frames here. ipcMain.handle (not
// .on) so the studio's invoke() resolves only after the SDK took the frame;
// it never has more than one frame in flight, so frames cannot queue up.
function installFrameIpc() {
  ipcMain.handle('kin:frame', (event, frame) => {
    if (!fromStudio(event) || !frame || !nativeSdk || nativeSource !== 'direct') return false;
    if (Number(frame.session) !== nativeSessionToken) return false;
    if (!sdkAccepting) return false;
    const width = frame.width | 0;
    const height = frame.height | 0;
    const stride = frame.stride | 0;
    const pixelFormat = frame.pixelFormat | 0;
    if (width < 16 || height < 16 || width > 4096 || height > 4096) return false;
    if (![0, 1, 2, 3, 4, 5].includes(pixelFormat)) return false;
    const bytes = frame.buffer instanceof Uint8Array ? frame.buffer : new Uint8Array(frame.buffer || 0);
    if (bytes.length < frameBytes(width, height, stride, pixelFormat)) return false;
    try {
      const pushStart = process.hrtime.bigint();
      nativeSdk.sendFrame(bytes, width, height, stride, pixelFormat, Number(frame.timestampUs));
      const pushMs = Number(process.hrtime.bigint() - pushStart) / 1e6;
      perf.pushTotal += pushMs;
      if (pushMs > perf.pushMax) perf.pushMax = pushMs;
      if (!firstPushLogged && !app.isPackaged) {
        firstPushLogged = true;
        console.log(`[kin] first frame pushed: ${width}x${height} stride=${stride} format=${pixelFormat} bytes=${bytes.length} ts=${frame.timestampUs}`);
      }
      perf.pushed += 1;
      pushFailures = 0;
      health.frames += 1;
      if (health.session) health.session.frames += 1;
      return true;
    } catch (error) {
      // Before the graph is armed, or right after stop: drop quietly (but
      // say so once in development, so a rejected format cannot hide).
      if (!app.isPackaged && !perf.pushErrorLogged) {
        perf.pushErrorLogged = true;
        console.warn(`[kin] sendFrame rejected: ${error && error.message}`);
      }
      // A running session that starts rejecting frames is dead: say so
      // instead of leaving a live camera with no readings.
      pushFailures += 1;
      if (pushFailures === 15) {
        sendToStudio({
          type: 'error',
          session: nativeSessionToken,
          code: 8,
          message: (error && error.message) || 'The measurement engine stopped accepting frames.',
          retryable: true,
        });
      }
      return false;
    }
  });
}

function installSdkIpc() {
  ipcMain.on('kin:sdk-command', (event, command) => {
    if (!studioWindow || studioWindow.isDestroyed() || event.sender !== studioWindow.webContents) {
      return;
    }
    if (!command || typeof command.type !== 'string') return;

    // The renderer painted (or discarded) the last preview: allow the next.
    if (command.type === 'preview-ack') {
      if (Number(command.session) === nativeSessionToken) previewInFlight = false;
      return;
    }

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
        await startNativeSession({ session, apiKey, requestedMetrics, source: command.source });
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

async function settingsState() {
  if (!deviceInfo) deviceInfo = await cameraSettings.deviceProfile(app, powerMonitor);
  else {
    try {
      deviceInfo.onBattery = powerMonitor.isOnBatteryPower();
    } catch {
      /* keep the last value */
    }
  }
  // Prefer the session that is running now (once it has 20 s of data), so
  // the recommendation reflects how this device is coping right now.
  const live = summarizeSession(health.session);
  const observed = live && live.seconds >= 20 ? live : lastSessionSummary;
  return {
    settings: { ...activeSettings },
    options: cameraSettings.OPTIONS,
    device: deviceInfo,
    recommendation: cameraSettings.recommend(deviceInfo, observed, activeSettings),
    lastSession: observed,
  };
}

function fromStudio(event) {
  return Boolean(studioWindow && !studioWindow.isDestroyed() && event.sender === studioWindow.webContents);
}

function installSettingsIpc() {
  ipcMain.handle('kin:settings-get', async (event) => {
    if (!fromStudio(event)) return null;
    return settingsState();
  });

  ipcMain.handle('kin:settings-set', async (event, input) => {
    if (!fromStudio(event)) return null;
    const previous = activeSettings;
    activeSettings = cameraSettings.saveSettings(app.getPath('userData'), input);
    // The self-view rate applies immediately; capture size/rate need the
    // camera to reopen, which the studio does by restarting the session.
    const restartNeeded = previous.captureFps !== activeSettings.captureFps
      || previous.resolution !== activeSettings.resolution
      || previous.cameraMode !== activeSettings.cameraMode;
    return { ...(await settingsState()), restartNeeded };
  });

  ipcMain.on('kin:window', (event, action) => {
    if (!fromStudio(event)) return;
    const win = studioWindow;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') {
      if (win.isFullScreen()) win.setFullScreen(false);
      else if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'fullscreen') win.setFullScreen(!win.isFullScreen());
    else if (action === 'close') win.close();
  });
}

// First launch: start from the device recommendation, not a fixed default.
async function initCameraSettings() {
  const saved = cameraSettings.loadSettings(app.getPath('userData'));
  if (saved) {
    activeSettings = saved;
  } else {
    deviceInfo = await cameraSettings.deviceProfile(app, powerMonitor);
    activeSettings = cameraSettings.recommend(deviceInfo, null, null).settings;
  }
  if (!app.isPackaged) console.log(`[kin] camera settings ${JSON.stringify(activeSettings)}${saved ? '' : ' (device recommendation)'}`);
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
    minimizable: true,
    fullscreenable: true,
    // Start maximized, not fullscreen: fullscreen hid the window controls
    // and the taskbar. Kin draws its own minimize / maximize / close buttons
    // (always visible, also in fullscreen via F11), so the native title bar
    // is hidden while Windows still provides resize borders and snapping.
    fullscreen: false,
    backgroundColor: '#100d0b',
    show: false,
    title: 'Kin',
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
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
    win.webContents.send('kin:window-mode', {
      fullscreen: win.isFullScreen(),
      maximized: win.isMaximized(),
    });
  };
  win.on('enter-full-screen', sendWindowMode);
  win.on('leave-full-screen', sendWindowMode);
  win.on('maximize', sendWindowMode);
  win.on('unmaximize', sendWindowMode);
  win.on('restore', sendWindowMode);
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
    // camera preview and the living portrait can be seen together. The studio
    // opens maximized, so make room by shrinking it to the left part of the
    // screen; otherwise the companion would land on top of the self-view.
    // If the display is too small, float it over the studio instead of
    // covering the rail and its End action.
    let studioBounds = win.getBounds();
    const area = screen.getDisplayMatching(studioBounds).workArea;
    const companionWidth = portraitPanelWidth(area) || Math.min(420, Math.round(area.width * 0.33));
    if (!win.isFullScreen() && area.width - companionWidth >= 860) {
      if (win.isMaximized()) win.unmaximize();
      win.setBounds({ x: area.x, y: area.y, width: area.width - companionWidth, height: area.height });
      studioBounds = win.getBounds();
      // Give the studio its full width back when the companion closes.
      child.once('closed', () => {
        if (!win.isDestroyed() && !win.isFullScreen()) win.maximize();
      });
    }
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
    win.maximize();
    win.show();
    win.focus();
    if (process.argv.includes('--dev')) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  win.on('closed', () => {
    studioWindow = null;
    for (const other of BrowserWindow.getAllWindows()) {
      if (!other.isDestroyed()) other.destroy();
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  studioWindow = win;
  return win;
}

function installCameraPermissionPolicy() {
  // 'kin' has no persist: prefix, so Electron keeps this session in memory.
  // The studio window opens the camera itself (video only) so the self-view
  // is the live stream and never waits on measurement; it pushes frames to
  // the SDK in this process. Audio is never granted, no other window or
  // permission is granted, and nothing is recorded or uploaded.
  const kinSession = session.fromPartition('kin');
  const isStudio = (contents) => Boolean(studioWindow && !studioWindow.isDestroyed()
    && contents === studioWindow.webContents);
  kinSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const types = (details && details.mediaTypes) || [];
    const videoOnly = permission === 'media' && types.length > 0 && types.every((t) => t === 'video');
    callback(videoOnly && isStudio(contents));
  });
  kinSession.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (permission !== 'media' || !isStudio(contents)) return false;
    return !details || !details.mediaType || details.mediaType === 'video';
  });

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

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    installCameraPermissionPolicy();
    installSdkIpc();
    installFrameIpc();
    installSettingsIpc();
    await initCameraSettings();
    createStudioWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createStudioWindow();
    });
  });

  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting || !nativeSdk) return;
    event.preventDefault();
    quitting = true;
    const stopped = nativeChain.then(() => stopNativeSession()).catch(() => {});
    Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 6000))])
      .finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
