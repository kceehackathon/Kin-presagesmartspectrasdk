# Kin

**A living portrait that listens to your pulse and breath.**

Kin is a solo entry for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04). It uses the [SmartSpectra Node SDK](https://github.com/Presage-Security/SmartSpectra) in an Electron main process to turn live camera-derived signals into a quiet, responsive portrait. The studio shows the SDK’s live local self-view with the portrait beside it. The camera view is clean: no face circle, chest circle, guide lines, or labels over the video. Positioning feedback is text in the rail only; the self-view itself carries no overlay. A warm light at the sternum follows your measured pulse, the chest trace shows your breathing, and — only if you opt in — the face mirrors visible expression. A clear validation line in the rail tells you what to fix, and clears once the SDK reports a usable position.

Kin writes no video, audio, images, measurements, session history, or API key to disk. The one file it saves is a small preferences file, `%APPDATA%\Kin\kin-settings.json`, holding only your camera settings. The native SDK may keep a technical device-key/model cache and diagnostic logs under Windows app data; they contain no camera frames, audio, or measured values. The measurement engine runs on your device. Telemetry is off. Kin never opens a microphone.

> **General wellness and entertainment only.** Kin is not a medical device. It does not diagnose, treat, or predict anything, and it makes no claims about emotion or inner state. Numbers are estimates with confidence values.

---

## The demo

Demo video: pending YouTube upload. · [Release](https://github.com/kceehackathon/Kin-presagesmartspectrasdk/releases/latest) · [Test checklist](TESTING.md) · [Demo script](demo-script.md) · [Recording guide](recording-guide.md)

The video is recorded from a live session with a real person in front of the camera. It is not a synthetic signal.

---

## What it does

1. **Consent first.** Kin asks for camera consent and a separate, off-by-default opt-in for the expression mirror. It explains exactly what stays on the device and what leaves it.
2. **API key, held in memory.** When running from source, you paste a SmartSpectra key once. The Windows release build bundles the author's demo key (see Operator key), so the key page is skipped entirely. Either way, Kin uses the key for the SDK’s authentication handshake, clears the input, and does not write the key to disk or logs.
3. **The portrait wakes.** In the default **Reliable** mode the native SDK owns the camera and emits processed preview frames to the studio, so you can see yourself while it measures. The camera runs at 640×480 and 30 fps; the self-view is drawn from the SDK's processed frames at roughly 12–15 fps and uploaded as a WebGL texture so the studio thread spends almost no time painting it. An optional **Smooth preview** mode trades some CPU for a full-rate self-view; see **Camera modes**. As measurements arrive, the portrait gains a pulse glow, the readouts fill in, and — if you opted in — the face mirrors visible expression.
4. **Clean self-view, clear text.** The camera view is clean: no face circle, chest circle, guide lines, or labels over the video. The positioning card in the rail says what to fix when the SDK reports a sustained problem. Audio is never captured or uploaded.
5. **Live signals are shown honestly.** Pulse, breathing rate, confidence, and stability are displayed only when the SDK supplies them. Missing numeric signals stay blank. The portrait paces its pulse glow from the measured pulse rate; it never invents a number, waveform, or confidence.
6. **Pause or end any time.** Pause stops the camera and releases it. End clears the in-memory key and every derived value. The SDK may leave technical files under Windows app data; the paths and deletion steps are in **Storage** below.
7. **Maximized, present, or frame.** Kin opens maximized (not fullscreen) with its own always-visible minimize, maximize/restore, and close buttons at the top right; press `F11` to toggle fullscreen. Buttons are large and the Studio rail fills the screen height. Present mode hides the studio rail for a clean portrait. The studio keeps the portrait and self-view together. In windowed mode, the frameless companion portrait is available on demand from the header or `F`; it receives only derived animation values, not camera frames.
8. **Expression emoji.** Only if you opt into the Expression mirror on the consent screen, the Expression card shows an animated 3D emoji that mirrors your visible expression, plus the expression name (Neutral, Angry, Contempt, Disgust, Fear, Happy, Sad, Surprise) with the note "visible expression, not a feeling".
9. **Auto-reconnect.** If the SDK stops for a transient reason (frame rate too low, a network or server hiccup, a processing error), Kin restarts it within about 2 seconds, keeps the last readings on screen, and shows **Reconnecting…**. After more than 4 restarts in 3 minutes it shows the normal **Try again** screen. Key, credit, permission, and entitlement errors are never retried.

### Signals requested

| Signal | Metric code | Use |
| --- | --- | --- |
| Chest breathing trace | `0` (`CHEST_BREATHING`) | Keeps the breathing activity and phase honest; no synthetic motion |
| Breathing rate | `2` (`BREATHING_RATE`) | Numeric breath estimate and confidence |
| Pulse rate | `15` (`PULSE_RATE`) | Numeric pulse estimate and confidence; paces the sternum glow |
| Blinking | `12` (`BLINKING`) | Optional expression mirror |
| Talking | `13` (`TALKING`) | Optional mouth movement |
| Expressions | `14` (`EXPRESSIONS`) | Optional visible facial-shape mirror |

Kin deliberately **does not request the arterial-pressure trace (`16`)**. That metric pulls a separate encrypted `phasic-bp-inference` model in the native SDK; on the test laptop, its load competed with the live camera and made the self-view lag when pulse readings began. The measured pulse rate is enough to pace the portrait glow. Kin also does not request facial landmarks (`11`), HRV (`17`), EDA (`10`), or the unavailable breathing metrics. It does not use LLM Insights.

---

## Setup

### Requirements

- Windows 10 or 11, x64 (tested on Windows 11 Pro)
- Node.js 20 or newer (tested with Node 24.19)
- A webcam
- The Windows release (installer or portable) needs no key. Running from source needs a free SmartSpectra API key from the [Presage developer portal](https://physiology.presagetech.com/auth/register)

The repository includes the Microsoft VC++ runtime DLLs that the native SmartSpectra runtime needs, so a separate Visual C++ Redistributable install is not required.

### Testing for judges

Kin has **no Kin account, login, or cloud service**, and judges do not need their own key.

1. Download `Kin-1.0.0-Setup.exe` (installer) or `Kin-1.0.0-Portable.exe` from the [Releases page](https://github.com/kceehackathon/Kin-presagesmartspectrasdk/releases/latest).
2. Launch it. If Windows SmartScreen warns (the build is unsigned), choose **More info**, then **Run anyway**.
3. Tick the two consent boxes. Kin opens the studio and starts listening; there is no key page and no sign-up.

Tips for a smooth test:

- Plug in the charger and set Windows power mode to **Best performance**.
- Use good front light, and keep your face and upper chest in view.
- Pulse usually appears within about 15–60 seconds; breathing often comes first.
- The expression mirror is optional and heavier; leave it off unless you want to try it.

Running from source instead (below) needs your own free SmartSpectra key, in `.env` or at the key prompt. The demo video is also a quick no-setup check of the live signal integration.

The free Presage trial has a usage allowance. If the demo key runs out of credits or is rejected, Kin shows the key page with a message, and you can paste a free key from <https://physiology.presagetech.com/auth/register>. If the studio says **This API key has no credits left**, the account is out of credits; another key from that same account will not restore them. Kin cannot bypass Presage metering. Request a trial reset through the Presage Discord link in the challenge resources, or use a key from an account that still has credits. Then fully close the app and open it again.

### Run from source

```bash
git clone https://github.com/kceehackathon/Kin-presagesmartspectrasdk.git
cd kin
npm install
npm start
```

`npm install` runs `scripts/ensure-electron.cjs` (which retries the Electron runtime download if the first attempt was interrupted) and `scripts/prepare-native.cjs` (which copies the bundled VC++ runtime DLLs beside `smartspectra_capi.dll`). `npm start` bundles the renderer with esbuild and launches Electron.

### Use

1. Read the consent screen. Check **I agree** for camera + pulse + breathing and the general-wellness acknowledgement. The expression mirror is optional and off by default. Kin opens maximized; press `F11` for fullscreen.
2. The key page is skipped in the release build. From source, paste your SmartSpectra API key (it stays in memory for the session) or set it in `.env`.
3. After consent (and key acceptance, from source), the camera opens. The studio shows the portrait and a live local self-view together. The self-view has no lines, circles, or labels over the video. Sit about 50–90 cm from the camera with your face, shoulders, and upper chest in frame. Soft, even light in front of you works best; avoid strong backlight. If a positioning problem persists, the positioning card in the rail says what to fix.
4. The portrait wakes as signals arrive. Warm-up depends on light, stillness, and the SDK; breathing often appears first, and pulse can take longer. The validation line tells you what to fix.
5. Press `P` for present mode. Press `F11` to toggle fullscreen. In windowed mode only, press `F` to open the separate companion portrait window; in fullscreen, the portrait is already part of the studio. Press `S` (or use the button in the Studio header) for **Camera settings**.
6. Press **Pause** to release the camera, or **End** to clear the session.

### Camera settings

Open **Camera settings** from the Studio header or with `S`:

- **Camera mode:** **Reliable** (default, recommended) or **Smooth preview** (see below).
- **Measurement frame rate:** 25 or 30 fps. The SDK requires at least 25 fps and ends the session below it (error 14), so 30 is the safer choice and 25 is slightly lighter.
- **Resolution:** Standard 640×480 (recommended) or HD 1280×720.
- **Self-view:** On or Off. Off keeps measuring with the portrait only.

The dialog also shows a device recommendation (CPU, threads, RAM, GPU, and a tier), live performance (measuring fps, self-view rate, reading delay), and tips. Only these camera preferences are saved, to `%APPDATA%\Kin\kin-settings.json`; frames, readings, and keys are never saved.

### Camera modes

- **Reliable (default, recommended).** The native SDK in the main process opens and captures the camera itself (640×480 at 30 fps). The self-view is drawn from the SDK's processed frames at about 12–15 fps and uploaded to a WebGL texture. On the 2-core test laptop (i5-7300U, Intel HD 620) this mode ran more than five minutes with a steady pulse, a 30 fps camera, a ~3–4 ms frame delay, and zero engine stops.
- **Smooth preview (optional, for faster computers).** The studio window opens the camera with `getUserMedia` (video only, never audio) and shows it in a native `<video>` self-view at the full camera rate. A Worker copies frames (NV12) in memory and hands them to the SDK in the main process over IPC (`sendFrame`, custom input). Frames are never recorded, written, or uploaded. Exposure is set to manual and capped at about 31 ms so the camera keeps 30 fps. The camera permission is granted only to the studio window and only for video.

### Demo checklist

For a clean live session, especially on a modest laptop:

- Plug in the charger and set Windows power mode to **Best performance**. On battery the CPU is capped and the SDK cannot sustain 30 fps.
- Close Chrome, Discord, and anything else that uses the camera or CPU.
- Light your face evenly from the front; avoid backlight.
- Keep the Expression mirror off unless you need it.
- Leave **Camera mode** on **Reliable**.

### Operator key (demo build)

Kin can use the operator's own SmartSpectra key so users never see the key page. The author's Releases build is a keyed demo build made this way. Put it in a `.env` file in the project root:

```
KIN_API_KEY=your-presage-key
```

(`SMARTSPECTRA_API_KEY` or `PRESAGE_API_KEY` also work; quotes and `# comments` are fine.) Kin looks for the key, in order, in:

- the `KIN_API_KEY` / `SMARTSPECTRA_API_KEY` / `PRESAGE_API_KEY` environment variable;
- a `.env` (or one-line `kin.key`) beside the portable `.exe` or in the install folder;
- the `.env` shipped inside a packaged build (`resources\.env`): when a `.env` exists in the project root, `npm run dist` copies it into the build automatically;
- the project root during development (`npm start`).

When a key is present, the consent screen still appears and the camera still requires consent, but the key page is skipped, for every session in that app run (End keeps the operator key; a key a user pasted is still forgotten). If the operator key is rejected or out of credits, Kin falls back to the key page with a message.

`.env` and `kin.key` are gitignored, so the source repository contains no key. The author's Releases build bundles the author's demo key so judges can try Kin without signing up. Forks and public redistributions should remove `.env` before `npm run dist` to build a keyless installer.

### Build a Windows installer

```bash
npm run dist
```

Artifacts are written to `release/`: an NSIS installer and a portable executable. The build uses the Electron runtime already installed in `node_modules/electron/dist` and copies the SmartSpectra native runtime to `resources/smartspectra/` outside the asar archive. The app executable is not code-signed; Windows SmartScreen may ask for confirmation.

---

## How the integration works

Kin runs the official native SmartSpectra SDK in the Electron **main** process. The renderer never loads FFI. In the default Reliable mode it also never touches the camera: it sends a lifecycle command, receives metrics and preview frames, and paints the studio and portrait. Only in the optional Smooth preview mode does the studio window call `getUserMedia` (video only) and pass frames to the SDK in memory.

**Main process** (`main.js`):

```js
const {
  SmartSpectraSDK,
  CameraSelection,
  SmartSpectraLogLevel,
} = require('@smartspectra/node-sdk');

const sdk = new SmartSpectraSDK({
  apiKey,
  // 0 = chest breathing trace, 2 = breathing rate, 15 = pulse rate.
  // Metric 16 is intentionally absent; it loads a separate native model.
  requestedMetrics: [0, 2, 15],
  enableAccumulatedOutput: false,
  enableTelemetry: false,
  logLevel: SmartSpectraLogLevel.kNone,
});

sdk.on('metrics', (buffer, timestampUs) => {
  studio.webContents.send('kin:sdk-event', { type: 'metrics', buffer });
});

sdk.on('videoOutput', (buffer, width, height, stride, pixelFormat) => {
  // Keep this callback to a reference swap: it blocks the SDK worker thread.
  // Packing and IPC happen afterwards, off the callback.
  const frame = makePreviewFrame(buffer, width, height, stride, pixelFormat);
  studio.webContents.send('kin:sdk-event', {
    type: 'preview', buffer: frame, width: 640, height: 480,
    stride: 640 * 4, pixelFormat: 2,
  });
});

sdk.useCamera(CameraSelection.default, { width: 640, height: 480, fps: 30 });
await sdk.start();
```

In Reliable mode the `videoOutput` path is why the self-view remains visible during measurement without a second camera reader or a renderer-side frame pump. The main process owns the camera and the measurement loop; the preview is a display copy. Kin asks the camera for 640×480 at 30 fps and sends the studio the processed frame at about 12–15 fps. The studio uploads it as a WebGL R8 texture (no CPU colour conversion) and coalesces packets to the newest one, so paint work stays off the CPU and a slow frame is dropped instead of queued. Measurement keeps the full camera rate.

**Performance notes.** SDK callbacks are koffi thread-safe thunks that block the SDK worker thread until the JS callback returns, so the `videoOutput` handler does only a reference swap; packing and IPC happen afterwards. Preview delivery uses back-pressure with one frame in flight. There is no perpetual 60 Hz work: the UI loop is a 100 ms timer, the pulse glow is stepped at about 12 Hz, and there are no infinite CSS animations. Process priorities are raised for measurement. The test laptop must be plugged in with Windows power mode set to **Best performance**; on battery the CPU is capped and the SDK cannot sustain 30 fps. In Smooth preview mode, the exposure cap (about 31 ms) keeps auto-exposure from dropping the camera below 30 fps.

The pulse-start lag had a second cause: metric `16`, the arterial-pressure trace, makes the native SDK load the encrypted `phasic-bp-inference` model. The SDK logs showed that model fetch starting and being cancelled during a live session. Kin now requests pulse rate (`15`) without the trace. The portrait's rate fallback paces the glow from the measured pulse, and no waveform is synthesized.

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
  requestedMetrics: [0, 2, 15],
});
```

The preload exposes a small typed surface: send a typed lifecycle command, subscribe to typed SDK events, read and save the camera settings, and (Smooth preview only) hand frames to the SDK with `sendFrame`. There is no filesystem, shell, or generic IPC surface. The API key crosses the in-process IPC boundary once per start and is held in main memory for the SDK; the input field is cleared immediately.

`metrics` events are windowed slices, not a cumulative stream. `SignalEngine` normalizes the chest trace and maps expression scores to smoothed facial parameters. The pulse path uses the measured rate. The portrait renders only what the engine has actually seen:

- **Pulse glow** — a fresh live pulse rate sets the period of a short envelope. The displayed rate remains the Presage measurement. No waveform is requested or synthesized.
- **Breathing** — the chest trace keeps the breathing activity and phase honest. The studio shows the measured rate and trace; the portrait does not invent a breathing motion when the trace is stale.
- **Expression** — the winning expression score above a small confidence floor morphs brows, eyes, and mouth. Confidence below the floor returns to neutral. Blinks and talking are short-lived overlays.
- **Dust and ambient light** — explicitly decorative, never presented as a measurement.

If the key is not authorized for a signal, Kin removes that bundle and tells you which one, rather than pretending the signal is live. Pulse and breathing are the core; the expression mirror is dropped first.

The companion portrait window (`stage.html`) is a separate renderer. It receives only derived animation values over `BroadcastChannel`; it never receives camera frames, metrics buffers, or the API key. In fullscreen, the studio always keeps the portrait and self-view together and the companion is suppressed. In windowed (including maximized) mode, the companion can be opened on demand; when it is open, the studio's own portrait is hidden. When the display has no room for a companion, the studio shows the portrait and the self-view together and the companion is not opened automatically.

### Project layout

```text
main.js                 Electron windows, permissions, native SDK, preview/metric IPC, auto-reconnect
index.html              Studio markup and consent/key/privacy dialogs
stage.html              Frameless companion portrait markup
styles.css              Full visual system
src/preload-studio.js  Typed start/stop + SDK-event bridge
src/renderer.js         Consent/key flow, native-event handling, preview canvas, UI, broadcast
src/direct-camera.js    Smooth preview mode: video-only getUserMedia self-view and frame hand-off
src/camera-settings.cjs Camera settings defaults, validation, and preferences file
src/signals.js          Metric ingestion, signal normalization, animation targets
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

**No body data or API key.** Kin writes no video, audio, images, measurements, session history, or API key to disk. The single exception is `%APPDATA%\Kin\kin-settings.json`, which holds only your camera preferences (mode, frame rate, resolution, self-view on/off) and never frames, readings, or keys. The API key is kept in memory, sent once over the in-process IPC bridge, and held by the main process for the SDK; the input field is cleared immediately after use. Ending a session or closing the app clears the in-memory key and all derived values.

The SDK and Chromium do keep some technical files on disk:

- **SmartSpectra device-key/model cache and diagnostics.** The SDK may write a device-key file under `%LOCALAPPDATA%\Presage\Physiology` and a model cache under `%LOCALAPPDATA%\SmartSpectraSDK` or `%APPDATA%\Kin\SmartSpectraSDK`. It may also write technical diagnostic logs under `%LOCALAPPDATA%\Temp\SmartSpectra*.log.*`. These contain no camera frames, audio, or measured values. Kin sets the SDK log level to `kNone`, but SDK-generated logs may still be created; older files may remain.
- **Electron/Chromium app cache.** The `kin` BrowserWindow session uses a non-persistent partition, so it does not keep cookies, `localStorage`, or site data for the session. Chromium may still write ordinary app cache/preferences under `%APPDATA%\Kin` (for example GPU/code cache). Those files contain no camera frames or measured values. The preferences file above lives in the same folder.

The API key is never part of these files. To remove the technical files on Windows, close Kin and delete `%APPDATA%\Kin`, `%LOCALAPPDATA%\Presage\Physiology`, `%LOCALAPPDATA%\SmartSpectraSDK`, and `%LOCALAPPDATA%\Temp\SmartSpectra*.log.*`.

### Sharing

**No body data is uploaded.** Kin itself makes no analytics, crash-reporting, or cloud-storage calls. The renderer runs under `connect-src 'none'`, so it cannot open a network connection. The native SDK in the main process makes the required Presage requests: authentication, entitlement/usage verification, and encrypted model artifact fetches. These requests can include the API key and session usage metadata (for example duration and frame counts), and can be correlated with your Presage account. They do **not** contain the camera preview frames, video, audio, or your measured pulse/breathing values. SmartSpectra computes the metrics on-device; Kin itself uploads no frames, audio, or measurements.

### Retention

**No body data.** Session state lives in memory and disappears when the app closes or the session ends. There is no database and no background service. Your camera preferences file and the SDK device-key/model files and Chromium app cache described under **Storage** may persist until you delete them; none contain camera frames, audio, or measured values.

### Deletion

Close Kin or choose **End session**. The camera is released, the in-memory key is dropped, and every derived value is discarded. Pause releases the camera earlier without ending the session. To reset camera settings, delete `%APPDATA%\Kin\kin-settings.json` (deleting `%APPDATA%\Kin` removes it too). For the technical SDK/Chromium files, delete the folders listed under **Storage**; no Kin account or cloud copy exists to delete.

### SDK telemetry

**Disabled.** Kin constructs the SDK with `enableTelemetry: false`. No session summaries or device-readiness reports are sent. Presage’s required usage accounting and authentication still run; see **Sharing** above. To verify the opt-out, see `main.js`.

### AI

**None.** Kin does not use LLM Insights and does not send data to any AI service. Expression labels describe visible facial shapes, not feelings.

### Camera and preview

In the default Reliable mode the native SDK owns the camera while the session is active. Kin requests 640×480 at 30 fps (the camera settings allow 25 or 30 fps and 640×480 or 1280×720). The processed `videoOutput` frame is sent to the studio at about 12–15 fps and uploaded as a WebGL R8 texture on the newest-frame schedule, so paint work stays off the CPU and leaves room for the measurement thread. In the optional Smooth preview mode the studio window opens the camera itself with `getUserMedia` (video only, never audio; the permission is granted only to the studio window), and a Worker passes frames in memory to the SDK over IPC. **Pause** stops the camera and releases it. The preview is never recorded or uploaded. The optional companion portrait window receives only derived animation values (`pulse envelope`, `face parameters`) over `BroadcastChannel`; it never receives camera frames or metric buffers.

These settings follow Presage’s [measurement-quality guidance](https://smartspectra.presagetech.com/docs/measurement-quality): target 30 fps with headroom above 25 fps, keep one centered face and the upper chest visible, use even front light, and keep the camera stationary for breathing and chest waveforms. Low light can cause auto-exposure to lengthen exposure time and reduce frame rate; Kin surfaces that as **Camera running slowly** rather than hiding it.

The self-view is deliberately clean: no face or chest circle, corner brackets, hairlines, or labels over the video. The positioning card in the rail names the current problem, such as **No face yet**, **Chest not in frame**, **Too dark**, or **Camera settling**. Kin never opens a microphone and never records or uploads audio.

For best results, mount the camera on a stand or laptop lid, use even front light, and avoid backlight or a flickering primary light. Breathing measurement needs a stationary camera. Low light can make auto-exposure drop the frame rate, which is why Kin surfaces the SDK’s **Camera running slowly** warning instead of hiding it.

### What is not claimed

Kin does not diagnose, treat, monitor, or predict any medical condition. It does not measure emotion, stress, anxiety, fatigue, or truthfulness. Pulse and breathing are general-wellness estimates with confidence values; expression labels are visible-shape descriptions. Do not use Kin for medical decisions.

---

## Limitations

- Measurement quality depends on lighting, camera placement, motion, and skin visibility. The studio shows the SDK’s validation hints (too dark, chest not visible, excessive motion, and so on) instead of hiding them. Front light and a still, front-facing posture matter most for pulse. Low light can make the camera’s auto-exposure reduce frame rate; close other camera apps and add soft front light if Kin reports **Camera running slowly**.
- In Reliable mode the self-view is drawn from the SDK's processed frames at about 12–15 fps, lower than the 30 fps the camera and measurement run at; use Smooth preview on a faster computer for a full-rate self-view. The renderer coalesces packets to the newest frame and uploads it with WebGL R8 instead of CPU painting. On the 2-core test laptop (i5-7300U, Intel HD 620), Reliable mode ran five-plus minutes with steady pulse, a 30 fps camera, ~3–4 ms frame delay, and zero engine stops. The first seconds can be busier while the SDK models warm up. The portrait’s pulse glow is stepped at about 12 Hz; the detailed SVG face is repainted only when the optional expression mirror is on. Expression classification itself is windowed and may update less often than the video.
- Plug the laptop in and use Windows power mode **Best performance**. On battery the CPU is capped and the SDK cannot sustain 30 fps. If the camera falls below 25 fps the SDK ends the session (error 14); Kin auto-reconnects a few times before showing **Try again**.
- Pulse and breathing have SDK warm-up periods; breathing often appears first, and pulse can take longer. The portrait stays still until real samples arrive. If only the pulse rate is available, the rate paces the glow; no waveform is invented.
- Positioning guidance is text only, in the rail. It stays visible for as long as the SDK reports a problem and clears when the pose is usable. Nothing is drawn over the self-view.
- Kin does not request the arterial-pressure trace (`16`). It is uncalibrated and would load a separate native model; the portrait uses the measured pulse rate to pace its glow instead. Kin never presents a blood-pressure reading.
- Presage’s usage-verification check can drop a session if its network request cannot complete. Kin stops, keeps the last values as stopped estimates, and offers **Try Again**; it never continues by inventing values. Keep demo sessions short and check connectivity.
- Windows x64 is the tested target. The SDK also supports macOS and Linux, but Kin’s packaging and camera permission policy are Windows-first for this submission.
- The Windows release needs no key; running from source needs a SmartSpectra key (a free Presage trial key is sufficient). The release build bundles the author's demo key so judges can try Kin without signing up; the source repository contains no key. Kin has no account system.

---

## Privacy and source verification

The privacy claims are enforceable in the source, not just in copy:

- `index.html` and `stage.html` set `connect-src 'none'`.
- `main.js` uses `partition: 'kin'` (no `persist:`), grants the camera permission only to the studio window and only for video (and only used in Smooth preview mode; in Reliable mode the camera belongs to the native SDK), and allowlists external links.
- `src/preload-studio.js` exposes only typed start/stop, SDK-event, camera-settings, and `sendFrame` functions; there is no generic IPC or filesystem surface.
- `main.js` sets `enableTelemetry: false` and requests no facial landmarks.
- There is no `localStorage`, `sessionStorage`, `indexedDB`, or filesystem write in the renderer. The only file Kin writes is the camera-preferences file `kin-settings.json`, saved by the main process.
- The renderer calls `getUserMedia` only in Smooth preview mode, and only for video. There is no `getUserMedia` audio request, no microphone permission, and no audio buffer, playback, or upload path. Kin does not synthesize speech.
- There is no app-level screenshot or recording path; the dev-only capture shortcut was removed. The SDK log level is set to `kNone`, but the SDK may still create technical diagnostics; see **Storage**.
- The optional companion portrait window receives derived values only, over `BroadcastChannel`; the studio’s self-view (preview canvas, or video element in Smooth preview) is the only place camera frames are shown.

---

## Third-party notices

Kin’s own code is MIT licensed. SmartSpectra is proprietary software © Presage Technologies, Inc.; it is used under the challenge’s SDK terms. Fraunces and Inter are licensed under the SIL Open Font License. The bundled Microsoft VC++ runtime DLLs are redistributed under Microsoft’s Visual C++ Redistributable terms. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and [`LICENSE`](LICENSE).

---

## Submission

- Challenge: [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04) `#presagechallenge`
- Repository: <https://github.com/kceehackathon/Kin-presagesmartspectrasdk>
- Demo video: pending YouTube upload.
- Windows build: [latest release](https://github.com/kceehackathon/Kin-presagesmartspectrasdk/releases/latest) (installer + portable EXE)
- DEV post: the submission post on DEV, tagged `#presagechallenge` and `#devchallenge`.
- Solo entry. No Kin account/login or team. The Windows release needs no key (running from source needs one); see **Testing for judges**.

Built with the SmartSpectra SDK, Electron, and a lot of patience for warm-up timers.
