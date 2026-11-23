// Renderer entry point: consent, key handling, SDK lifecycle, and the
// studio UI. The SDK bridge lives in the main process; this file only talks
// to the official preload bridge through the renderer SDK.
//
// Privacy invariants kept here:
//   - the API key is held in a local variable and the input is cleared;
//   - no measurement, key, or session value is written to storage;
//   - no network call is made outside the SDK's authentication handshake;
//   - the SDK is created with enableTelemetry: false;
//   - facial landmarks are never requested.

import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import { SignalEngine } from './signals.js';
import { mountPortrait } from './portrait.js';
import { mountEmoji, EXPRESSIONS } from './emoji.js';
import { createDirectCamera, directCameraSupported } from './direct-camera.js';

// Stable integer values from the SmartSpectra protocol. Defining them locally
// keeps the native SDK (and its koffi binding) out of the renderer bundle.
const ProcessingStatus = Object.freeze({
  kUninitialized: 0,
  kIdle: 1,
  kStarting: 2,
  kRunning: 3,
  kStopping: 4,
  kError: 5,
});

const ValidationCode = Object.freeze({
  kOk: 0,
  kNoFaceFound: 1,
  kMultipleFacesFound: 2,
  kFaceNotCentered: 3,
  kFaceSizeOutOfRange: 4,
  kTooDark: 5,
  kTooBright: 6,
  kChestNotVisible: 7,
  kCameraTuning: 10,
  kFrameRateTooLow: 11,
  kExcessiveMotion: 12,
  kFaceTooClose: 13,
  kFaceTooFar: 14,
  kFaceTooHigh: 15,
  kFaceTooLow: 16,
  kFaceNotForward: 17,
});

const $ = (id) => document.getElementById(id);

const els = {
  app: $('app'),
  stageState: $('stage-state'),
  stageStateLabel: $('stage-state-label'),
  stageTime: $('stage-time'),
  stagePreview: $('stage-preview'),
  stageVideo: $('stage-video'),
  stageMirror: document.querySelector('.stage-mirror'),

  privacyChip: $('privacy-chip'),
  privacyBtn: $('privacy-btn'),
  privacyLink: $('privacy-link'),
  privacy: $('privacy'),
  privacyClose: $('privacy-close'),
  privacyDone: $('privacy-done'),
  presentBtn: $('present-btn'),
  presentExit: $('present-exit'),
  presentChips: $('present-chips'),
  presentPulse: $('present-pulse'),
  presentBreath: $('present-breath'),
  presentExpression: $('present-expression'),
  frameBtn: $('frame-btn'),

  statusPill: $('status-pill'),
  statusLabel: $('status-label'),
  notice: $('notice'),
  noticeText: $('notice-text'),
  noticeClose: $('notice-close'),

  cardPulse: $('card-pulse'),
  pulseState: $('pulse-state'),
  pulseValue: $('pulse-value'),
  pulseSpark: $('pulse-spark'),
  pulseConf: $('pulse-conf'),
  pulseConfBar: $('pulse-conf-bar'),

  cardBreath: $('card-breath'),
  breathState: $('breath-state'),
  breathValue: $('breath-value'),
  breathSpark: $('breath-spark'),
  breathConf: $('breath-conf'),
  breathConfBar: $('breath-conf-bar'),

  cardExpression: $('card-expression'),
  expressionState: $('expression-state'),
  expressionEmoji: $('expression-emoji'),
  expressionBars: $('expression-bars'),
  expressionConf: $('expression-conf'),
  expressionConfBar: $('expression-conf-bar'),

  validation: $('validation'),
  validationLabel: $('validation-label'),
  validationText: $('validation-text'),

  pauseBtn: $('pause-btn'),
  pauseIcon: $('pause-icon'),
  pauseLabel: $('pause-label'),
  endBtn: $('end-btn'),

  consent: $('consent'),
  consentCamera: $('consent-camera'),
  consentFace: $('consent-face'),
  consentMedical: $('consent-medical'),
  consentContinue: $('consent-continue'),

  keygate: $('keygate'),
  apiKey: $('api-key'),
  keyReveal: $('key-reveal'),
  keyError: $('key-error'),
  keyBack: $('key-back'),
  keyContinue: $('key-continue'),

  confirm: $('confirm'),
  confirmCancel: $('confirm-cancel'),
  confirmEnd: $('confirm-end'),

  toast: $('toast'),

  winMin: $('win-min'),
  winMax: $('win-max'),
  winMaxIcon: $('win-max-icon'),
  winClose: $('win-close'),

  settingsBtn: $('settings-btn'),
  settings: $('settings'),
  settingsClose: $('settings-close'),
  settingsCancel: $('settings-cancel'),
  settingsApply: $('settings-apply'),
  settingsNote: $('settings-note'),
  recommendSummary: $('recommend-summary'),
  recommendReasons: $('recommend-reasons'),
  recommendApply: $('recommend-apply'),
  settingsTips: $('settings-tips'),
  settingsHealth: $('settings-health'),
  healthLabel: $('health-label'),
  healthCamera: $('health-camera'),
  healthPreview: $('health-preview'),
  healthLag: $('health-lag'),
};

const engine = new SignalEngine();
const portrait = mountPortrait($('portrait'));
const expressionEmoji = mountEmoji(els.expressionEmoji);

// The studio's own camera stream: smooth native self-view, frames copied on
// the side to the SDK (see src/direct-camera.js). Falls back to the SDK's
// camera + processed-frame preview if the camera cannot be opened here.
const directCamera = createDirectCamera({
  video: els.stageVideo,
  sendFrame: (frame) => (window.kin && typeof window.kin.sendFrame === 'function'
    ? window.kin.sendFrame(frame)
    : Promise.resolve(false)),
  onEnded: () => {
    if (sdkStatus === 'running' || sdkStatus === 'starting') {
      handleFailure(7, 'The camera was disconnected.', true);
    }
  },
});
let cameraSource = 'direct';

// Frame-layout safety net. NV12 is ~3x cheaper per frame than RGBA on the
// test laptop, but it is not the layout the SDK's own Electron binding uses.
// If the SDK runs for 12 s with frames flowing and never reports anything
// that needs a detected face (a position hint, or a reading), switch the
// pump to RGBA for the rest of this app run.
const FACE_EVIDENCE_CODES = new Set([2, 3, 4, 7, 12, 13, 14, 15, 16, 17]);
let layoutWatch = null; // { token, since, evidence }
let rgbaRemembered = false;

function noteFaceEvidence() {
  if (layoutWatch) layoutWatch.evidence = true;
}

function checkFrameLayout(now) {
  const w = layoutWatch;
  if (!w || w.evidence || w.token !== sessionToken || cameraSource !== 'direct') return;
  if (sdkStatus !== 'running') return;
  if (w.since == null) {
    w.since = now;
    return;
  }
  if (engine.pulseSeen || engine.breathSeen || engine.faceSeen) {
    w.evidence = true;
    return;
  }
  if (now - w.since > 12000 && directCamera.pixelMode === 'nv12') {
    console.warn('[kin] no face evidence from NV12 frames after 12 s; switching to RGBA frames');
    directCamera.setPixelMode('rgba');
    rgbaRemembered = true;
    w.evidence = true;
  }
}

// ------------------------------------------------------------------ state

let appScreen = 'consent';
let statusKind = 'idle'; // idle | waking | listening | paused | error
let sdkStatus = 'idle'; // idle | starting | running | pausing | paused | error
let sessionToken = 0;
let apiKey = null;
let operatorKey = null;
let consentedFace = false;

let currentEntitlements = { pulse: true, breath: true, face: false };
let faceDropped = false;
let fallbackAttempts = 0;
let ending = false;
let failureHandling = false;

let sessionElapsedMs = 0;
let sessionActiveStart = null;

let frameWindow = null;
let stageChannel = null;
let isFullscreen = false;
let lastUiPaint = 0;
let lastPortraitPaint = 0;
let lastBroadcast = 0;
let lastFrameAt = performance.now();

// Read-only diagnostics for a live performance check. These are counters only:
// no frames, measurements, key material, or user data are exposed.
const perfState = {
  startedAt: performance.now(),
  previewEvents: 0,
  previewPaints: 0,
  previewPaintMax: 0,
  lastPreviewAt: 0,
  previewGapMax: 0,
  metricsEvents: 0,
  metricsDecodeTotal: 0,
  metricsDecodeMax: 0,
  longTasks: 0,
  longTaskMax: 0,
};
window.__kinPerf = perfState;
if (typeof PerformanceObserver === 'function') {
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        perfState.longTasks += 1;
        if (entry.duration > perfState.longTaskMax) perfState.longTaskMax = entry.duration;
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    /* long-task timing is not available in this Chromium build */
  }
}

// A 5-second rolling summary in the dev console (forwarded to the terminal by
// main.js in unpackaged builds). Counters only; no frame or reading values.
{
  let last = { ...perfState, at: performance.now() };
  let camLast = { read: 0, sent: 0, busySkips: 0 };
  setInterval(() => {
    const now = performance.now();
    const seconds = Math.max(0.001, (now - last.at) / 1000);
    const previews = perfState.previewEvents - last.previewEvents;
    const metrics = perfState.metricsEvents - last.metricsEvents;
    const cam = directCamera.stats;
    // stats reset to 0 when a camera session starts; treat that as a new base.
    if (cam.read < camLast.read) camLast = { read: 0, sent: 0, busySkips: 0 };
    const camRead = cam.read - camLast.read;
    const camText = `camera read ${(camRead / seconds).toFixed(1)} fps · sent ${((cam.sent - camLast.sent) / seconds).toFixed(1)} fps · busy skips ${cam.busySkips - camLast.busySkips} · ${cam.format || '-'} · ${cam.thread || '?'} thread · `;
    camLast = { read: cam.read, sent: cam.sent, busySkips: cam.busySkips };
    if (!previews && !metrics && !camRead) return;
    const paints = perfState.previewPaints - last.previewPaints;
    const longTasks = perfState.longTasks - last.longTasks;
    console.log(
      `[kin-ui] ${camText}preview in ${(previews / seconds).toFixed(1)} fps · painted ${(paints / seconds).toFixed(1)} fps · ` +
      `paint max ${perfState.previewPaintMax.toFixed(1)} ms · gap max ${Math.round(perfState.previewGapMax)} ms · ` +
      `metrics ${metrics} · decode max ${perfState.metricsDecodeMax.toFixed(1)} ms · ` +
      `long tasks ${longTasks} (max ${Math.round(perfState.longTaskMax)} ms) · pulse ${engine.pulseRate ? 'live' : 'none'}`,
    );
    perfState.previewPaintMax = 0;
    perfState.previewGapMax = 0;
    perfState.metricsDecodeMax = 0;
    perfState.longTaskMax = 0;
    last = { ...perfState, at: now };
  }, 5000);
}

// Text and style writes are skipped when the value is unchanged. Rewriting
// identical text still replaces the text node and dirties layout, which the
// signal cards would otherwise do ~5 times a second once readings arrive.
function setText(el, value) {
  if (el.textContent !== value) el.textContent = value;
}

function setStyle(el, prop, value) {
  if (el.style[prop] !== value) el.style[prop] = value;
}

function setData(el, key, value) {
  if (el.dataset[key] !== value) el.dataset[key] = value;
}

let toastTimer = null;
let noticeVisible = false;

// The nine expression types are drawn as a small equalizer so the face
// signal is visible even when the winning label stays "Neutral".
const expressionBarEls = [];
for (let type = 0; type <= 8; type += 1) {
  const bar = document.createElement('i');
  bar.dataset.type = String(type);
  els.expressionBars.appendChild(bar);
  expressionBarEls.push(bar);
}

// ------------------------------------------------------------- small utils

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function elapsedMs(now = performance.now()) {
  return sessionElapsedMs + (sessionActiveStart == null ? 0 : now - sessionActiveStart);
}

function startClock() {
  if (sessionActiveStart == null) sessionActiveStart = performance.now();
}

function stopClock() {
  if (sessionActiveStart != null) {
    sessionElapsedMs += performance.now() - sessionActiveStart;
    sessionActiveStart = null;
  }
}

// ------------------------------------------------------------- status / UI

const STATUS_META = {
  idle: { label: 'Sleeping', tone: 'muted' },
  waking: { label: 'Waking', tone: 'warm' },
  listening: { label: 'Listening', tone: 'live' },
  paused: { label: 'Paused', tone: 'muted' },
  error: { label: 'Needs attention', tone: 'error' },
};

function setStatus(kind) {
  statusKind = kind;
  const meta = STATUS_META[kind] || STATUS_META.idle;
  els.statusLabel.textContent = meta.label;
  els.statusPill.dataset.tone = meta.tone;
  els.stageState.dataset.tone = meta.tone;
  els.stageStateLabel.textContent = meta.label;
  engine.setStatus(kind);
}

const ICON_PAUSE = '<rect x="7" y="5" width="3.4" height="14" rx="1"/><rect x="13.6" y="5" width="3.4" height="14" rx="1"/>';
const ICON_PLAY = '<path d="M8 5.5v13l10-6.5z"/>';

function setPauseUi(mode) {
  const labels = {
    pause: 'Pause',
    resume: 'Resume',
    starting: 'Starting…',
    pausing: 'Pausing…',
    retry: 'Try again',
    off: 'Pause',
  };
  const disabled = mode === 'starting' || mode === 'pausing' || mode === 'off';
  const icon = mode === 'resume' || mode === 'retry' ? ICON_PLAY : ICON_PAUSE;
  els.pauseBtn.disabled = disabled;
  els.pauseLabel.textContent = labels[mode] || 'Pause';
  els.pauseIcon.innerHTML = icon;
  els.pauseBtn.dataset.mode = mode;
}

function showNotice(text) {
  els.noticeText.textContent = text;
  els.notice.hidden = false;
  noticeVisible = true;
}

function hideNotice() {
  els.notice.hidden = true;
  noticeVisible = false;
}

function showToast(text, tone = 'warn', ms = 6500) {
  if (toastTimer) clearTimeout(toastTimer);
  els.toast.textContent = text;
  els.toast.dataset.tone = tone;
  els.toast.hidden = false;
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
    toastTimer = null;
  }, ms);
}

function setValidation(label, text, tone = 'neutral') {
  els.validationLabel.textContent = label;
  els.validationText.textContent = text;
  els.validation.dataset.tone = tone;
}

const VALIDATION_COPY = {
  [ValidationCode.kOk]: ['Position', 'Good position. Hold gently still.', 'ok'],
  [ValidationCode.kNoFaceFound]: ['No face yet', 'Move into the frame with your face and chest visible.', 'warn'],
  [ValidationCode.kMultipleFacesFound]: ['More than one face', 'Kin listens to one person. Ask others to step out of view.', 'warn'],
  [ValidationCode.kFaceNotCentered]: ['Center yourself', 'Move toward the middle of the frame.', 'warn'],
  [ValidationCode.kFaceSizeOutOfRange]: ['Adjust distance', 'Move a little closer or farther back.', 'warn'],
  [ValidationCode.kTooDark]: ['Too dark', 'Add soft light in front of you — avoid strong backlight.', 'warn'],
  [ValidationCode.kTooBright]: ['Too bright', 'Move out of direct light or soften it.', 'warn'],
  [ValidationCode.kChestNotVisible]: ['Chest not in frame', 'Sit back so your chest and shoulders are visible.', 'warn'],
  [ValidationCode.kCameraTuning]: ['Camera', 'Letting the camera settle. This can take a moment.', 'neutral'],
  [ValidationCode.kFrameRateTooLow]: ['Low frame rate', 'Add light in front of you or close other camera apps, then try again.', 'warn'],
  [ValidationCode.kExcessiveMotion]: ['Too much movement', 'Rest gently and hold still for a few seconds.', 'warn'],
  [ValidationCode.kFaceTooClose]: ['A little too close', 'Move back so your head and chest are in frame.', 'warn'],
  [ValidationCode.kFaceTooFar]: ['A little too far', 'Move closer to the camera.', 'warn'],
  [ValidationCode.kFaceTooHigh]: ['A little high', 'Lower your chair or tilt the camera up.', 'warn'],
  [ValidationCode.kFaceTooLow]: ['A little low', 'Raise your chair or tilt the camera down.', 'warn'],
  [ValidationCode.kFaceNotForward]: ['Face the camera', 'Turn toward the screen and relax your shoulders.', 'warn'],
};

function applyValidation(code, hint) {
  if (statusKind === 'paused' || statusKind === 'idle' || statusKind === 'error') return;
  const copy = VALIDATION_COPY[code] || ['Position', hint || 'Hold still in front of the camera.', 'neutral'];
  setValidation(copy[0], copy[1], copy[2]);
}

const ERROR_COPY = {
  1: 'Kin is in an unexpected state. Try again.',
  2: 'That API key was not accepted. Check it and try again.',
  3: 'The SDK could not configure the requested signals. Try again.',
  4: 'This API key has no credits left.',
  5: 'Kin lost its connection to Presage during the session. Check your connection, then try again.',
  6: 'Presage had a server error. Try again in a moment.',
  7: 'The camera is unavailable. Close other apps that use it and try again.',
  8: 'The measurement engine stopped. Try again.',
  9: 'A camera frame could not be processed. Try again.',
  10: 'The camera clock jumped. Restart the session.',
  11: 'The camera paused for too long. Try again.',
  13: 'This key does not include one of the requested signals.',
  14: 'The camera could not keep up. Close other camera apps and try again.',
};

// -------------------------------------------------------------- sparklines

// Sparkline sizes come from a ResizeObserver instead of getBoundingClientRect,
// which forced a synchronous layout on every UI paint. Each canvas is redrawn
// only when its data, color, or size changed.
const sparkSizes = new Map();
const sparkSignatures = new Map();
const sparkObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entries) => {
    for (const entry of entries) {
      const box = entry.contentRect;
      sparkSizes.set(entry.target, { width: box.width, height: box.height });
      sparkSignatures.delete(entry.target);
    }
  })
  : null;

function sparkSize(canvas) {
  if (!sparkObserver) return canvas.getBoundingClientRect();
  if (!sparkSizes.has(canvas)) {
    sparkObserver.observe(canvas);
    const rect = canvas.getBoundingClientRect();
    sparkSizes.set(canvas, { width: rect.width, height: rect.height });
  }
  return sparkSizes.get(canvas);
}

function drawSparkline(canvas, values, color) {
  const rect = sparkSize(canvas);
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  const last = values.length ? values[values.length - 1] : 'e';
  const signature = `${width}x${height}|${color}|${values.length}|${last}|${values.length > 1 ? values[0] : ''}`;
  if (sparkSignatures.get(canvas) === signature) return;
  sparkSignatures.set(canvas, signature);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  const pad = 3 * dpr;
  ctx.strokeStyle = 'rgba(41, 28, 20, .10)';
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.moveTo(pad, height - pad);
  ctx.lineTo(width - pad, height - pad);
  ctx.stroke();

  const n = values.length;
  if (n < 2) return;

  const stepX = (width - pad * 2) / (n - 1);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * dpr;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  let drawing = false;
  for (let i = 0; i < n; i += 1) {
    const value = values[i];
    if (value == null || !Number.isFinite(value)) {
      drawing = false;
      continue;
    }
    const x = pad + i * stepX;
    const y = height - pad - clamp(value, 0, 1) * (height - pad * 2);
    if (!drawing) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      drawing = true;
    } else {
      ctx.lineTo(x, y);
    }
    const next = values[i + 1];
    if (i === n - 1 || next == null || !Number.isFinite(next)) {
      ctx.stroke();
      drawing = false;
    }
  }
}

// ---------------------------------------------------------------- painting

function paintPulse(ui, paused, errored) {
  const p = ui.pulse;
  const enabled = p.enabled && statusKind !== 'idle';
  const live = enabled && p.live && !paused && !errored;

  setData(els.cardPulse, 'state', !enabled ? 'off' : live ? 'live' : 'on');
  setText(els.pulseState, !enabled
    ? 'Off'
    : paused
      ? 'Paused'
      : errored
        ? 'Stopped'
        : live
          ? 'Live'
          : p.seen
            ? 'Holding'
            : 'Warming');

  setText(els.pulseValue, enabled && p.rate != null ? String(Math.round(p.rate)) : '—');

  if (!enabled) {
    setText(els.pulseConf, 'Pulse is off');
  } else if (paused) {
    setText(els.pulseConf, p.rate != null ? 'Paused · last estimate' : 'Paused');
  } else if (errored) {
    setText(els.pulseConf, p.rate != null ? 'Stopped · last estimate' : 'No signal');
  } else if (p.rate != null) {
    setText(els.pulseConf, `${p.stable ? 'Stable' : 'Estimate'} · ${Math.round(p.confidence)}%`);
  } else {
    setText(els.pulseConf, 'Warming · usually ~12s');
  }

  const width = enabled && p.rate != null ? `${Math.round(clamp(p.confidence, 0, 100))}%` : '0%';
  setStyle(els.pulseConfBar, 'width', width);
  setStyle(els.pulseConfBar, 'background', p.stable ? 'var(--sage)' : 'var(--clay)');

  drawSparkline(els.pulseSpark, enabled ? ui.pulseHistory : [], '#bf6a45');
}

function paintBreath(ui, paused, errored) {
  const b = ui.breath;
  const enabled = b.enabled && statusKind !== 'idle';
  const live = enabled && b.live && !paused && !errored;

  setData(els.cardBreath, 'state', !enabled ? 'off' : live ? 'live' : 'on');
  setText(els.breathState, !enabled
    ? 'Off'
    : paused
      ? 'Paused'
      : errored
        ? 'Stopped'
        : live
          ? 'Live'
          : b.seen
            ? 'Holding'
            : 'Warming');

  setText(els.breathValue, enabled && b.rate != null ? String(Math.round(b.rate)) : '—');

  if (!enabled) {
    setText(els.breathConf, 'Breathing is off');
  } else if (paused) {
    setText(els.breathConf, b.rate != null ? 'Paused · last estimate' : 'Paused');
  } else if (errored) {
    setText(els.breathConf, b.rate != null ? 'Stopped · last estimate' : 'No signal');
  } else if (b.rate != null) {
    setText(els.breathConf, `${b.stable ? 'Stable' : 'Estimate'} · ${Math.round(b.confidence)}%`);
  } else {
    setText(els.breathConf, 'Warming · usually ~30s');
  }

  const width = enabled && b.rate != null ? `${Math.round(clamp(b.confidence, 0, 100))}%` : '0%';
  setStyle(els.breathConfBar, 'width', width);
  setStyle(els.breathConfBar, 'background', b.stable ? 'var(--sage)' : 'var(--clay)');

  drawSparkline(els.breathSpark, enabled ? ui.breathHistory : [], '#7e8c6a');
}

function paintExpression(ui, paused, errored) {
  const f = ui.face;
  const enabled = f.enabled && statusKind !== 'idle';

  setData(els.cardExpression, 'state', !enabled ? 'off' : f.seen ? 'live' : 'on');
  setText(els.expressionState, !enabled
    ? 'Off'
    : paused
      ? 'Paused'
      : errored
        ? 'Stopped'
        : f.seen
          ? 'Mirroring'
          : 'Watching');

  // The emoji mirrors the smoothed face pose (eyes, brows, smile, mouth) and
  // names the winning expression. It only writes attributes that changed.
  const pose = engine.getRenderState().face;
  let note = '';
  if (!enabled && consentedFace && statusKind !== 'idle') note = 'Not included with this key';
  else if (enabled && paused) note = 'Paused';
  else if (enabled && errored) note = 'Stopped';
  expressionEmoji.render({
    enabled,
    seen: enabled && f.seen && !paused && !errored,
    type: f.type,
    confidence: f.confidence,
    face: pose,
    note,
  });

  if (!enabled) {
    setText(els.expressionConf, consentedFace
      ? 'Visible expression isn’t on this key'
      : 'Expression mirror is off');
  } else if (paused) {
    setText(els.expressionConf, 'Paused');
  } else if (errored) {
    setText(els.expressionConf, 'Stopped');
  } else if (!f.seen) {
    setText(els.expressionConf, 'Watching for a face');
  } else {
    setText(els.expressionConf, `${Math.round(f.confidence)}% confident · visible shape only`);
  }

  const width = enabled && f.seen ? `${Math.round(clamp(f.confidence, 0, 100))}%` : '0%';
  setStyle(els.expressionConfBar, 'width', width);
  setStyle(els.expressionConfBar, 'background', f.confidence >= 40 ? 'var(--sage)' : 'var(--clay)');

  const scores = new Map();
  if (enabled && Array.isArray(f.scores)) {
    for (const score of f.scores) scores.set(score.type, score.confidence);
  }
  for (const bar of expressionBarEls) {
    const type = Number(bar.dataset.type);
    const score = scores.get(type) || 0;
    setStyle(bar, 'height', `${2 + clamp(score, 0, 100) / 100 * 20}px`);
    bar.classList.toggle('active', enabled && type === f.type && f.confidence >= 18);
  }
}

function paintPresent(ui) {
  setText(els.presentPulse, ui.pulse.enabled && ui.pulse.rate != null ? String(Math.round(ui.pulse.rate)) : '—');
  setText(els.presentBreath, ui.breath.enabled && ui.breath.rate != null ? String(Math.round(ui.breath.rate)) : '—');
  setText(els.presentExpression, ui.face.enabled && ui.face.seen ? expressionText(ui.face) : '—');
}

function expressionText(face) {
  const entry = face.confidence >= 18 ? EXPRESSIONS[face.type] : null;
  const shown = entry || EXPRESSIONS[6];
  return `${shown.emoji} ${shown.name}`;
}

function paintUi(now = performance.now()) {
  const ui = engine.getUiState();
  const paused = statusKind === 'paused';
  const errored = statusKind === 'error';

  paintPulse(ui, paused, errored);
  paintBreath(ui, paused, errored);
  paintExpression(ui, paused, errored);
  paintPresent(ui);

  setText(els.stageTime, formatTime(elapsedMs(now)));
}

// --------------------------------------------------------------- broadcast

function framePayload(now = performance.now()) {
  const ui = engine.getUiState();
  const meta = STATUS_META[statusKind] || STATUS_META.idle;
  return {
    type: 'kin-state',
    render: engine.getRenderState(),
    status: { kind: statusKind, label: meta.label, tone: meta.tone },
    ui: {
      pulse: { enabled: ui.pulse.enabled, rate: ui.pulse.rate, live: ui.pulse.live },
      breath: { enabled: ui.breath.enabled, rate: ui.breath.rate, live: ui.breath.live },
      face: { enabled: ui.face.enabled, label: ui.face.label, seen: ui.face.seen },
    },
    elapsedMs: elapsedMs(now),
  };
}

function broadcastState(now = performance.now()) {
  if (!frameWindow || frameWindow.closed) return;
  const payload = framePayload(now);
  try {
    frameWindow.postMessage(payload, '*');
  } catch {
    /* the frame may have closed between the check and the post */
  }
}

function openFrame() {
  if (isFullscreen) {
    showToast('The frame window is available in windowed mode. Press F11 to leave fullscreen.', 'warn');
    return;
  }

  if (frameWindow && !frameWindow.closed) {
    els.app.dataset.companion = 'on';
    frameWindow.focus();
    broadcastState();
    return;
  }

  frameWindow = window.open('stage.html', 'kinFrame');
  if (!frameWindow) {
    showToast('The frame window was blocked. Allow pop-ups for Kin and try again.', 'warn');
    return;
  }

  els.app.dataset.companion = 'on';

  broadcastState();
  setTimeout(() => broadcastState(), 300);
  setTimeout(() => broadcastState(), 900);
}

function closeFrame() {
  if (frameWindow && !frameWindow.closed) {
    try {
      frameWindow.close();
    } catch {
      /* already gone */
    }
  }
  frameWindow = null;
  delete els.app.dataset.companion;
}

function companionFits() {
  return Boolean(window.screen && Number(window.screen.availWidth) >= 1250);
}

function applyWindowMode(payload) {
  if (payload && typeof payload.maximized === 'boolean') updateMaxButton(payload.maximized, Boolean(payload.fullscreen));
  const next = Boolean(payload && payload.fullscreen);
  if (next === isFullscreen) return;
  isFullscreen = next;
  document.body.classList.toggle('kin-fullscreen', isFullscreen);
  if (isFullscreen) closeFrame();
}

// Electron's fullscreen events cover the normal path. The viewport check is a
// fallback for display managers that do not deliver the leave event reliably.
function syncFullscreenFromViewport() {
  const full = Boolean(
    window.screen
    && window.innerWidth >= window.screen.width
    && window.innerHeight >= window.screen.height,
  );
  applyWindowMode({ fullscreen: full });
}

if (window.kin && typeof window.kin.onWindowMode === 'function') {
  window.kin.onWindowMode(applyWindowMode);
}
if (!window.kin || typeof window.kin.onWindowMode !== 'function') {
  window.addEventListener('resize', () => requestAnimationFrame(syncFullscreenFromViewport));
  requestAnimationFrame(syncFullscreenFromViewport);
}

// ------------------------------------------------------------- SDK lifecycle

function requestedMetrics(entitlements) {
  const codes = [];
  if (entitlements.breath) codes.push(0, 2); // chest trace, breathing rate
  // Pulse rate only. Metric 16 (ARTERIAL_PRESSURE_TRACE) pulls the separate
  // phasic-bp-inference model in the native SDK. That model load runs beside
  // the live camera and was the source of the pulse-start latency. The
  // portrait already has a rate-only mode: a fresh measured rate paces the
  // glow, with no invented waveform.
  if (entitlements.pulse) codes.push(15);
  if (entitlements.face) codes.push(12, 13, 14); // blinking, talking, expressions
  return codes;
}

let previewGl = null;
let previewGlTexture = null;
let previewGlSwap = null;
let previewGlWidth = 0;
let previewGlHeight = 0;
let previewGlFormat = 0;
let previewContext = null;
let previewImageData = null;
let pendingPreview = null;
let previewRaf = 0;

// The main process keeps at most one preview frame in flight and waits for
// this ack before sending the next one. That bounds the self-view latency to
// about one frame: if a paint is slow, stale frames are dropped in the main
// process instead of queueing up in IPC.
function ackPreview(event) {
  if (!event || !window.kin || typeof window.kin.sendSdkCommand !== 'function') return;
  window.kin.sendSdkCommand({ type: 'preview-ack', session: event.session });
}

// The preview is drawn with WebGL so the studio thread only issues a texture
// upload and a draw. Preferred path (WebGL2): the packed RGB/RGBA bytes are
// uploaded as a single-channel R8 texture (width * channels texels wide) and
// the shader reassembles each pixel with texelFetch. R8 is a native D3D11
// format, so ANGLE copies the bytes as-is. A plain RGB texture is NOT native
// on D3D11: ANGLE expands it to RGBA on the CPU inside the GPU process, which
// on the two-core test laptop competes with measurement. WebGL1 RGB/RGBA and
// a 2D canvas remain as fallbacks.
let previewGlLost = false;
let previewGlMode = 0; // 2 = WebGL2 R8 path, 1 = WebGL1 RGB/RGBA path
let previewGlUniforms = null;

function setupPreviewGl() {
  const canvas = els.stagePreview;
  if (!canvas) return false;
  const attributes = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    desynchronized: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  };
  let gl = null;
  let mode = 0;
  try {
    gl = canvas.getContext('webgl2', attributes);
    if (gl) mode = 2;
  } catch {
    gl = null;
  }
  if (!gl) {
    try {
      gl = canvas.getContext('webgl', attributes);
      if (gl) mode = 1;
    } catch {
      gl = null;
    }
  }
  if (!gl) return false;

  const sources = mode === 2
    ? {
      vertex: '#version 300 es\nin vec2 a_pos; out vec2 v_uv; void main() { v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5); gl_Position = vec4(a_pos, 0.0, 1.0); }',
      fragment: '#version 300 es\nprecision highp float; precision highp int; in vec2 v_uv; uniform highp sampler2D u_frame; uniform ivec2 u_size; uniform int u_channels; uniform float u_swap; out vec4 o_color;\n'
        + 'void main() { ivec2 p = clamp(ivec2(v_uv * vec2(u_size)), ivec2(0), u_size - 1); int x = p.x * u_channels;\n'
        + 'vec3 c = vec3(texelFetch(u_frame, ivec2(x, p.y), 0).r, texelFetch(u_frame, ivec2(x + 1, p.y), 0).r, texelFetch(u_frame, ivec2(x + 2, p.y), 0).r);\n'
        + 'o_color = vec4(mix(c, c.bgr, u_swap), 1.0); }',
    }
    : {
      vertex: 'attribute vec2 a_pos; varying vec2 v_uv; void main() { v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5); gl_Position = vec4(a_pos, 0.0, 1.0); }',
      // u_swap handles BGR/BGRA sources on the GPU; alpha is forced opaque.
      fragment: 'precision mediump float; varying vec2 v_uv; uniform sampler2D u_frame; uniform float u_swap; void main() { vec4 c = texture2D(u_frame, v_uv); gl_FragColor = vec4(mix(c.rgb, c.bgr, u_swap), 1.0); }',
    };

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed');
    }
    return shader;
  }

  try {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, sources.vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, sources.fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'shader link failed');
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    previewGlTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, previewGlTexture);
    const filter = mode === 2 ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.uniform1i(gl.getUniformLocation(program, 'u_frame'), 0);
    previewGlUniforms = {
      swap: gl.getUniformLocation(program, 'u_swap'),
      size: mode === 2 ? gl.getUniformLocation(program, 'u_size') : null,
      channels: mode === 2 ? gl.getUniformLocation(program, 'u_channels') : null,
    };
    gl.uniform1f(previewGlUniforms.swap, 0);
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (!canvas.dataset.glListeners) {
      canvas.dataset.glListeners = '1';
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        previewGlLost = true;
        previewGl = null;
        previewGlWidth = 0;
        previewGlHeight = 0;
        previewGlFormat = 0;
      });
      canvas.addEventListener('webglcontextrestored', () => {
        previewGlLost = false;
        setupPreviewGl();
      });
    }
    previewGlMode = mode;
    previewGl = gl;
    if (typeof console !== 'undefined') console.log(`[kin-ui] preview renderer: WebGL${mode}${mode === 2 ? ' (R8 upload)' : ''}`);
    return true;
  } catch (error) {
    console.error('Kin: WebGL preview unavailable', error);
    previewGl = null;
    return false;
  }
}

function paintPreviewGl(bytes, width, height, channels, swap) {
  const gl = previewGl;
  if (!gl || gl.isContextLost()) return false;
  const canvas = els.stagePreview;
  if (!canvas) return false;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, previewGlTexture);
  gl.uniform1f(previewGlUniforms.swap, swap ? 1 : 0);

  if (previewGlMode === 2) {
    const texWidth = width * channels;
    const format = channels; // key: texture layout changes with channel count
    if (previewGlWidth !== texWidth || previewGlHeight !== height || previewGlFormat !== format) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, texWidth, height, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
      gl.uniform2i(previewGlUniforms.size, width, height);
      gl.uniform1i(previewGlUniforms.channels, channels);
      previewGlWidth = texWidth;
      previewGlHeight = height;
      previewGlFormat = format;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, texWidth, height, gl.RED, gl.UNSIGNED_BYTE, bytes);
    }
  } else {
    const format = channels === 3 ? gl.RGB : gl.RGBA;
    if (previewGlWidth !== width || previewGlHeight !== height || previewGlFormat !== format) {
      gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, gl.UNSIGNED_BYTE, bytes);
      previewGlWidth = width;
      previewGlHeight = height;
      previewGlFormat = format;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, format, gl.UNSIGNED_BYTE, bytes);
    }
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return true;
}

function clearPreview() {
  if (pendingPreview) ackPreview(pendingPreview);
  pendingPreview = null;
  if (previewRaf) {
    cancelAnimationFrame(previewRaf);
    previewRaf = 0;
  }
  if (previewGl) {
    previewGl.clearColor(0.043, 0.035, 0.031, 1);
    previewGl.clear(previewGl.COLOR_BUFFER_BIT);
    previewGlWidth = 0;
    previewGlHeight = 0;
    previewGlFormat = 0;
    return;
  }
  const canvas = els.stagePreview;
  if (!canvas) return;
  if (!previewContext) previewContext = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!previewContext) return;
  previewContext.fillStyle = '#0b0908';
  previewContext.fillRect(0, 0, canvas.width, canvas.height);
}

// Coalesce preview packets to the next display frame. The measurement thread
// can deliver faster than the compositor; keeping only the newest packet means
// a slow paint drops stale frames instead of building a visible queue.
function queuePreview(event) {
  if (pendingPreview) ackPreview(pendingPreview);
  pendingPreview = event;
  if (!previewRaf) previewRaf = requestAnimationFrame(paintQueuedPreview);
}

function paintQueuedPreview() {
  previewRaf = 0;
  const event = pendingPreview;
  pendingPreview = null;
  if (!event) return;
  try {
    if (els.app.dataset.mirror === 'on') {
      const start = performance.now();
      paintPreview(event);
      const ms = performance.now() - start;
      if (ms > perfState.previewPaintMax) perfState.previewPaintMax = ms;
    }
  } finally {
    ackPreview(event);
  }
}

function paintPreview(event) {
  perfState.previewPaints += 1;
  const canvas = els.stagePreview;
  if (!canvas || !event.width || !event.height) return;
  const bytes = event.buffer instanceof Uint8Array ? event.buffer : new Uint8Array(event.buffer);
  const { width, height, pixelFormat } = event;
  // Packets are tightly packed RGB/BGR (3) or RGBA/BGRA (4) at camera size.
  // CSS object-fit: cover crops the canvas to the 4:3 frame.
  const channels = event.channels || (pixelFormat === 2 || pixelFormat === 3 ? 4 : 3);
  const swap = pixelFormat === 1 || pixelFormat === 3;
  if (!bytes || bytes.length < width * height * channels) return;

  if (!previewGl && !previewGlLost) setupPreviewGl();
  if (previewGl && paintPreviewGl(bytes, width, height, channels, swap)) return;

  // Fallback without WebGL: CPU conversion into a 2D canvas.
  if (!previewContext) previewContext = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!previewContext) return;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    previewImageData = null;
  }
  if (!previewImageData) previewImageData = previewContext.createImageData(width, height);
  const rgba = previewImageData.data;
  const r = swap ? 2 : 0;
  const b = swap ? 0 : 2;
  for (let src = 0, dst = 0; dst < rgba.length; src += channels, dst += 4) {
    rgba[dst] = bytes[src + r];
    rgba[dst + 1] = bytes[src + 1];
    rgba[dst + 2] = bytes[src + b];
    rgba[dst + 3] = 255;
  }
  previewContext.putImageData(previewImageData, 0, 0);
}

function enterMirrorMode() {
  // The studio portrait uses compositor-driven CSS for pulse and breath, so
  // it can stay beside the self-view without the extra renderer window. The
  // full companion remains available on demand from the header or F.
  // Self-view off (camera settings): keep measuring with the portrait only.
  if (cameraPrefs.selfView === 'off') return;
  els.app.dataset.mirror = 'on';
}

function exitMirrorMode() {
  delete els.app.dataset.mirror;
  clearPreview();
}

function markRunningFromFrame() {
  // Some SDK builds emit frames and validation before (or without) a
  // kRunning status callback. A delivered camera frame is proof that capture
  // is live; use it to leave the waking state instead of leaving the user on
  // "Waking" with the clock stuck.
  if (sdkStatus !== 'starting' || statusKind !== 'waking') return;
  sdkStatus = 'running';
  setStatus('listening');
  setPauseUi('pause');
  startClock();
  els.endBtn.disabled = false;
}

function handleSdkEvent(event) {
  if (!event || typeof event.type !== 'string') return;
  if (event.session !== sessionToken) return;

  if (event.type === 'status') {
    const status = event.status;
    if (status === ProcessingStatus.kStarting) {
      // A frame or metric can arrive before the SDK's delayed running status.
      // Do not let a late starting callback pull a live session back to waking.
      if (sdkStatus !== 'running' && statusKind !== 'paused' && statusKind !== 'error') {
        setStatus('waking');
        setPauseUi('starting');
        els.endBtn.disabled = false;
      }
      return;
    }
    if (status === ProcessingStatus.kRunning) {
      if (sdkStatus !== 'paused' && statusKind !== 'error') {
        sdkStatus = 'running';
        setStatus('listening');
        setPauseUi('pause');
        startClock();
        els.endBtn.disabled = false;
      }
      return;
    }
    if (status === ProcessingStatus.kStopping) {
      if (statusKind !== 'paused' && statusKind !== 'error') setPauseUi('pausing');
      return;
    }
    if (status === ProcessingStatus.kIdle && sdkStatus === 'running' && !failureHandling) {
      handleFailure(8, 'The measurement engine stopped.', true);
      return;
    }
    if (status === ProcessingStatus.kError) {
      const token = sessionToken;
      setTimeout(() => {
        if (token === sessionToken && statusKind !== 'error' && !failureHandling) {
          handleFailure(0, 'The measurement engine stopped unexpectedly.', true);
        }
      }, 1200);
    }
    return;
  }

  if (event.type === 'validation') {
    if (FACE_EVIDENCE_CODES.has(event.code)) noteFaceEvidence();
    applyValidation(event.code, event.hint);
    return;
  }

  if (event.type === 'preview') {
    const now = performance.now();
    perfState.previewEvents += 1;
    if (perfState.lastPreviewAt) {
      const gap = now - perfState.lastPreviewAt;
      if (gap > perfState.previewGapMax) perfState.previewGapMax = gap;
    }
    perfState.lastPreviewAt = now;
    markRunningFromFrame();
    if (els.app.dataset.mirror === 'on') queuePreview(event);
    else ackPreview(event);
    return;
  }

  if (event.type === 'metrics') {
    markRunningFromFrame();
    const decodeStart = performance.now();
    try {
      const bytes = event.buffer instanceof Uint8Array ? event.buffer : new Uint8Array(event.buffer);
      const metrics = decodeMetrics(bytes);
      engine.ingest(metrics, performance.now());
    } catch (error) {
      console.error('Kin: could not decode a metrics packet.', error);
    }
    const decodeMs = performance.now() - decodeStart;
    perfState.metricsEvents += 1;
    perfState.metricsDecodeTotal += decodeMs;
    if (decodeMs > perfState.metricsDecodeMax) perfState.metricsDecodeMax = decodeMs;
    return;
  }

  if (event.type === 'accepting') {
    directCamera.setAccepting(event.session);
    return;
  }

  if (event.type === 'health') {
    applyHealth(event);
    return;
  }

  if (event.type === 'error') {
    console.warn('[kin] SmartSpectra error', event.code, event.message || '');
    handleFailure(event.code, event.message, event.retryable);
  }
}

async function teardownSdk(options = {}) {
  sessionToken += 1;
  if (window.kin && typeof window.kin.sendSdkCommand === 'function') {
    window.kin.sendSdkCommand({ type: 'stop', session: sessionToken });
  }
  // Release the camera (the OS camera light goes off on pause and end).
  await directCamera.stop();
  clearPreview();
  if (!options.keepFrame) exitMirrorMode();
}

async function startSession(options = {}) {
  if (sdkStatus === 'starting' || sdkStatus === 'running' || ending) return;
  if (!apiKey) {
    await handleFailure(2, 'A Presage key is required.', false);
    return;
  }
  if (!window.kin || typeof window.kin.sendSdkCommand !== 'function') {
    await handleFailure(8, 'The camera bridge is unavailable. Restart Kin and try again.', false);
    return;
  }

  sdkStatus = 'starting';
  hideNotice();
  // An automatic reconnect keeps the last readings on screen; they are
  // replaced as soon as the engine measures again.
  if (!options.keepReadings) engine.resetSignals();
  engine.setEntitlements(currentEntitlements);
  setStatus('waking');
  setPauseUi('starting');
  els.endBtn.disabled = false;
  setValidation('Camera', options.keepReadings ? 'Reconnecting the measurement engine…' : 'Opening the camera…', 'neutral');

  const token = ++sessionToken;
  cameraSource = 'sdk';
  // Reliable mode (default): the SDK captures the camera itself. Smooth mode:
  // Kin owns the camera and pushes frames (see camera-settings.cjs).
  if (cameraPrefs.cameraMode === 'smooth' && directCameraSupported()) {
    const [width, height] = String(cameraPrefs.resolution || '640x480').split('x').map(Number);
    directCamera.setPixelMode(rgbaRemembered ? 'rgba' : 'nv12');
    layoutWatch = { token, since: null, evidence: false };
    try {
      await directCamera.start({
        width,
        height,
        fps: cameraPrefs.captureFps,
        sessionToken: token,
        showSelfView: cameraPrefs.selfView !== 'off',
      });
      cameraSource = 'direct';
      console.log(`[kin-ui] camera exposure ${JSON.stringify(directCamera.exposure)}`);
    } catch (error) {
      console.warn('[kin] direct camera unavailable, using the SDK camera', error && (error.name || error.message));
      await directCamera.stop();
    }
  }
  // The session may have been paused or ended while the camera opened.
  if (token !== sessionToken || ending) {
    await directCamera.stop();
    return;
  }
  setData(els.stageMirror, 'source', cameraSource);
  enterMirrorMode();

  window.kin.sendSdkCommand({
    type: 'start',
    session: token,
    apiKey,
    requestedMetrics: requestedMetrics(currentEntitlements),
    source: cameraSource,
  });
}

async function fatalStop(copy) {
  stopClock();
  await teardownSdk();
  sdkStatus = 'error';
  setStatus('error');
  setPauseUi('retry');
  els.endBtn.disabled = false;
  engine.setStatus('error');
  setValidation('Camera', 'The camera is off. Try again when you are ready.', 'error');
  showNotice(copy);
  paintUi();
}

async function fallbackMetricSet() {
  if (fallbackAttempts >= 3) {
    await fatalStop('This key does not include a signal Kin can use.');
    return;
  }

  const next = { ...currentEntitlements };
  let message;
  if (next.face) {
    next.face = false;
    faceDropped = true;
    message = 'The expression mirror is not included with this key. Pulse and breath are still live.';
  } else if (next.pulse) {
    next.pulse = false;
    message = 'Pulse is not included with this key. Kin will listen to breath and expression.';
  } else if (next.breath) {
    next.breath = false;
    message = 'Breath is not included with this key.';
  } else {
    await fatalStop('This key does not include a signal Kin can use.');
    return;
  }

  if (!next.pulse && !next.breath) {
    await fatalStop('This key does not include the signals Kin needs.');
    return;
  }

  fallbackAttempts += 1;
  currentEntitlements = next;
  engine.setEntitlements(next);
  stopClock();
  await teardownSdk({ keepFrame: true });
  sdkStatus = 'idle';
  showToast(message, 'warn', 8000);
  setStatus('waking');
  paintUi();
  await delay(450);
  if (ending || !apiKey) return;
  failureHandling = false;
  await startSession();
}

// Keep the session on. On a light laptop the SDK can stop itself when the
// machine briefly cannot keep up (14: frame rate too low), when a stall drops
// its connection (5/6: network/server), or when processing hiccups (0, 8, 9,
// 11). Those are transient: restart the engine quietly, keep the last
// readings on screen, and only show "Try again" if it keeps failing (more
// than 4 restarts within 3 minutes). Key, credit, camera-permission, and
// metric-entitlement errors are never retried.
const AUTO_RECONNECT_CODES = new Set([0, 5, 6, 8, 9, 11, 14]);
const autoReconnectTimes = [];
let autoReconnecting = false;

async function autoReconnect(code, retryable) {
  if (!AUTO_RECONNECT_CODES.has(code) || retryable === false || !apiKey || ending) return false;
  const now = Date.now();
  while (autoReconnectTimes.length && now - autoReconnectTimes[0] > 180000) autoReconnectTimes.shift();
  if (autoReconnectTimes.length >= 4) return false;
  autoReconnectTimes.push(now);
  autoReconnecting = true;
  try {
    console.warn(`[kin] measurement engine stopped (code ${code}); reconnecting automatically`);
    showToast('The measurement engine paused. Reconnecting automatically…', 'ok', 5000);
    const keepClock = sessionActiveStart != null || sessionElapsedMs > 0;
    await teardownSdk({ keepFrame: true });
    sdkStatus = 'idle';
    await delay(1200);
    if (ending || !apiKey) return true;
    await startSession({ keepReadings: true });
    if (!keepClock) stopClock();
    return true;
  } finally {
    autoReconnecting = false;
  }
}

async function handleFailure(code, message, retryable) {
  if (ending) return;
  if (failureHandling) return;
  failureHandling = true;

  try {
    if (code === 13) {
      await fallbackMetricSet();
      return;
    }

    if (await autoReconnect(code, retryable)) return;

    const copy = ERROR_COPY[code] || message || 'Kin stopped unexpectedly.';
    await fatalStop(copy);

    if (code === 2 || code === 4) {
      apiKey = null;
      operatorKey = null;
      sdkStatus = 'idle';
      setStatus('idle');
      setPauseUi('off');
      els.endBtn.disabled = true;
      engine.reset();
      setValidation('Position', 'Waiting for a key.', 'neutral');
      showKeyGate(copy);
      paintUi();
    }
  } finally {
    failureHandling = false;
  }
}

// --------------------------------------------------------------- session UI

function resetSessionState() {
  stopClock();
  sessionElapsedMs = 0;
  sessionActiveStart = null;
  fallbackAttempts = 0;
  faceDropped = false;
  hideNotice();
  engine.reset();
  engine.setEntitlements({ pulse: true, breath: true, face: false });
  setStatus('idle');
  setPauseUi('off');
  els.endBtn.disabled = true;
  setValidation('Position', 'Waiting for the first frame.', 'neutral');
  paintUi();
}

async function pauseSession() {
  if (sdkStatus !== 'running' && sdkStatus !== 'starting') return;
  sdkStatus = 'pausing';
  stopClock();
  setStatus('paused');
  setPauseUi('pausing');
  els.endBtn.disabled = true;
  engine.setStatus('paused');
  setValidation('Paused', 'The camera is off. Resume when you are ready.', 'neutral');
  await teardownSdk();
  sdkStatus = 'paused';
  setPauseUi('resume');
  els.endBtn.disabled = false;
  engine.setStatus('paused');
  paintUi();
}

async function resumeSession() {
  if (sdkStatus !== 'paused' || ending) return;
  sdkStatus = 'idle';
  setStatus('waking');
  engine.setStatus('paused');
  setPauseUi('starting');
  await startSession();
}

async function endSession() {
  if (ending) return;
  ending = true;
  els.confirm.classList.add('hidden');
  stopClock();
  await teardownSdk();
  sdkStatus = 'idle';
  apiKey = null;
  // The operator's key (from .env / kin.key) stays for the next session, so
  // users go straight from consent to the studio. A key the user pasted is
  // still forgotten here.
  els.apiKey.value = '';
  els.keyError.hidden = true;
  sessionToken += 1;

  currentEntitlements = { pulse: true, breath: true, face: false };
  consentedFace = false;
  resetSessionState();
  closeFrame();

  els.consentCamera.checked = false;
  els.consentFace.checked = false;
  els.consentMedical.checked = false;
  els.consentContinue.disabled = true;
  els.consent.classList.remove('hidden');
  els.keygate.classList.add('hidden');
  els.privacy.classList.add('hidden');
  appScreen = 'consent';
  els.app.dataset.screen = 'consent';
  els.consentContinue.focus();
  showToast(operatorKey
    ? 'Session ended. The camera is off and readings are cleared.'
    : 'Session ended. Camera, readings, and the in-memory key are cleared.', 'ok', 7000);
  ending = false;
}

// -------------------------------------------------------------- key gate

function adoptOperatorKey() {
  if (operatorKey) return;
  const value = window.__kinOperatorKey;
  if (typeof value !== 'string' || value.trim().length < 8) return;
  operatorKey = value.trim();
  try {
    delete window.__kinOperatorKey;
  } catch {
    /* the property may be non-configurable */
  }
}

adoptOperatorKey();
window.addEventListener('kin-operator-key', adoptOperatorKey);

function showKeyGate(message) {
  els.keyError.textContent = message || '';
  els.keyError.hidden = !message;
  els.apiKey.value = '';
  els.consent.classList.add('hidden');
  els.keygate.classList.remove('hidden');
  appScreen = 'key';
  els.app.dataset.screen = 'key';
  setTimeout(() => els.apiKey.focus(), 60);
}

function showKeyError(message) {
  els.keyError.textContent = message;
  els.keyError.hidden = false;
}

async function beginWithKey(value) {
  if (!value || value.length < 8) return;

  apiKey = value;
  els.apiKey.value = '';
  els.keyError.hidden = true;
  els.consent.classList.add('hidden');
  els.keygate.classList.add('hidden');
  els.privacy.classList.add('hidden');
  els.confirm.classList.add('hidden');
  appScreen = 'studio';
  els.app.dataset.screen = 'studio';

  currentEntitlements = { pulse: true, breath: true, face: consentedFace };
  fallbackAttempts = 0;
  faceDropped = false;
  sessionElapsedMs = 0;
  sessionActiveStart = null;

  engine.reset();
  engine.setEntitlements(currentEntitlements);
  engine.setStatus('waking');
  paintUi();
  await startSession();
}

async function beginFromKey() {
  const value = els.apiKey.value.trim();
  if (value.length < 8) {
    showKeyError('Paste the key from your Presage developer portal.');
    els.apiKey.focus();
    return;
  }

  await beginWithKey(value);
}

// --------------------------------------------------------------- overlays

function openPrivacy() {
  els.privacy.classList.remove('hidden');
  setTimeout(() => els.privacyClose.focus(), 30);
}

function closePrivacy() {
  els.privacy.classList.add('hidden');
}

function openConfirm() {
  if (statusKind === 'idle') return;
  els.confirm.classList.remove('hidden');
  setTimeout(() => els.confirmCancel.focus(), 30);
}

function closeConfirm() {
  els.confirm.classList.add('hidden');
}

function overlayOpen() {
  return !els.privacy.classList.contains('hidden') || !els.confirm.classList.contains('hidden')
    || !els.settings.classList.contains('hidden');
}

function enterPresent() {
  els.app.classList.add('present');
  els.presentExit.hidden = false;
  paintUi();
}

function exitPresent() {
  els.app.classList.remove('present');
  els.presentExit.hidden = true;
}

function togglePresent() {
  if (els.app.classList.contains('present')) exitPresent();
  else enterPresent();
}

// ---------------------------------------------------------------- events

els.consentCamera.addEventListener('change', updateConsentGate);
els.consentMedical.addEventListener('change', updateConsentGate);

function updateConsentGate() {
  els.consentContinue.disabled = !(els.consentCamera.checked && els.consentMedical.checked);
}

els.consentContinue.addEventListener('click', () => {
  if (els.consentContinue.disabled) return;
  consentedFace = els.consentFace.checked;
  if (operatorKey) {
    beginWithKey(operatorKey);
  } else {
    showKeyGate('');
  }
});

els.keyReveal.addEventListener('click', () => {
  const showing = els.apiKey.type === 'text';
  els.apiKey.type = showing ? 'password' : 'text';
  els.keyReveal.textContent = showing ? 'Show' : 'Hide';
  els.apiKey.focus();
});

els.keyBack.addEventListener('click', () => {
  els.keygate.classList.add('hidden');
  els.consent.classList.remove('hidden');
  appScreen = 'consent';
  els.app.dataset.screen = 'consent';
});

els.keyContinue.addEventListener('click', beginFromKey);
els.apiKey.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    beginFromKey();
  }
});

els.pauseBtn.addEventListener('click', () => {
  if (statusKind === 'error') {
    retrySession();
    return;
  }
  if (sdkStatus === 'paused') {
    resumeSession();
    return;
  }
  if (sdkStatus === 'running' || sdkStatus === 'starting') {
    pauseSession();
  }
});

function retrySession() {
  if (ending || failureHandling) return;
  if (!apiKey) {
    showKeyGate('Paste your key to begin again.');
    setStatus('idle');
    setPauseUi('off');
    return;
  }
  sdkStatus = 'idle';
  // A manual retry starts with a fresh auto-reconnect budget.
  autoReconnectTimes.length = 0;
  setStatus('waking');
  engine.resetSignals();
  engine.setEntitlements(currentEntitlements);
  setPauseUi('starting');
  paintUi();
  startSession();
}

els.endBtn.addEventListener('click', openConfirm);
els.confirmCancel.addEventListener('click', closeConfirm);
els.confirmEnd.addEventListener('click', endSession);

els.privacyChip.addEventListener('click', openPrivacy);
els.privacyBtn.addEventListener('click', openPrivacy);
els.privacyLink.addEventListener('click', openPrivacy);
els.privacyClose.addEventListener('click', closePrivacy);
els.privacyDone.addEventListener('click', closePrivacy);
els.privacy.addEventListener('click', (event) => {
  if (event.target === els.privacy) closePrivacy();
});
els.confirm.addEventListener('click', (event) => {
  if (event.target === els.confirm) closeConfirm();
});

els.noticeClose.addEventListener('click', hideNotice);

els.presentBtn.addEventListener('click', togglePresent);
els.presentExit.addEventListener('click', exitPresent);
els.frameBtn.addEventListener('click', openFrame);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!els.settings.classList.contains('hidden')) {
      closeSettings();
      return;
    }
    if (!els.privacy.classList.contains('hidden')) {
      closePrivacy();
      return;
    }
    if (!els.confirm.classList.contains('hidden')) {
      closeConfirm();
      return;
    }
    if (els.app.classList.contains('present')) {
      exitPresent();
    }
    return;
  }

  const tag = event.target && event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (overlayOpen() || appScreen === 'consent' || appScreen === 'key') return;

  const key = event.key.toLowerCase();
  if (key === 'p') {
    event.preventDefault();
    togglePresent();
  } else if (key === 'f') {
    event.preventDefault();
    openFrame();
  } else if (key === 's') {
    event.preventDefault();
    openSettings();
  }
});

window.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'kin-stage-ready') return;
  if (frameWindow && event.source && event.source !== frameWindow) return;
  broadcastState();
});

if (typeof BroadcastChannel === 'function') {
  try {
    stageChannel = new BroadcastChannel('kin-stage');
    stageChannel.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'kin-stage-ready') broadcastState();
    });
  } catch {
    stageChannel = null;
  }
}

window.addEventListener('beforeunload', () => {
  if (window.kin && typeof window.kin.sendSdkCommand === 'function') {
    window.kin.sendSdkCommand({ type: 'stop', session: sessionToken + 1 });
  }
  clearPreview();
  closeFrame();
  if (stageChannel) {
    try {
      stageChannel.close();
    } catch {
      /* already closed */
    }
    stageChannel = null;
  }
});

// ------------------------------------------------------- window controls

function updateMaxButton(maximized, fullscreen) {
  const restore = maximized || fullscreen;
  els.winMax.title = fullscreen ? 'Exit fullscreen' : restore ? 'Restore down' : 'Maximize';
  els.winMax.setAttribute('aria-label', els.winMax.title);
  els.winMaxIcon.innerHTML = restore
    ? '<rect x="2.5" y="4" width="5.5" height="5.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4.5 4V2.5h5v5H8" fill="none" stroke="currentColor" stroke-width="1.2"/>'
    : '<rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.2"/>';
}

function windowControl(action) {
  if (window.kin && typeof window.kin.windowControl === 'function') window.kin.windowControl(action);
}

els.winMin.addEventListener('click', () => windowControl('minimize'));
els.winMax.addEventListener('click', () => windowControl('maximize'));
els.winClose.addEventListener('click', () => windowControl('close'));

// -------------------------------------------------------- camera settings

let cameraPrefs = { captureFps: 30, resolution: '640x480', selfView: 'on', cameraMode: 'reliable' };
let settingsState = null;
let lastHealth = null;
let strugglingStreak = 0;
let struggleHintShown = false;

const RESOLUTION_LABELS = { '640x480': 'Standard 640×480', '1280x720': 'HD 1280×720' };

function describeSettings(s) {
  const view = s.selfView === 'off' ? 'self-view off' : 'self-view on';
  const mode = s.cameraMode === 'smooth' ? 'Smooth preview' : 'Reliable';
  return `${mode} · ${s.captureFps} fps · ${RESOLUTION_LABELS[s.resolution] || s.resolution} · ${view}`;
}

function sameSettings(a, b) {
  return a && b && a.captureFps === b.captureFps && a.resolution === b.resolution && a.selfView === b.selfView
    && a.cameraMode === b.cameraMode;
}

function fillList(list, items) {
  list.replaceChildren(...items.map((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
}

function selectSettings(s) {
  for (const name of ['captureFps', 'resolution', 'selfView', 'cameraMode']) {
    for (const input of els.settings.querySelectorAll(`input[name="${name}"]`)) {
      input.checked = String(s[name]) === input.value;
    }
  }
}

function readSelectedSettings() {
  const value = (name) => {
    const input = els.settings.querySelector(`input[name="${name}"]:checked`);
    return input ? input.value : null;
  };
  return {
    captureFps: Number(value('captureFps') || cameraPrefs.captureFps),
    resolution: value('resolution') || cameraPrefs.resolution,
    selfView: value('selfView') || cameraPrefs.selfView,
    cameraMode: value('cameraMode') || cameraPrefs.cameraMode,
  };
}

function renderSettingsState(state) {
  settingsState = state;
  const rec = state.recommendation;
  const current = sameSettings(rec.settings, state.settings);
  setText(els.recommendSummary, `${describeSettings(rec.settings)}${current ? ' — in use' : ''}`);
  els.recommendApply.disabled = current;
  fillList(els.recommendReasons, rec.reasons);
  fillList(els.settingsTips, rec.tips);
}

async function loadCameraSettings() {
  if (!window.kin || typeof window.kin.getCameraSettings !== 'function') return null;
  try {
    const state = await window.kin.getCameraSettings();
    if (state && state.settings) {
      cameraPrefs = state.settings;
      renderSettingsState(state);
    }
    return state;
  } catch (error) {
    console.error('Kin: camera settings unavailable', error);
    return null;
  }
}

async function openSettings() {
  els.settings.classList.remove('hidden');
  setText(els.settingsNote, 'Saved on this device. Only camera preferences are stored — never frames or readings.');
  selectSettings(cameraPrefs);
  renderHealth();
  const state = await loadCameraSettings();
  if (state) selectSettings(state.settings);
  setTimeout(() => els.settingsApply.focus(), 30);
}

function closeSettings() {
  els.settings.classList.add('hidden');
}

function sessionActive() {
  return sdkStatus === 'running' || sdkStatus === 'starting';
}

async function restartForSettings() {
  showToast('Reopening the camera with the new settings. Readings restart in a moment.', 'ok', 6000);
  stopClock();
  await teardownSdk({ keepFrame: true });
  sdkStatus = 'idle';
  strugglingStreak = 0;
  await delay(400);
  if (ending || !apiKey) return;
  await startSession();
}

async function applyCameraSettings(next) {
  if (!window.kin || typeof window.kin.setCameraSettings !== 'function') return;
  els.settingsApply.disabled = true;
  try {
    const state = await window.kin.setCameraSettings(next);
    if (!state) return;
    cameraPrefs = state.settings;
    renderSettingsState(state);
    selectSettings(cameraPrefs);

    // Self-view on/off applies live and changes the studio layout.
    const showSelfView = cameraPrefs.selfView !== 'off';
    directCamera.setSelfView(showSelfView && sessionActive());
    if (!showSelfView && els.app.dataset.mirror === 'on') {
      delete els.app.dataset.mirror;
      clearPreview();
    } else if (showSelfView && sessionActive() && els.app.dataset.mirror !== 'on') {
      enterMirrorMode();
    }

    if (state.restartNeeded && sessionActive()) {
      closeSettings();
      await restartForSettings();
    } else {
      setText(els.settingsNote, state.restartNeeded
        ? 'Saved. The new camera settings apply when the camera next opens.'
        : 'Saved and applied.');
      if (!state.restartNeeded) setTimeout(closeSettings, 700);
    }
  } finally {
    els.settingsApply.disabled = false;
  }
}

function healthTone(h) {
  if (!h) return 'idle';
  // The camera and models take several seconds to settle; judging that
  // start-up window as "falling behind" would be a false alarm.
  if ((h.elapsedSeconds || 0) < 12) return 'warming';
  const req = h.requestedFps || 30;
  const drops = h.dropShare || 0;
  if (h.lagAvg > 250 || h.cameraFps < req * 0.7 || drops > 0.25) return 'bad';
  if (h.lagAvg > 120 || h.cameraFps < req * 0.88 || drops > 0.1) return 'fair';
  return 'good';
}

function renderHealth() {
  const h = lastHealth;
  const live = h && sessionActive();
  const tone = live ? healthTone(h) : 'idle';
  setData(els.settingsHealth, 'tone', tone);
  setText(els.healthLabel, !live
    ? 'Live performance appears while Kin listens'
    : tone === 'warming'
      ? 'Camera starting — measuring performance…'
      : tone === 'good'
      ? 'Measurement is keeping up on this device'
      : tone === 'fair'
        ? 'Measurement is keeping up, with small delays'
        : h.source === 'direct'
          ? 'Measurement is falling behind — readings may be slow (your self-view stays live)'
          : 'Falling behind — try the recommended settings');
  setText(els.healthCamera, live ? `${h.cameraFps.toFixed(0)} / ${h.requestedFps} fps` : '—');
  let selfView = '—';
  if (live) {
    if (cameraPrefs.selfView === 'off') selfView = 'off';
    else if (h.source === 'direct') {
      const rate = directCamera.cameraFrameRate();
      selfView = rate ? `live · ${Math.round(rate)} fps` : 'live';
    } else selfView = `${h.previewFps.toFixed(0)} fps`;
  }
  setText(els.healthPreview, selfView);
  setText(els.healthLag, live ? `${Math.round(h.lagAvg)} ms` : '—');
}

function applyHealth(event) {
  lastHealth = event;
  // In direct mode no preview packets arrive; frames reaching the SDK are
  // the proof that capture is live (same role as markRunningFromFrame).
  if (event.cameraFps > 0) markRunningFromFrame();
  renderHealth();
  // Three bad readings in a row (~6 s): suggest settings once per app run.
  strugglingStreak = healthTone(event) === 'bad' ? strugglingStreak + 1 : 0;
  if (strugglingStreak >= 3 && !struggleHintShown) {
    struggleHintShown = true;
    showToast(event.source === 'direct'
      ? 'Readings are falling behind on this device. Open camera settings (S) for a lighter recommendation.'
      : 'The camera is falling behind on this device. Open camera settings (S) for a lighter recommendation.', 'warn', 9000);
  }
}

els.settingsBtn.addEventListener('click', openSettings);
els.settingsClose.addEventListener('click', closeSettings);
els.settingsCancel.addEventListener('click', closeSettings);
els.settings.addEventListener('click', (event) => {
  if (event.target === els.settings) closeSettings();
});
els.settingsApply.addEventListener('click', () => applyCameraSettings(readSelectedSettings()));
els.recommendApply.addEventListener('click', () => {
  if (!settingsState) return;
  selectSettings(settingsState.recommendation.settings);
  applyCameraSettings(settingsState.recommendation.settings);
});

loadCameraSettings();

// ------------------------------------------------------------------- loop

function loop(now) {
  checkFrameLayout(now);
  // The native SDK owns the camera and the frame budget. The studio only
  // paints the preview frames it receives and the light signal UI, while the
  // portrait window renders the same state in its own renderer process.
  // Advance the signal engine on every run (real elapsed time), and repaint
  // the portrait at ~5 Hz. The studio portrait is hidden only when the
  // companion window shows it AND the self-view takes its place; then it gets
  // an empty state so its pulse timer stops instead of running unseen.
  const dt = Math.min(0.3, Math.max(0.001, (now - lastFrameAt) / 1000));
  lastFrameAt = now;
  engine.tick(dt, now);
  if (now - lastPortraitPaint >= 190) {
    const hidden = frameWindow && !frameWindow.closed && els.app.dataset.mirror === 'on';
    portrait.render(hidden ? {} : engine.getRenderState());
    lastPortraitPaint = now;
  }

  if (now - lastUiPaint > 180) {
    paintUi(now);
    lastUiPaint = now;
  }

  if (frameWindow && !frameWindow.closed && now - lastBroadcast > 100) {
    broadcastState(now);
    lastBroadcast = now;
  } else if (frameWindow && frameWindow.closed) {
    // The window was closed by the user: bring the studio portrait back.
    frameWindow = null;
    delete els.app.dataset.companion;
  }
}

// A 100 ms timer, not requestAnimationFrame: every task above is gated at
// 100-250 ms anyway, and a perpetual rAF loop keeps Chromium's whole frame
// pipeline (renderer, browser, GPU process) ticking at 60 Hz. On the two-core
// test laptop with an integrated GPU shared with the SDK's Vulkan inference,
// that idle 60 Hz churn was a large part of the load that made the self-view
// (and even the mouse cursor) lag as a session went on.
const LOOP_INTERVAL_MS = 100;
function startLoop() {
  setInterval(() => loop(performance.now()), LOOP_INTERVAL_MS);
}

// ------------------------------------------------------------------- boot

if (window.kin && typeof window.kin.onSdkEvent === 'function') {
  window.kin.onSdkEvent(handleSdkEvent);
} else {
  console.error('Kin: camera bridge unavailable.');
}

setupPreviewGl();
engine.setEntitlements({ pulse: true, breath: true, face: false });
setStatus('idle');
setPauseUi('off');
setValidation('Position', 'Waiting for the first frame.', 'neutral');
paintUi();
startLoop();
