# Kin

**A living portrait that listens to your pulse and breath.**

Kin is a solo entry for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04). It uses the [SmartSpectra Node SDK](https://github.com/Presage-Security/SmartSpectra) in an Electron main process to turn live camera-derived signals into a quiet, responsive portrait. The studio shows the SDK’s live local self-view; a companion portrait beside it rises with your breathing, a warm light at the sternum follows your pulse, and — only if you opt in — the face mirrors visible expression.

Kin writes no video, audio, images, measurements, session history, or API key to disk. The native SDK may keep a technical device-key/model cache and diagnostic logs under Windows app data; they contain no camera frames, audio, or measured values. The measurement engine runs on your device. Telemetry is off.

> **General wellness and entertainment only.** Kin is not a medical device. It does not diagnose, treat, or predict anything, and it makes no claims about emotion or inner state. Numbers are estimates with confidence values.

---

## The demo

[Demo video](https://youtu.be/VIDEO_ID) · [Release](https://github.com/kceehackathon/Kin-presagesmartspectrasdk/releases/latest) · [Test checklist](TESTING.md) · [Demo script](demo-script.md) · [Recording guide](recording-guide.md)

The video is recorded from a live session with a real person in front of the camera. It is not a synthetic signal.

---

## What it does

1. **Consent first.** Kin asks for camera consent and a separate, off-by-default opt-in for the expression mirror. It explains exactly what stays on the device and what leaves it.
2. **API key, held in memory.** You paste a SmartSpectra key once. Kin uses it for the SDK’s authentication handshake and clears the input. The key is never written to disk or logged.
3. **The portrait wakes.** The native SDK owns the camera and emits processed preview frames to the studio, so you can see yourself while it measures. As measurements arrive, the portrait gains a pulse glow, then breathing motion, then visible expression.
4. **Live signals are shown honestly.** Pulse, breathing rate, confidence, and stability are displayed only when the SDK supplies them. Missing numeric signals stay blank. If the SDK supplies a live pulse rate without the arterial-pressure trace, the portrait paces its glow from that measured rate; it never invents a number, waveform, or confidence.
5. **Pause or end any time.** Pause stops the camera and releases it. End clears the in-memory key and every derived value. The SDK may leave technical files under Windows app data; the paths and deletion steps are in **Storage** below.
6. **Present or frame.** Present mode hides the studio for a clean portrait. The frameless portrait window opens automatically beside the studio and receives only derived animation values, not camera frames. Press `F` to reopen it if you close it.

### Signals requested

| Signal | Metric code | Use |
| --- | --- | --- |
| Chest breathing trace | `0` (`CHEST_BREATHING`) | Moves the bust from the real chest-movement waveform |
| Breathing rate | `2` (`BREATHING_RATE`) | Numeric breath estimate and confidence |
| Pulse rate | `15` (`PULSE_RATE`) | Numeric pulse estimate and confidence |
| Arterial pressure trace | `16` (`ARTERIAL_PRESSURE_TRACE`) | Drives the sternum glow from the real waveform; if unavailable, the measured rate paces the glow |
| Blinking | `12` (`BLINKING`) | Optional expression mirror |
| Talking | `13` (`TALKING`) | Optional mouth movement |
| Expressions | `14` (`EXPRESSIONS`) | Optional visible facial-shape mirror |

Kin deliberately **does not request facial landmarks (`11`)**, HRV (`17`), EDA (`10`), or the unavailable breathing metrics. It does not use LLM Insights.

---

## Setup

### Requirements

- Windows 10 or 11, x64 (tested on Windows 11 Pro)
- Node.js 20 or newer (tested with Node 24.19)
- A webcam
- A SmartSpectra API key from the [Presage developer portal](https://physiology.presagetech.com/auth/register)

The repository includes the Microsoft VC++ runtime DLLs that the native SmartSpectra runtime needs, so a separate Visual C++ Redistributable install is not required.

### Testing for judges

Kin has **no Kin account, login, or cloud service**. It does require a SmartSpectra API key. To test the full app:

1. Create a free Presage developer key at <https://physiology.presagetech.com/auth/register>.
2. Run Kin and paste the key at the key prompt. The key is held in memory for the session and is never written or logged.
3. The demo video is the fastest no-setup verification of the live signal integration.

The public repository and public installers intentionally contain no key; a client-side key would be extractable. For a private keyed demo/judges build, the operator can use the `KIN_API_KEY` environment variable or a local `kin.key` file as described below. If you need a temporary keyed build for judging, contact the author through the DEV submission; do not publish a key in the repository or a release.

### Run from source

```bash
git clone https://github.com/kceehackathon/Kin-presagesmartspectrasdk.git
cd kin
npm install
npm start
```

`npm install` runs `scripts/ensure-electron.cjs` (which retries the Electron runtime download if the first attempt was interrupted) and `scripts/prepare-native.cjs` (which copies the bundled VC++ runtime DLLs beside `smartspectra_capi.dll`). `npm start` bundles the renderer with esbuild and launches Electron.

### Use

1. Read the consent screen. Check **I agree** for camera + pulse + breathing and the general-wellness acknowledgement. The expression mirror is optional and off by default.
2. Paste your SmartSpectra API key. It stays in memory for the session.
3. After the key is accepted, the camera opens. The studio shows a live local self-view on the left; the portrait window opens beside it. Sit about 50–90 cm from the camera with your face, shoulders, and upper chest in frame. Soft, even light in front of you works best; avoid strong backlight.
4. The portrait wakes as signals arrive. Warm-up depends on light, stillness, and the SDK; breathing often appears first, and pulse can take longer. The validation line tells you what to fix.
5. Press `P` for present mode. Press `F` to reopen the portrait window if you close it.
6. Press **Pause** to release the camera, or **End** to clear the session.

### Operator key (demo and judges builds)

The public source asks each operator for a SmartSpectra key. For a demo or judges build, Kin can read a key the operator supplies at run time instead:

- set the `KIN_API_KEY` environment variable, or
- put a one-line `kin.key` file beside the executable (or in the project root during development).

When a key is present, the consent screen still appears and the camera still requires consent, but the key gate is skipped. `kin.key` is gitignored. **Never commit a real key or put one in a public release**: a client-side key can be extracted, and the challenge runs on Presage's free trial. Use a separate trial key for demos and rotate it afterwards. The public repository and its installers contain no key.

**End clears the in-memory copy** and returns to consent. An operator-supplied environment variable or `kin.key` file is outside the app and is not deleted by Kin; remove or rotate it separately.

### Build a Windows installer

```bash
npm run dist
```

Artifacts are written to `release/`: an NSIS installer and a portable executable. The build uses the Electron runtime already installed in `node_modules/electron/dist` and copies the SmartSpectra native runtime to `resources/smartspectra/` outside the asar archive. The app executable is not code-signed; Windows SmartScreen may ask for confirmation.

---

## How the integration works

Kin runs the official native SmartSpectra SDK in the Electron **main** process. The renderer never loads FFI or the camera; it sends a lifecycle command, receives metrics and preview frames, and paints the studio and portrait.

**Main process** (`main.js`):

```js
const {
  SmartSpectraSDK,
  CameraSelection,
  SmartSpectraLogLevel,
} = require('@smartspectra/node-sdk');

const sdk = new SmartSpectraSDK({
  apiKey,
  requestedMetrics: [0, 2, 15, 16],
  enableAccumulatedOutput: false,
  enableTelemetry: false,
  logLevel: SmartSpectraLogLevel.kNone,
});

sdk.on('metrics', (buffer, timestampUs) => {
  studio.webContents.send('kin:sdk-event', { type: 'metrics', buffer });
});

sdk.on('videoOutput', (buffer, width, height, stride, pixelFormat) => {
  // Processed preview frames feed the studio self-view. Throttled to ~15 fps
  // so the camera owner keeps its full measurement frame budget.
  studio.webContents.send('kin:sdk-event', {
    type: 'preview', buffer, width, height, stride, pixelFormat,
  });
});

sdk.useCamera(CameraSelection.default, { width: 640, height: 480, fps: 30 });
await sdk.start();
```

The `videoOutput` path is why the self-view remains visible during measurement without a second camera reader or a renderer-side frame pump. The main process owns the camera and the measurement loop; the preview is a display copy.

**Renderer** (`src/renderer.js` and `src/preload-studio.js`):

```js
window.kin.onSdkEvent((event) => {
  if (event.type === 'metrics') {
    engine.ingest(decodeMetrics(new Uint8Array(event.buffer)), performance.now());
  }
  if (event.type === 'preview') {
    paintPreview(event); // canvas in the studio only
  }
});

window.kin.sendSdkCommand({
  type: 'start',
  session,
  apiKey,
  requestedMetrics: [0, 2, 15, 16],
});
```

The preload exposes only two functions: send a typed lifecycle command and subscribe to typed SDK events. There is no filesystem, shell, or generic IPC surface. The API key crosses the in-process IPC boundary once per start and is held in main memory for the SDK; the input field is cleared immediately.

`metrics` events are windowed slices, not a cumulative stream. `SignalEngine` normalizes the arterial-pressure and chest traces, detects pulse peaks with a refractory window, and maps expression scores to smoothed facial parameters. The portrait renders only what the engine has actually seen:

- **Pulse glow** — the arterial-pressure trace’s normalized peaks set a short envelope. Without the trace, a fresh live pulse rate paces the same envelope; the displayed rate remains the Presage measurement.
- **Breathing** — the chest trace’s deviation from its recent mean moves the bust from its base. No trace, no movement.
- **Expression** — the winning expression score above a small confidence floor morphs brows, eyes, and mouth. Confidence below the floor returns to neutral. Blinks and talking are short-lived overlays.
- **Dust and ambient light** — explicitly decorative, never presented as a measurement.

If the key is not authorized for a signal, Kin removes that bundle and tells you which one, rather than pretending the signal is live. Pulse and breathing are the core; the expression mirror is dropped first.

The companion portrait window (`stage.html`) is a separate renderer. It receives only derived animation values over `BroadcastChannel`; it never receives camera frames, metrics buffers, or the API key. The studio's own portrait is hidden while the self-view is live.

### Project layout

```text
main.js                 Electron windows, permissions, native SDK, preview/metric IPC
index.html              Studio markup and consent/key/privacy dialogs
stage.html              Frameless companion portrait markup
styles.css              Full visual system
src/preload-studio.js  Typed start/stop + SDK-event bridge
src/renderer.js         Consent/key flow, native-event handling, preview canvas, UI, broadcast
src/signals.js          Metric ingestion, waveform normalization, animation targets
src/portrait.js         SVG portrait and render mapping
src/stage.js            Portrait-window receiver and renderer
scripts/ensure-electron.cjs  Retries the Electron runtime install if needed
scripts/prepare-native.cjs   Copies the bundled VC++ runtime beside the SDK
scripts/make-icon.cjs        Generates the app icon without a rasterizer
vendor/vc-runtime/           Microsoft VC++ 14.42 runtime DLLs and provenance
assets/fonts/                Fraunces and Inter (SIL Open Font License)
```

---

## Consent and data handling

Kin is built so the intimate part — your face and body — never leaves the room.

### Storage

**No body data or API key.** Kin writes no video, audio, images, measurements, session history, or API key to disk. The API key is kept in memory, sent once over the in-process IPC bridge, and held by the main process for the SDK; the input field is cleared immediately after use. Ending a session or closing the app clears the in-memory key and all derived values.

The SDK and Chromium do keep some technical files on disk:

- **SmartSpectra device-key/model cache and diagnostics.** The SDK may write a device-key file under `%LOCALAPPDATA%\Presage\Physiology` and a model cache under `%LOCALAPPDATA%\SmartSpectraSDK` or `%APPDATA%\Kin\SmartSpectraSDK`. It may also write technical diagnostic logs under `%LOCALAPPDATA%\Temp\SmartSpectra*.log.*`. These contain no camera frames, audio, or measured values. Kin sets the SDK log level to `kNone`, but SDK-generated logs may still be created; older files may remain.
- **Electron/Chromium app cache.** The `kin` BrowserWindow session uses a non-persistent partition, so it does not keep cookies, `localStorage`, or site data for the session. Chromium may still write ordinary app cache/preferences under `%APPDATA%\Kin` (for example GPU/code cache). Those files contain no camera frames or measured values.

The API key is never part of these files. To remove the technical files on Windows, close Kin and delete `%APPDATA%\Kin`, `%LOCALAPPDATA%\Presage\Physiology`, `%LOCALAPPDATA%\SmartSpectraSDK`, and `%LOCALAPPDATA%\Temp\SmartSpectra*.log.*`.

### Sharing

**None by Kin.** The app makes no analytics, crash-reporting, or cloud-storage calls. The renderer runs under `connect-src 'none'`, so it cannot open a network connection. The native SDK in the main process makes the required Presage requests: authentication, entitlement/usage verification, and encrypted model artifact fetches. These requests can include the API key and session usage metadata (for example duration and frame counts), and can be correlated with your Presage account. They do **not** contain the camera preview frames, video, audio, or your measured pulse/breathing values. SmartSpectra computes the metrics on-device; Kin itself uploads nothing.

### Retention

**No body data.** Session state lives in memory and disappears when the app closes or the session ends. There is no database and no background service. The SDK device-key/model files and Chromium app cache described under **Storage** may persist until you delete them; they contain no camera frames, audio, or measured values.

### Deletion

Close Kin or choose **End session**. The camera is released, the in-memory key is dropped, and every derived value is discarded. Pause releases the camera earlier without ending the session. For the technical SDK/Chromium files, delete the folders listed under **Storage**; no Kin account or cloud copy exists to delete.

### SDK telemetry

**Disabled.** Kin constructs the SDK with `enableTelemetry: false`. No session summaries or device-readiness reports are sent. Presage’s required usage accounting and authentication still run; see **Sharing** above. To verify the opt-out, see `main.js`.

### AI

**None.** Kin does not use LLM Insights and does not send data to any AI service. Expression labels describe visible facial shapes, not feelings.

### Camera and preview

The native SDK owns the camera while the session is active. The studio’s local self-view is a processed preview frame stream from the SDK, shown only in the studio so you can position yourself; **Pause** stops the camera and releases it. The preview is never recorded or uploaded. The companion portrait window receives only derived animation values (`pulse envelope`, `breath phase`, `face parameters`) over `BroadcastChannel`; it never receives camera frames or metric buffers.

### What is not claimed

Kin does not diagnose, treat, monitor, or predict any medical condition. It does not measure emotion, stress, anxiety, fatigue, or truthfulness. Pulse and breathing are general-wellness estimates with confidence values; expression labels are visible-shape descriptions. Do not use Kin for medical decisions.

---

## Limitations

- Measurement quality depends on lighting, camera placement, motion, and skin visibility. The studio shows the SDK’s validation hints (too dark, chest not visible, excessive motion, and so on) instead of hiding them. Front light and a still, front-facing posture matter most for pulse.
- Pulse and breathing have SDK warm-up periods; breathing often appears first, and pulse can take longer. The portrait stays still until real samples arrive. If only the pulse rate is available, the rate paces the glow; no waveform is invented.
- The arterial-pressure trace is uncalibrated and unitless; Kin uses it only as a waveform for animation, never as a blood-pressure reading.
- Presage’s usage-verification check can drop a session if its network request cannot complete. Kin stops, keeps the last values as stopped estimates, and offers **Try Again**; it never continues by inventing values. Keep demo sessions short and check connectivity.
- Windows x64 is the tested target. The SDK also supports macOS and Linux, but Kin’s packaging and camera permission policy are Windows-first for this submission.
- A SmartSpectra key is required; a free Presage trial key is sufficient. Kin has no account system and no bundled key.

---

## Privacy and source verification

The privacy claims are enforceable in the source, not just in copy:

- `index.html` and `stage.html` set `connect-src 'none'`.
- `main.js` uses `partition: 'kin'` (no `persist:`), denies all renderer media permissions (the camera belongs to the native SDK), and allowlists external links.
- `src/preload-studio.js` exposes only typed start/stop and SDK-event functions; there is no generic IPC or filesystem surface.
- `main.js` sets `enableTelemetry: false` and requests no facial landmarks.
- There is no `localStorage`, `sessionStorage`, `indexedDB`, or filesystem write in the renderer.
- There is no app-level screenshot or recording path; the dev-only capture shortcut was removed. The SDK log level is set to `kNone`, but the SDK may still create technical diagnostics; see **Storage**.
- The companion portrait window receives derived values only, over `BroadcastChannel`; the studio’s preview canvas is the only place preview frames are painted.

---

## Third-party notices

Kin’s own code is MIT licensed. SmartSpectra is proprietary software © Presage Technologies, Inc.; it is used under the challenge’s SDK terms. Fraunces and Inter are licensed under the SIL Open Font License. The bundled Microsoft VC++ runtime DLLs are redistributed under Microsoft’s Visual C++ Redistributable terms. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and [`LICENSE`](LICENSE).

---

## Submission

- Challenge: [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04) `#presagechallenge`
- Repository: <https://github.com/kceehackathon/Kin-presagesmartspectrasdk>
- Demo video: <https://youtu.be/VIDEO_ID>
- Windows build: [latest release](https://github.com/kceehackathon/Kin-presagesmartspectrasdk/releases/latest) (installer + portable EXE)
- DEV post: the submission post on DEV, tagged `#presagechallenge` and `#devchallenge`.
- Solo entry. No Kin account/login or team. A SmartSpectra API key is required; see **Testing for judges**.

Built with the SmartSpectra SDK, Electron, and a lot of patience for warm-up timers.
