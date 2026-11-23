'use strict';

// Camera settings for the main process: the few knobs that decide how much
// work Kin asks of the machine, a device profile, and a recommendation that
// combines the hardware with how the current or last session actually ran.
//
// Only camera preferences are written to disk (userData/kin-settings.json).
// No frames, readings, keys, or session data ever go in this file.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const OPTIONS = Object.freeze({
  // Frames per second handed to the measurement engine. The SDK runs face,
  // pose, and pulse models on every one, so this is the biggest load lever.
  // The self-view does not depend on it (it is the live camera stream).
  // The SDK requires at least 25 fps (validation 11: 'Use a camera mode that
  // provides at least 25 frames per second') and ends the session below it
  // (error 14), so 25 is the floor.
  captureFps: [25, 30],
  // 640x480 is the profile the SDK was tuned against in Kin. 1280x720 costs
  // about 3x the pixels and produced multi-second lag on a two-core laptop.
  resolution: ['640x480', '1280x720'],
  // The self-view is a native <video> of the camera stream, always at the
  // camera's full rate. 'off' hides it; measurement keeps running.
  selfView: ['on', 'off'],
  // 'reliable': the SDK captures the camera itself at boosted priority; the
  // self-view is drawn from its frames (~15 fps). Measured on the two-core
  // test laptop: sessions ran 7-8 minutes with steady readings.
  // 'smooth': Kin owns the camera (live <video> self-view at 30 fps) and
  // pushes frames to the SDK. Smoother, but the extra work starved the SDK on
  // that laptop once pulse ran (it skipped >60% of frames, then error 14).
  cameraMode: ['reliable', 'smooth'],
});

const DEFAULTS = Object.freeze({ captureFps: 30, resolution: '640x480', selfView: 'on', cameraMode: 'reliable' });

const MIN_RECOMMENDED_FPS = 25;

function pick(list, value, fallback) {
  const n = typeof list[0] === 'number' ? Number(value) : value;
  return list.includes(n) ? n : fallback;
}

function normalizeSettings(input = {}) {
  return {
    captureFps: pick(OPTIONS.captureFps, input.captureFps, DEFAULTS.captureFps),
    resolution: pick(OPTIONS.resolution, input.resolution, DEFAULTS.resolution),
    selfView: pick(OPTIONS.selfView, input.selfView, DEFAULTS.selfView),
    cameraMode: pick(OPTIONS.cameraMode, input.cameraMode, DEFAULTS.cameraMode),
  };
}

function settingsPath(userData) {
  return path.join(userData, 'kin-settings.json');
}

// Returns null when the user has never saved settings, so first launch can
// start from the device recommendation instead of a fixed default.
function loadSettings(userData) {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(userData), 'utf8'));
    return normalizeSettings(raw);
  } catch {
    return null;
  }
}

function saveSettings(userData, settings) {
  const clean = normalizeSettings(settings);
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(settingsPath(userData), `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.warn('[kin] could not save camera settings', error && error.message);
  }
  return clean;
}

function captureOptions(settings) {
  const [width, height] = settings.resolution.split('x').map(Number);
  return { width, height, fps: settings.captureFps };
}

const GPU_VENDORS = { 0x8086: 'Intel', 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x1022: 'AMD', 0x5143: 'Qualcomm' };

async function deviceProfile(app, powerMonitor) {
  const cpus = os.cpus();
  const model = (cpus[0] && cpus[0].model ? cpus[0].model : 'Unknown CPU').replace(/\s+/g, ' ').trim();
  const threads = cpus.length;
  const memoryGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  let gpu = { vendor: 'Unknown', integrated: true };
  try {
    const info = await app.getGPUInfo('basic');
    const devices = (info && info.gpuDevice) || [];
    const active = devices.find((d) => d.active) || devices[0];
    if (active) {
      const vendor = GPU_VENDORS[active.vendorId] || `0x${Number(active.vendorId).toString(16)}`;
      // Intel and Qualcomm GPUs here are integrated; NVIDIA/AMD with more than
      // one adapter present are treated as discrete.
      const integrated = vendor === 'Intel' || vendor === 'Qualcomm' || devices.length < 2;
      gpu = { vendor, integrated };
    }
  } catch {
    /* GPU info is best-effort */
  }
  let onBattery = false;
  try {
    onBattery = Boolean(powerMonitor && powerMonitor.isOnBatteryPower());
  } catch {
    onBattery = false;
  }
  // Low-power laptop parts: U/Y-series Intel, Celeron/Pentium/Atom, m3.
  const lowPowerCpu = /\b\d{4,5}[UY]\b|\bCeleron\b|\bPentium\b|\bAtom\b|\bCore\(TM\) m3\b|\bi[3579]-\d{4,5}[UY]\b/i.test(model);
  let tier = 'balanced';
  if (threads <= 4 || memoryGb < 8 || (lowPowerCpu && threads <= 8)) tier = 'light';
  else if (threads >= 12 && !gpu.integrated) tier = 'full';
  return { cpu: model, threads, memoryGb, gpu, onBattery, lowPowerCpu, tier };
}

// Every tier starts at 30 fps: it is the rate the SDK reliably produced a
// pulse at. Lighter devices step down only when a session shows they fall
// behind, which now slows readings rather than the self-view.
const TIER_SETTINGS = Object.freeze({
  light: { captureFps: 30, resolution: '640x480', selfView: 'on', cameraMode: 'reliable' },
  balanced: { captureFps: 30, resolution: '640x480', selfView: 'on', cameraMode: 'reliable' },
  full: { captureFps: 30, resolution: '640x480', selfView: 'on', cameraMode: 'smooth' },
});

function stepDown(settings) {
  const next = { ...settings };
  if (next.resolution !== '640x480') {
    next.resolution = '640x480';
    return next;
  }
  const lower = OPTIONS.captureFps.filter((f) => f < next.captureFps && f >= MIN_RECOMMENDED_FPS);
  if (lower.length) next.captureFps = lower[lower.length - 1];
  return next;
}

// observed: summary of the running or last session, or null.
// { seconds, cameraFps, requestedFps, lagAvg, lagHighShare, dropShare, lowFrameRate }
function recommend(profile, observed, current) {
  const reasons = [];
  let settings = { ...TIER_SETTINGS[profile.tier] };
  const gpuText = profile.gpu.integrated ? `${profile.gpu.vendor} integrated graphics` : `${profile.gpu.vendor} graphics`;
  reasons.push(`${profile.cpu} · ${profile.threads} threads · ${profile.memoryGb} GB RAM · ${gpuText}.`);
  if (profile.tier === 'light') {
    reasons.push('This is a light device. Kin uses Reliable camera mode: the measurement engine runs the camera itself, which keeps sessions running here. Smooth preview mode is for faster computers.');
  } else if (profile.tier === 'full') {
    reasons.push('This device has headroom for full-rate measurement.');
  } else {
    reasons.push('Kin can measure at the full 30 fps on this device.');
  }

  if (observed && observed.seconds >= 20) {
    const struggled = observed.lagAvg > 250 || observed.lagHighShare > 0.2
      || (observed.dropShare || 0) > 0.25;
    if (struggled) {
      const base = current ? normalizeSettings(current) : settings;
      const lighter = stepDown(base);
      settings = lighter;
      reasons.push(`Measurement fell behind (average delay ${Math.round(observed.lagAvg)} ms${observed.dropShare ? `, ${Math.round(observed.dropShare * 100)}% of frames skipped` : ''}), so Kin recommends ${lighter.captureFps === base.captureFps && lighter.resolution === base.resolution ? 'keeping this setting and closing other apps' : 'one step lighter'}.`);
    } else if (observed.lowFrameRate && current && current.captureFps < 30) {
      const up = OPTIONS.captureFps.find((f) => f > current.captureFps) || 30;
      settings = { ...normalizeSettings(current), captureFps: up };
      reasons.push(`The SDK reported a frame rate too low to measure well at ${current.captureFps} fps, so Kin recommends ${up} fps.`);
    } else if (current) {
      settings = { ...settings, ...normalizeSettings(current), captureFps: Math.max(normalizeSettings(current).captureFps, MIN_RECOMMENDED_FPS) };
      reasons.push(`Measurement is keeping up (average delay ${Math.round(observed.lagAvg)} ms).`);
    }
  }

  const tips = [];
  if (profile.onBattery) tips.push('Plug in the charger: on battery, Windows slows the CPU and readings fall behind sooner.');
  if (profile.tier === 'light') {
    tips.push('Close other heavy apps (browsers, chat, music) while Kin listens.');
    tips.push('The expression mirror adds face models; leave it off on this device for the quickest readings.');
  }
  tips.push('Light your face softly from the front, not from behind; a window or lamp behind you darkens your face.');
  tips.push('The measurement engine needs at least 25 camera frames per second. In dim light many webcams slow down to 15 fps, so good light also keeps the session running.');
  return { settings, reasons, tips };
}

module.exports = {
  OPTIONS,
  DEFAULTS,
  normalizeSettings,
  loadSettings,
  saveSettings,
  captureOptions,
  deviceProfile,
  recommend,
};
