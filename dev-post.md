# Kin: a consent-first portrait driven by live pulse and breathing

This is my submission for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04). `#presagechallenge`

## What I Built

Kin is an Electron app that uses the official Presage SmartSpectra Node SDK to turn live camera measurements into a portrait. In the default wide layout, the left side of the studio is the SmartSpectra camera preview and the portrait is a separate companion window. On smaller displays, the portrait and self-view share the studio stage.

The portrait is driven by measured signals, not animation loops. It does not invent a beat, a breath, or a confidence value. When a signal is missing, the portrait holds still and the matching number stays blank. The demo was recorded with me in front of the camera. It does not use a synthetic or pre-recorded signal.

**Live signals used:** chest breathing trace, breathing rate, pulse rate, and the arterial-pressure trace. The optional expression mirror uses blinking, talking, and expression metrics when the person explicitly opts in. It is off by default.

## Demo

Demo video: pending YouTube upload.

The video shows the consent screen, the live self-view, the live pulse and breathing values, the portrait, and the privacy panel. It ends by stopping the session and showing that the camera stops. The demo was recorded with a private keyed build, so the key screen is skipped; the key is supplied by a local `kin.key` file beside the executable and is not embedded in the public artifact or repository. The demo was recorded with vokoscreenNG; Kin has no recording feature. The demo script is in [`demo-script.md`](https://github.com/kceehackathon/Kin-presagesmartspectrasdk/blob/main/demo-script.md).

## Code

Public repository: <https://github.com/kceehackathon/Kin-presagesmartspectrasdk>

The repository includes the Electron source, the native SmartSpectra runtime, the Windows build scripts, and the setup notes. The app is MIT-licensed. SmartSpectra is proprietary and is used under the challenge SDK terms; see `THIRD_PARTY_NOTICES.md`.

Windows installer and portable build: <https://github.com/kceehackathon/Kin-presagesmartspectrasdk/releases/latest>

The public repository and public installers contain no API key.

## How It Responds to Human Signals

Kin requests four metric bundles from `@smartspectra/node-sdk` 3.5.0:

| Metric | Code | Use in Kin |
| --- | --- | --- |
| Chest breathing trace | `0` | Moves the bust from the measured chest waveform |
| Breathing rate | `2` | Numeric breathing estimate and confidence |
| Pulse rate | `15` | Numeric pulse estimate and confidence |
| Arterial-pressure trace | `16` | Drives the sternum light from the measured waveform |

When the expression mirror is enabled, Kin also requests blinking (`12`), talking (`13`), and expressions (`14`). It never requests facial landmarks (`11`). The SDK is created with `enableTelemetry: false`.

The SDK runs in Electron's main process. The main process owns the camera and receives the SDK's windowed `metrics` events and processed `videoOutput` frames. It sends preview frames to the studio over a narrow IPC bridge. The renderer never calls `getUserMedia`, loads FFI, or opens a second camera reader. This matters because the renderer already paints the portrait and the UI; moving the measurement loop out of that thread stopped the frame-rate watchdog from starving the camera.

The studio paints the processed self-view. `SignalEngine` turns the metric slices into animation targets:

- **Pulse:** the arterial-pressure trace's normalized peaks drive a short sternum-light envelope. If the trace is missing but a fresh pulse rate is available, that measured rate paces the glow. Kin does not generate a waveform.
- **Breathing:** the chest trace's deviation from its recent mean moves the bust. If the trace is stale, the bust stops.
- **Expression:** only when opted in, the highest score above a confidence floor maps to brows, eyes, and mouth. Blinks and talking are short overlays. The labels describe visible facial shapes, not feelings.

The integration is visible in [`main.js`](https://github.com/kceehackathon/Kin-presagesmartspectrasdk/blob/main/main.js) and [`src/signals.js`](https://github.com/kceehackathon/Kin-presagesmartspectrasdk/blob/main/src/signals.js).

## How I Built It

Kin is Electron with a vanilla renderer. The first version ran the SmartSpectra SDK inside the renderer and used the SDK's `MediaStream` for the preview. The preview and the frame bridge competed for the same renderer thread, and the SDK eventually stopped the session on its frame-rate watchdog. I moved the SDK to the main process and used the `videoOutput` event as the self-view. The camera owner now produces the measurement frames, and the studio receives a throttled display copy.

The two-window layout follows from that decision. The studio is a 1280-wide panel. On a wide display the portrait is a frameless 520-wide window beside it. The portrait receives only derived animation values over `BroadcastChannel`; it never receives camera frames, metric buffers, or the API key. The layout uses the available work area rather than assuming a 1080p screen. On a display too narrow for both panels, the portrait and self-view share the studio stage, so the rail and its End action stay accessible.

The SDK provides validation hints such as **No face yet**, **Chest not in frame**, and **Too dark**. Kin shows those hints instead of hiding them. The portrait should say what is wrong instead of guessing.

Presage's usage-verification request can fail on a weak connection. When it does, Kin stops the session, keeps the last values marked as stopped estimates, and offers **Try Again**. It does not keep animating from stale data and does not substitute a fake signal.

## Setup

### Requirements

- Windows 10 or 11, x64
- Node.js 20 or newer
- A webcam
- A SmartSpectra API key from <https://physiology.presagetech.com/auth/register> for the public build; the private keyed judging build supplies one at runtime

The repository includes the Microsoft VC++ runtime DLLs that the native SmartSpectra runtime needs. A separate Visual C++ Redistributable install is not required.

### Run from source

```bash
git clone https://github.com/kceehackathon/Kin-presagesmartspectrasdk.git
cd kin
npm install
npm start
```

`npm install` copies the bundled VC++ runtime DLLs beside `smartspectra_capi.dll`. `npm start` bundles the renderer with esbuild and launches Electron.

### Use

1. Read the consent screen. Check the camera + pulse + breathing consent and the general-wellness acknowledgement. The expression mirror is optional and off by default.
2. In the public build, create a free SmartSpectra key at the link above and paste it into the key prompt. In the private keyed judging build, a local `kin.key` beside the executable supplies the key and this screen is skipped. The key is held in memory for the session and is never written to disk or logged by Kin.
3. After consent and key acceptance (or immediately in the keyed build), the camera opens. The studio shows the live local self-view on the left. On a wide display the portrait opens in a companion window beside it; on a smaller display the portrait sits beside the self-view inside the studio. Sit about 50–90 cm from the camera with your face, shoulders, and upper chest visible. Soft, even light in front of you works best.
4. Wait for the SDK to report signals. Breathing usually appears before pulse. The validation line tells you what to fix. The portrait stays still until a fresh signal arrives.
5. Press `P` for present mode. Press `F` to reopen the portrait window if you close it.
6. Press **Pause** to release the camera, or **End** to clear the session and the in-memory key.

### Windows build

```bash
npm run dist
```

The installer and portable executable are written to `release/`. The build is not code-signed, so Windows SmartScreen may ask for confirmation.

### Testing for judges

Kin has **no Kin account, login, or cloud service**. The only credential is the SmartSpectra API key. The public build asks for one; the private keyed judging build supplies it at runtime and skips the key screen.

1. For the public build, create a free key at <https://physiology.presagetech.com/auth/register>. For a no-key run, use the private keyed portable build; it reads a local `kin.key` beside the executable.
2. Launch Kin. In the public build, paste the key at the prompt. In the keyed build, continue from consent straight to the camera. Do not use a key from this repository; there isn't one.
3. Complete the consent screen and sit in frame. Wait for the pulse and breathing values. The self-view stays visible while the SDK measures.
4. Open **Privacy & data** to see the storage, sharing, retention, deletion, and telemetry details.
5. Press **End** when finished. The camera stops and the in-memory key is cleared.

For a no-key judging run, contact me through this DEV post. I can provide the private keyed portable package. It is not uploaded to the public repository or public release; a client-side key is extractable, so it is shared privately and rotated after judging.

A one-page test checklist is in [`TESTING.md`](https://github.com/kceehackathon/Kin-presagesmartspectrasdk/blob/main/TESTING.md).

The app is Windows-first. The SDK supports other platforms, but the camera permission policy and packaging in this submission target Windows x64.

## Consent and Data Handling

- **Camera consent is a gate.** The studio cannot start until the person checks camera + pulse + breathing consent and the general-wellness acknowledgement. The expression mirror is a separate choice and is off by default. The live self-view stays visible during measurement, so the camera is never hidden.
- **No covert monitoring.** There is no background mode, no scheduled capture, and no hidden camera path. Pause releases the camera. End stops the camera and returns to consent.
- **Storage: no body data or API key written by Kin.** Kin writes no video, audio, images, measurements, session history, or API key to disk. The API key is held in memory and sent once over the in-process IPC bridge. The input field is cleared after use.
- **Technical files kept by the SDK and Chromium.** SmartSpectra may keep a device-key/model cache under `%LOCALAPPDATA%\Presage\Physiology` and `%LOCALAPPDATA%\SmartSpectraSDK` or `%APPDATA%\Kin\SmartSpectraSDK`. It may write technical diagnostic logs under `%LOCALAPPDATA%\Temp\SmartSpectra*.log.*`. Chromium may keep ordinary app cache files under `%APPDATA%\Kin`. These files contain no camera frames, audio, or measured values. Kin sets the SDK log level to `kNone`, but SDK-generated logs may still appear.
- **Sharing: Kin uploads nothing.** The renderer runs under `connect-src 'none'` and cannot open a network connection. The native SDK makes the required Presage requests: authentication, usage/entitlement verification, and encrypted model downloads. Those requests can include the API key and session usage metadata such as duration and frame counts, and they can be correlated with a Presage account. They do not contain preview frames, video, audio, or measured pulse/breathing values. Kin adds no analytics, crash reporting, or cloud storage.
- **SDK telemetry is disabled.** Kin creates the SDK with `enableTelemetry: false`. No session summaries or device-readiness reports are sent. Required usage accounting still runs, as described above.
- **Retention:** session state lives in memory. Ending the session or closing Kin clears the in-memory key and all derived values. The SDK and Chromium technical files described above may remain until you delete them. They contain no body data.
- **Deletion:** use **End** or close Kin to clear session state. On Windows, delete `%APPDATA%\Kin`, `%LOCALAPPDATA%\Presage\Physiology`, `%LOCALAPPDATA%\SmartSpectraSDK`, and `%LOCALAPPDATA%\Temp\SmartSpectra*.log.*` to remove technical caches and logs. There is no Kin account or cloud copy to delete.
- **Optional AI:** none. Kin does not use LLM Insights or send data to an AI service. Expression labels describe visible facial shapes, not feelings.
- **No medical use.** Kin provides general-wellness and entertainment estimates. It does not diagnose, treat, monitor, or predict a condition, and it does not make medical decisions. It makes no emotion or stress claims. It is not a medical device.

## Demo Video Script

The full shot-by-shot script is in [`demo-script.md`](https://github.com/kceehackathon/Kin-presagesmartspectrasdk/blob/main/demo-script.md). The short version:

| Time | Screen | Narration |
| --- | --- | --- |
| 0:00 | Consent screen | "This is Kin. It uses Presage SmartSpectra to drive a portrait from live pulse and breathing. The camera is gated by consent, and the expression mirror is off by default." |
| 0:20 | Camera opens | "This private demo build uses a local operator key, so there is no key screen. The key stays outside the public repository and public installer. The camera is opening now." |
| 0:40 | Studio and portrait | "This is the live SDK self-view on the left. The portrait on the right is driven by the same session. I am not using a recorded signal." |
| 1:05 | Live values | "The pulse and breathing numbers come from SmartSpectra. The validation line tells me to stay in frame. When a signal is missing, the portrait stops." |
| 1:35 | Privacy & data | "Kin records nothing and uploads nothing. The native SDK authenticates with Presage and downloads encrypted models. Telemetry is off. The README lists the technical files the SDK may keep and how to delete them." |
| 1:55 | End | "End clears the in-memory key and stops the camera. There is no Kin account to delete." |
| 2:05 | Closing | "The code and Windows build are in the public repository. The public build uses a free SmartSpectra key; the private keyed judging build skips that screen. The app is not a medical device." |

## What I Learned

Two implementation problems took most of the time. The first was keeping the portrait still when the SDK had no fresh signal. SmartSpectra gives you windowed measurements, confidence, and validation hints; the app has to respect all three. The second was moving the SDK into the main process so the camera preview and the measurement loop stopped competing for the renderer thread.

## Prize Categories

I am entering **Best Thoughtful Real-World Use**, for the consent-first, local-only handling of a camera signal, and **Most Creative or Delightful Use**, for a portrait that responds to a body signal without turning it into a dashboard or a diagnosis.

## Limitations

- Windows x64 is the tested target.
- The public build requires a free SmartSpectra API key; the private keyed judging build skips the key screen. Kin has no account system.
- Live values depend on camera position, light, stillness, and the SDK's warm-up. The app shows validation hints instead of filling missing values.
- Presage's usage-verification request can fail on a weak connection. Kin stops and offers **Try Again** rather than continuing from stale data.
- The public installers contain no key. A private operator-key build can be supplied for judging; a public client-side key would be extractable.
- The app does not use HRV or facial landmarks. The live signals in this submission are pulse and breathing, with an optional visible-expression mirror.

`#presagechallenge` `#devchallenge`
