// Direct camera: the studio owns the camera stream.
//
// Why: the self-view used to be built from the SDK's *processed* frames, so
// on a two-core laptop it could only be as smooth and as current as the
// measurement engine. Once pulse estimation saturated the CPU, the camera
// lagged. Here the self-view is a native <video> of the camera stream
// (decoded and composited by Chromium's media/GPU path, always at the
// camera's full rate), and measurement gets a copy of the frames on the side.
//
// Frames for the SDK are read and copied in a dedicated Worker. Measured on
// the test laptop: reading them on the studio's UI thread lost frames
// whenever that thread stalled for 60-100 ms (the frame reader keeps about
// one frame), and the feed fell 30 -> 20 fps once pulse estimation loaded
// the machine, which ends the SDK session (it needs >= 25 fps). In the worker
// a UI stall only delays frames; they keep their camera timestamps.
//
// Frames are copied in the camera's native NV12 layout (4.6 ms copy, 460 KB),
// decimated to the measurement rate, and forwarded with a bounded number in
// flight to the SDK in the main process.

// PixelFormat values from the SmartSpectra SDK.
const PF_RGBA = 2;
const PF_BGRA = 3;
const PF_NV12 = 4;

// Frames on their way to the SDK. Bounds memory (8 x 460 KB); must not set
// the frame rate (3 slots throttled the feed to 17 fps under load).
const MAX_IN_FLIGHT = 8;

export function directCameraSupported() {
  return typeof MediaStreamTrackProcessor === 'function'
    && Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// Same contract as the SDK's renderer binding (js/renderer/timestamp.js):
// VideoFrame.timestamp is in a media clock, the SDK wants epoch microseconds
// that strictly increase, also across stop/start.
class TimestampAnchor {
  constructor() {
    this.offset = null;
    this.last = 0;
  }

  next(rawUs) {
    const raw = Number(rawUs) || 0;
    if (this.offset === null) this.offset = Date.now() * 1000 - raw;
    let ts = Math.round(raw + this.offset);
    if (ts <= this.last) ts = this.last + 1;
    this.last = ts;
    return ts;
  }
}

// Webcams in auto-exposure often use "exposure priority": with a face in view
// they lengthen each exposure to brighten the image and drop the frame rate
// to make room. Measured on the test laptop: 30 -> 25.7 -> 22.7 -> 16.4 fps
// within ~25 s of sitting down. Fix: manual exposure capped at the longest
// time that still fits the frame interval (~31 ms at 30 fps), i.e. as bright
// as the camera can be without slowing down. Chromium reports exposureTime
// in 100 us units on Windows.
async function capExposureForFrameRate(track, fps) {
  const caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() || {} : {};
  const modes = Array.isArray(caps.exposureMode) ? caps.exposureMode : [];
  const range = caps.exposureTime;
  if (!modes.includes('manual') || !range || !Number.isFinite(range.max)) {
    return { applied: false, reason: 'manual exposure not supported' };
  }
  const step = range.step || 1;
  const budget = (1e4 / fps) * 0.94; // 100 us units; 94% of the frame interval
  let time = Math.floor(budget / step) * step;
  time = Math.max(range.min || step, Math.min(range.max, time));
  try {
    await track.applyConstraints({ advanced: [{ exposureMode: 'manual', exposureTime: time }] });
    const s = track.getSettings ? track.getSettings() : {};
    return { applied: true, exposureTime: s.exposureTime, mode: s.exposureMode, frameRate: s.frameRate };
  } catch (error) {
    return { applied: false, reason: error && (error.name || error.message) };
  }
}

// ---------------------------------------------------------------- worker
//
// Shared by the Worker (as source text) and the fallback main-thread pump.
// `emit(packed, raw)` receives { buf: ArrayBuffer, width, height, stride,
// pixelFormat } and the frame's raw timestamp.
function createFramePump(emit, PF, maxFree) {
  let reader = null;
  let running = false;
  let targetFps = 30;
  // Decimation by credit: each camera frame earns targetFps x (its interval)
  // credit; a frame is sent when credit reaches 1. Keeps the true average
  // rate and tolerates camera jitter.
  let credit = 1;
  let prevRaw = null;
  let copying = false;
  let mode = 'nv12';
  const free = [];
  let i420 = null;
  const stats = { read: 0, sent: 0, skipped: 0, busySkips: 0, format: '' };

  function take(size) {
    for (let i = 0; i < free.length; i += 1) {
      if (free[i].byteLength === size) return free.splice(i, 1)[0];
    }
    return new ArrayBuffer(size);
  }

  async function pack(frame) {
    const rect = frame.visibleRect;
    const width = rect ? rect.width : frame.codedWidth;
    const height = rect ? rect.height : frame.codedHeight;
    const format = frame.format || '';
    stats.format = format || 'gpu';
    const even = width % 2 === 0 && height % 2 === 0;

    if (mode !== 'rgba' && format === 'NV12' && even) {
      const ySize = width * height;
      const buf = take(ySize + ySize / 2);
      await frame.copyTo(new Uint8Array(buf), { layout: [{ offset: 0, stride: width }, { offset: ySize, stride: width }] });
      return { buf, width, height, stride: width, pixelFormat: PF.NV12 };
    }
    if (mode !== 'rgba' && format === 'I420' && even) {
      // Copy the three planes tight, then interleave U and V into NV12.
      const ySize = width * height;
      const cSize = ySize / 4;
      if (!i420 || i420.byteLength !== ySize + 2 * cSize) i420 = new Uint8Array(ySize + 2 * cSize);
      await frame.copyTo(i420, {
        layout: [
          { offset: 0, stride: width },
          { offset: ySize, stride: width / 2 },
          { offset: ySize + cSize, stride: width / 2 },
        ],
      });
      const buf = take(ySize + ySize / 2);
      const out = new Uint8Array(buf);
      out.set(i420.subarray(0, ySize), 0);
      for (let i = 0, o = ySize; i < cSize; i += 1, o += 2) {
        out[o] = i420[ySize + i];
        out[o + 1] = i420[ySize + cSize + i];
      }
      return { buf, width, height, stride: width, pixelFormat: PF.NV12 };
    }
    if (format === 'BGRA' || format === 'BGRX') {
      const buf = take(width * height * 4);
      await frame.copyTo(new Uint8Array(buf), { layout: [{ offset: 0, stride: width * 4 }] });
      return { buf, width, height, stride: width * 4, pixelFormat: PF.BGRA };
    }
    // RGBA (requested, native, or anything else): Chromium converts on copy.
    const buf = take(width * height * 4);
    const options = { layout: [{ offset: 0, stride: width * 4 }] };
    if (format !== 'RGBA' && format !== 'RGBX') options.format = 'RGBA';
    await frame.copyTo(new Uint8Array(buf), options);
    return { buf, width, height, stride: width * 4, pixelFormat: PF.RGBA };
  }

  async function handle(frame) {
    try {
      const raw = frame.timestamp;
      stats.read += 1;
      // A timestamp jump (backwards, or a long gap) restarts the cadence.
      const dtUs = prevRaw === null ? 1e6 / 30 : raw - prevRaw;
      prevRaw = raw;
      if (dtUs <= 0 || dtUs > 500000) credit = 1;
      else credit = Math.min(2, credit + (targetFps * dtUs) / 1e6);
      if (credit < 0.999 || copying) {
        stats.skipped += 1;
        if (credit >= 0.999) stats.busySkips += 1;
        return;
      }
      credit -= 1;
      copying = true;
      let packed;
      try {
        packed = await pack(frame);
      } finally {
        copying = false;
      }
      stats.sent += 1;
      emit(packed, raw);
    } catch (error) {
      stats.skipped += 1;
    } finally {
      frame.close();
    }
  }

  async function loop() {
    while (running && reader) {
      let result;
      try {
        result = await reader.read();
      } catch {
        break;
      }
      if (result.done || !result.value) break;
      if (!running) {
        result.value.close();
        break;
      }
      // Not awaited: reading must never wait on a copy.
      handle(result.value);
    }
  }

  return {
    stats,
    start(readable, fps, pixelMode) {
      reader = readable.getReader();
      targetFps = Math.max(1, fps || 30);
      mode = pixelMode === 'rgba' ? 'rgba' : 'nv12';
      credit = 1;
      prevRaw = null;
      copying = false;
      stats.read = 0;
      stats.sent = 0;
      stats.skipped = 0;
      stats.busySkips = 0;
      running = true;
      loop();
    },
    setMode(pixelMode) {
      mode = pixelMode === 'rgba' ? 'rgba' : 'nv12';
    },
    recycle(buf) {
      if (buf && free.length < maxFree) free.push(buf);
    },
    stop() {
      running = false;
      if (reader) reader.cancel().catch(() => {});
      reader = null;
    },
  };
}

// The worker runs createFramePump from its own source text, so the frame
// logic exists exactly once.
function workerSource() {
  return `'use strict';
const PF = { RGBA: ${PF_RGBA}, BGRA: ${PF_BGRA}, NV12: ${PF_NV12} };
// Bound to a fixed name: a bundler may rename the function itself.
const makePump = (${createFramePump.toString()});
const pump = makePump((packed, raw) => {
  postMessage({ type: 'frame', raw, width: packed.width, height: packed.height,
    stride: packed.stride, pixelFormat: packed.pixelFormat, buf: packed.buf }, [packed.buf]);
}, PF, ${MAX_IN_FLIGHT + 2});
setInterval(() => postMessage({ type: 'stats', stats: pump.stats }), 1000);
onmessage = (event) => {
  const m = event.data || {};
  if (m.type === 'start') pump.start(m.readable, m.fps, m.mode);
  else if (m.type === 'mode') pump.setMode(m.mode);
  else if (m.type === 'recycle') pump.recycle(m.buf);
  else if (m.type === 'stop') pump.stop();
};`;
}

export function createDirectCamera({ video, sendFrame, onEnded }) {
  let exposure = null;
  const anchor = new TimestampAnchor();
  let stream = null;
  let track = null; // clone fed to the frame processor
  let running = false;
  let session = 0;
  let pixelMode = 'nv12';
  let inFlight = 0;
  let lastSendAt = 0;
  let worker = null;
  let localPump = null; // fallback when a Worker cannot take the stream
  let accepting = false; // SDK armed for this session (main says 'accepting')
  const stats = { read: 0, sent: 0, skipped: 0, busySkips: 0, format: '', thread: '' };

  // Forward one packed frame to the SDK. sendFrame serializes the bytes
  // synchronously, so the buffer can be handed back for reuse right after.
  function forward(packed, raw, recycle) {
    // Until the SDK is armed, frames are only shown, not forwarded: the SDK
    // rejects a stream whose first frame predates its multi-second start-up.
    if (!accepting) {
      recycle(packed.buf);
      return;
    }
    // Watchdog: a reply that never comes must not block forwarding.
    if (inFlight > 0 && performance.now() - lastSendAt > 1500) inFlight = 0;
    if (!running || inFlight >= MAX_IN_FLIGHT) {
      stats.busySkips += 1;
      recycle(packed.buf);
      return;
    }
    inFlight += 1;
    lastSendAt = performance.now();
    sendFrame({
      session,
      buffer: new Uint8Array(packed.buf),
      width: packed.width,
      height: packed.height,
      stride: packed.stride,
      pixelFormat: packed.pixelFormat,
      timestampUs: anchor.next(raw),
    }).catch(() => false).finally(() => { inFlight = Math.max(0, inFlight - 1); });
    recycle(packed.buf);
  }

  function ensureWorker() {
    if (worker) return worker;
    if (typeof Worker !== 'function' || typeof Blob !== 'function') return null;
    try {
      const url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
      worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = (event) => {
        const m = event.data || {};
        if (m.type === 'frame') {
          forward(m, m.raw, (buf) => worker && worker.postMessage({ type: 'recycle', buf }, [buf]));
        } else if (m.type === 'stats' && m.stats) {
          stats.read = m.stats.read;
          stats.sent = m.stats.sent;
          stats.skipped = m.stats.skipped;
          stats.format = m.stats.format;
          // busySkips counts both the worker's (copy still running) and ours.
          stats.workerBusy = m.stats.busySkips;
        }
      };
      worker.onerror = (event) => {
        console.warn('[kin] frame worker error', event && event.message);
      };
      return worker;
    } catch (error) {
      console.warn('[kin] frame worker unavailable', error && error.message);
      worker = null;
      return null;
    }
  }

  async function start({ width, height, fps, sessionToken, showSelfView }) {
    await stop();
    session = sessionToken;
    accepting = false;
    inFlight = 0;
    stats.read = 0;
    stats.sent = 0;
    stats.skipped = 0;
    stats.busySkips = 0;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: width },
        height: { ideal: height },
        // Always ask the camera for 30: the self-view stays smooth and the
        // measurement rate is chosen by decimation.
        frameRate: { ideal: 30 },
      },
    });
    const source = stream.getVideoTracks()[0];
    if (!source) throw new Error('The camera stream has no video track.');
    exposure = await capExposureForFrameRate(source, 30);
    source.addEventListener('ended', () => {
      if (running && typeof onEnded === 'function') onEnded();
    });
    setSelfView(showSelfView);
    track = source.clone();
    // A few frames of slack so a brief stall delays frames instead of
    // dropping them (Chromium's default keeps about one).
    const readable = new MediaStreamTrackProcessor({ track, maxBufferSize: 4 }).readable;
    running = true;

    const w = ensureWorker();
    if (w) {
      try {
        w.postMessage({ type: 'start', readable, fps, mode: pixelMode }, [readable]);
        stats.thread = 'worker';
        return source.getSettings ? source.getSettings() : {};
      } catch (error) {
        console.warn('[kin] could not move the camera stream to the worker', error && error.message);
      }
    }
    // Fallback: same pump on this thread.
    localPump = createFramePump((packed, raw) => forward(packed, raw, (buf) => localPump && localPump.recycle(buf)),
      { RGBA: PF_RGBA, BGRA: PF_BGRA, NV12: PF_NV12 }, MAX_IN_FLIGHT + 2);
    localPump.start(readable, fps, pixelMode);
    stats.thread = 'ui';
    return source.getSettings ? source.getSettings() : {};
  }

  function setSelfView(show) {
    if (!video) return;
    if (show && stream) {
      if (video.srcObject !== stream) video.srcObject = stream;
      video.play().catch(() => {});
    } else {
      video.pause();
      video.srcObject = null;
    }
  }

  async function stop() {
    running = false;
    accepting = false;
    if (worker) worker.postMessage({ type: 'stop' });
    if (localPump) {
      localPump.stop();
      localPump = null;
    }
    if (track) {
      track.stop();
      track = null;
    }
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
      stream = null;
    }
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    inFlight = 0;
  }

  function cameraFrameRate() {
    const source = stream && stream.getVideoTracks()[0];
    const settings = source && source.getSettings ? source.getSettings() : null;
    return settings && settings.frameRate ? settings.frameRate : 0;
  }

  return {
    start,
    stop,
    setSelfView,
    setAccepting(sessionToken) {
      if (sessionToken === session && running) accepting = true;
    },
    setPixelMode(mode) {
      pixelMode = mode === 'rgba' ? 'rgba' : 'nv12';
      if (worker) worker.postMessage({ type: 'mode', mode: pixelMode });
      if (localPump) localPump.setMode(pixelMode);
    },
    get pixelMode() {
      return pixelMode;
    },
    get exposure() {
      return exposure;
    },
    cameraFrameRate,
    get active() {
      return running;
    },
    stats,
  };
}
