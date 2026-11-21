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
  expressionValue: $('expression-value'),
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
};

const engine = new SignalEngine();
const portrait = mountPortrait($('portrait'));

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
let lastUiPaint = 0;
let lastPortraitPaint = 0;
let lastBroadcast = 0;
let lastFrameAt = performance.now();

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

function drawSparkline(canvas, values, color) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
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

  els.cardPulse.dataset.state = !enabled ? 'off' : live ? 'live' : 'on';
  els.pulseState.textContent = !enabled
    ? 'Off'
    : paused
      ? 'Paused'
      : errored
        ? 'Stopped'
        : live
          ? 'Live'
          : p.seen
            ? 'Holding'
            : 'Warming';

  els.pulseValue.textContent = enabled && p.rate != null ? String(Math.round(p.rate)) : '—';

  if (!enabled) {
    els.pulseConf.textContent = 'Pulse is off';
  } else if (paused) {
    els.pulseConf.textContent = p.rate != null ? 'Paused · last estimate' : 'Paused';
  } else if (errored) {
    els.pulseConf.textContent = p.rate != null ? 'Stopped · last estimate' : 'No signal';
  } else if (p.rate != null) {
    els.pulseConf.textContent = `${p.stable ? 'Stable' : 'Estimate'} · ${Math.round(p.confidence)}%`;
  } else {
    els.pulseConf.textContent = 'Warming · usually ~12s';
  }

  const width = enabled && p.rate != null ? `${Math.round(clamp(p.confidence, 0, 100))}%` : '0%';
  els.pulseConfBar.style.width = width;
  els.pulseConfBar.style.background = p.stable ? 'var(--sage)' : 'var(--clay)';

  drawSparkline(els.pulseSpark, enabled ? ui.pulseHistory : [], '#bf6a45');
}

function paintBreath(ui, paused, errored) {
  const b = ui.breath;
  const enabled = b.enabled && statusKind !== 'idle';
  const live = enabled && b.live && !paused && !errored;

  els.cardBreath.dataset.state = !enabled ? 'off' : live ? 'live' : 'on';
  els.breathState.textContent = !enabled
    ? 'Off'
    : paused
      ? 'Paused'
      : errored
        ? 'Stopped'
        : live
          ? 'Live'
          : b.seen
            ? 'Holding'
            : 'Warming';

  els.breathValue.textContent = enabled && b.rate != null ? String(Math.round(b.rate)) : '—';

  if (!enabled) {
    els.breathConf.textContent = 'Breathing is off';
  } else if (paused) {
    els.breathConf.textContent = b.rate != null ? 'Paused · last estimate' : 'Paused';
  } else if (errored) {
    els.breathConf.textContent = b.rate != null ? 'Stopped · last estimate' : 'No signal';
  } else if (b.rate != null) {
    els.breathConf.textContent = `${b.stable ? 'Stable' : 'Estimate'} · ${Math.round(b.confidence)}%`;
  } else {
    els.breathConf.textContent = 'Warming · usually ~30s';
  }

  const width = enabled && b.rate != null ? `${Math.round(clamp(b.confidence, 0, 100))}%` : '0%';
  els.breathConfBar.style.width = width;
  els.breathConfBar.style.background = b.stable ? 'var(--sage)' : 'var(--clay)';

  drawSparkline(els.breathSpark, enabled ? ui.breathHistory : [], '#7e8c6a');
}

function paintExpression(ui, paused, errored) {
  const f = ui.face;
  const enabled = f.enabled && statusKind !== 'idle';

  els.cardExpression.dataset.state = !enabled ? 'off' : f.seen ? 'live' : 'on';
  els.expressionState.textContent = !enabled
    ? 'Off'
    : paused
      ? 'Paused'
      : errored
        ? 'Stopped'
        : f.seen
          ? 'Mirroring'
          : 'Watching';

  els.expressionValue.textContent = !enabled ? '—' : f.seen ? f.label : '—';

  if (!enabled) {
    els.expressionConf.textContent = consentedFace
      ? 'Visible expression isn’t on this key'
      : 'Expression mirror is off';
  } else if (paused) {
    els.expressionConf.textContent = 'Paused';
  } else if (errored) {
    els.expressionConf.textContent = 'Stopped';
  } else if (!f.seen) {
    els.expressionConf.textContent = 'Watching for a face';
  } else {
    els.expressionConf.textContent = `${Math.round(f.confidence)}% confident · visible shape only`;
  }

  const width = enabled && f.seen ? `${Math.round(clamp(f.confidence, 0, 100))}%` : '0%';
  els.expressionConfBar.style.width = width;
  els.expressionConfBar.style.background = f.confidence >= 40 ? 'var(--sage)' : 'var(--clay)';

  const scores = new Map();
  if (enabled && Array.isArray(f.scores)) {
    for (const score of f.scores) scores.set(score.type, score.confidence);
  }
  for (const bar of expressionBarEls) {
    const type = Number(bar.dataset.type);
    const score = scores.get(type) || 0;
    bar.style.height = `${2 + clamp(score, 0, 100) / 100 * 20}px`;
    bar.classList.toggle('active', enabled && type === f.type && f.confidence >= 18);
  }
}

function paintPresent(ui) {
  els.presentPulse.textContent = ui.pulse.enabled && ui.pulse.rate != null ? String(Math.round(ui.pulse.rate)) : '—';
  els.presentBreath.textContent = ui.breath.enabled && ui.breath.rate != null ? String(Math.round(ui.breath.rate)) : '—';
  els.presentExpression.textContent = ui.face.enabled && ui.face.seen ? ui.face.label : '—';
}

function paintUi(now = performance.now()) {
  const ui = engine.getUiState();
  const paused = statusKind === 'paused';
  const errored = statusKind === 'error';

  paintPulse(ui, paused, errored);
  paintBreath(ui, paused, errored);
  paintExpression(ui, paused, errored);
  paintPresent(ui);

  els.stageTime.textContent = formatTime(elapsedMs(now));
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
  if (stageChannel) {
    try {
      stageChannel.postMessage(payload);
    } catch {
      /* channel closed during teardown */
    }
  }
}

function openFrame() {
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

  try {
    frameWindow.addEventListener('beforeunload', () => {
      frameWindow = null;
      delete els.app.dataset.companion;
    });
  } catch {
    /* cross-window listener is best-effort */
  }

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

// ------------------------------------------------------------- SDK lifecycle

function requestedMetrics(entitlements) {
  const codes = [];
  if (entitlements.breath) codes.push(0, 2); // chest trace, breathing rate
  if (entitlements.pulse) codes.push(15, 16); // pulse rate, arterial pressure trace
  if (entitlements.face) codes.push(12, 13, 14); // blinking, talking, expressions
  return codes;
}

const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 480;
let previewGl = null;
let previewGlTexture = null;
let previewGlWidth = 0;
let previewGlHeight = 0;
let previewContext = null;
let previewImageData = null;
let pendingPreview = null;
let previewRaf = 0;

// 2D putImageData is a CPU raster upload. On the test laptop it competes
// directly with the SmartSpectra measurement thread, which is what produced the
// late, choppy self-view in earlier preview paths. Use WebGL for the normal
// RGBA frame: the texture upload is done by the GPU process and the studio
// thread only issues a draw. A 2D path remains as a fallback without WebGL.
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
  try {
    gl = canvas.getContext('webgl', attributes);
  } catch {
    gl = null;
  }
  if (!gl) return false;

  const vertexSource = 'attribute vec2 a_pos; varying vec2 v_uv; void main() { v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5); gl_Position = vec4(a_pos, 0.0, 1.0); }';
  const fragmentSource = 'precision mediump float; varying vec2 v_uv; uniform sampler2D u_frame; void main() { gl_FragColor = texture2D(u_frame, v_uv); }';
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
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.uniform1i(gl.getUniformLocation(program, 'u_frame'), 0);
    gl.viewport(0, 0, canvas.width, canvas.height);
    previewGl = gl;
    return true;
  } catch (error) {
    console.error('Kin: WebGL preview unavailable', error);
    previewGl = null;
    return false;
  }
}

function paintPreviewGl(bytes, width, height) {
  const gl = previewGl;
  if (!gl) return false;
  const canvas = els.stagePreview;
  if (!canvas) return false;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, previewGlTexture);
  if (previewGlWidth !== width || previewGlHeight !== height) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    previewGlWidth = width;
    previewGlHeight = height;
  } else {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return true;
}

function clearPreview() {
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
  pendingPreview = event;
  if (!previewRaf) previewRaf = requestAnimationFrame(paintQueuedPreview);
}

function paintQueuedPreview() {
  previewRaf = 0;
  const event = pendingPreview;
  pendingPreview = null;
  if (event && els.app.dataset.mirror === 'on') paintPreview(event);
}

function paintPreview(event) {
  const canvas = els.stagePreview;
  if (!canvas || !event.width || !event.height) return;
  const bytes = event.buffer instanceof Uint8Array ? event.buffer : new Uint8Array(event.buffer);
  const { width, height, stride, pixelFormat } = event;
  if (!bytes || !bytes.length) return;

  // The main process sends ready-to-display RGBA at the native 4:3 size.
  if (pixelFormat === 2 && stride === width * 4 && bytes.length >= width * height * 4) {
    if (!previewGl) setupPreviewGl();
    if (previewGl && paintPreviewGl(bytes, width, height)) return;
  }

  if (!previewContext) {
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    previewContext = canvas.getContext('2d', { alpha: false, desynchronized: true });
  }
  if (!previewContext) return;
  if (!previewImageData) previewImageData = previewContext.createImageData(PREVIEW_WIDTH, PREVIEW_HEIGHT);
  const rgba = previewImageData.data;
  const channels = pixelFormat === 2 || pixelFormat === 3 ? 4 : (pixelFormat === 0 || pixelFormat === 1 ? 3 : 0);
  if (!channels) return;

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
  const swap = pixelFormat === 1 || pixelFormat === 3;
  for (let y = 0; y < PREVIEW_HEIGHT; y += 1) {
    const sourceY = cropY + Math.min(cropHeight - 1, Math.floor((y * cropHeight) / PREVIEW_HEIGHT));
    const srcRow = sourceY * stride;
    const dstRow = y * PREVIEW_WIDTH * 4;
    for (let x = 0; x < PREVIEW_WIDTH; x += 1) {
      const src = srcRow + sourceX[x] * channels;
      const dst = dstRow + x * 4;
      rgba[dst] = bytes[src + (swap ? 2 : 0)];
      rgba[dst + 1] = bytes[src + 1];
      rgba[dst + 2] = bytes[src + (swap ? 0 : 2)];
      rgba[dst + 3] = 255;
    }
  }
  previewContext.putImageData(previewImageData, 0, 0);
}

function enterMirrorMode() {
  // The studio portrait uses compositor-driven CSS for pulse and breath, so
  // it can stay beside the self-view without the extra renderer window. The
  // full companion remains available on demand from the header or F.
  els.app.dataset.mirror = 'on';
  // Keep the studio focused; the portrait window is a companion, not a
  // second thing to manage. It opens to the right of the studio when there is room.
  setTimeout(() => {
    try {
      window.focus();
    } catch {
      /* the window manager may refuse focus */
    }
  }, 220);
}

function exitMirrorMode() {
  delete els.app.dataset.mirror;
  clearPreview();
  closeFrame();
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
    applyValidation(event.code, event.hint);
    return;
  }

  if (event.type === 'preview') {
    markRunningFromFrame();
    if (els.app.dataset.mirror === 'on') queuePreview(event);
    return;
  }

  if (event.type === 'metrics') {
    markRunningFromFrame();
    try {
      const bytes = event.buffer instanceof Uint8Array ? event.buffer : new Uint8Array(event.buffer);
      const metrics = decodeMetrics(bytes);
      engine.ingest(metrics, performance.now());
    } catch (error) {
      console.error('Kin: could not decode a metrics packet.', error);
    }
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
  clearPreview();
  if (!options.keepFrame) exitMirrorMode();
}

async function startSession() {
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
  engine.resetSignals();
  engine.setEntitlements(currentEntitlements);
  setStatus('waking');
  setPauseUi('starting');
  els.endBtn.disabled = false;
  setValidation('Camera', 'Opening the camera…', 'neutral');
  enterMirrorMode();

  const token = ++sessionToken;
  window.kin.sendSdkCommand({
    type: 'start',
    session: token,
    apiKey,
    requestedMetrics: requestedMetrics(currentEntitlements),
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
  if (ending) return;
  failureHandling = false;
  await startSession();
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
  operatorKey = null;
  try {
    delete window.__kinOperatorKey;
  } catch {
    /* the property may be non-configurable */
  }
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
  showToast('Session ended. Camera, readings, and the in-memory key are cleared.', 'ok', 7000);
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
  return !els.privacy.classList.contains('hidden') || !els.confirm.classList.contains('hidden');
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
  if (stageChannel) {
    try {
      stageChannel.close();
    } catch {
      /* already closed */
    }
    stageChannel = null;
  }
});

// ------------------------------------------------------------------- loop

function loop(now) {
  // The native SDK owns the camera and the frame budget. The studio only
  // paints the preview frames it receives and the light signal UI, while the
  // portrait window renders the same state in its own renderer process.
  if (now - lastPortraitPaint >= 250) {
    const dt = Math.min(0.3, Math.max(0.001, (now - lastFrameAt) / 1000));
    lastFrameAt = now;
    engine.tick(dt, now);
    // The studio portrait is the living portrait when the optional companion
    // window is closed. Keep it animating in place; the guest frame window
    // renders its own copy when it is open.
    if (!frameWindow || frameWindow.closed) portrait.render(engine.getRenderState());
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
    frameWindow = null;
  }

  requestAnimationFrame(loop);
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
requestAnimationFrame(loop);
