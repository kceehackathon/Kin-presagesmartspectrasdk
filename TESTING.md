# Testing Kin

Kin has no Kin account, login, or cloud service. The public build asks for a free SmartSpectra API key; the private keyed judging build supplies one through a local `kin.key` beside the executable and skips the key screen.

## What you need

- Windows 10 or 11, x64
- A webcam
- Node.js 20 or newer if you run from source
- A free SmartSpectra key from <https://physiology.presagetech.com/auth/register> for the public build; the private keyed judging build supplies one at runtime

The public repository and public installers contain no key. For a no-key run, use the private keyed judging build; it carries a local `kin.key` beside the executable. Do not ask for a public key. A SmartSpectra key is tied to a Presage account and can be extracted from any client build, so a public key would be a leak.

## Run it

### Installer

Download `Kin-1.0.0-Setup.exe` or `Kin-1.0.0-Portable.exe` from the repository release. The build is unsigned, so Windows SmartScreen may ask for confirmation.

### Source

```bash
git clone https://github.com/kceehackathon/Kin-presagesmartspectrasdk.git
cd kin
npm install
npm start
```

## Three-minute test

1. **Consent gate.** Launch Kin. The consent screen should appear before any camera access. Try clicking **I consent — continue** without checking both required boxes; it should stay disabled. Check **I agree** under **Camera + pulse + breathing** and the general-wellness acknowledgement. Leave **Expression mirror** off.
2. **Key handling.** Click **I consent — continue**. In the public build, paste a free SmartSpectra key into the masked field. Do not click **Show**. In the private keyed build, this screen is skipped because `kin.key` is beside the executable. Click **Begin listening** in the public build. Either way, the camera opens and the studio self-view appears.
3. **Live self-view.** Confirm that you can see yourself in the left studio panel. On a wide display, a separate portrait window opens beside the studio. On a smaller display, the portrait appears inside the studio beside the self-view. The portrait should not show a camera feed. The self-view should be clean: no face circle, chest circle, corner brackets, guide lines, or labels over the video. The preview should feel continuous rather than like a slideshow.
4. **Positioning text.** Sit about 50–90 cm from the camera with your face, shoulders, and upper chest visible. The validation line and positioning card in the rail should change from a warning such as **No face yet** or **Chest not in frame** to a normal listening state. If a warning persists, the text should say what to fix. The self-view should stay free of text and markings. Confirm that no speech or audio is produced.
5. **Live signals.** Wait for breathing and pulse. Breathing usually appears first. The pulse and breathing cards should show live numbers, and the portrait should move from the measured traces. When a signal is missing, the number should stay blank and the portrait should stop rather than inventing a value.
6. **Expression default.** Confirm that the expression mirror is off by default and that no emotion or stress label is shown. The optional mirror is a separate consent; it is not required to test the live signal. If you opt in, make a clear expression and confirm that the portrait follows within roughly a beat; the SDK's expression window can add its own delay. The labels describe visible facial shapes, never emotion.
7. **Privacy.** Open **Privacy & data**. Check that it covers storage, sharing, retention, deletion, SDK telemetry, positioning text, and AI. Confirm that Kin has no recording control, no upload control, no microphone request, and no account.
8. **End.** Click **End**. Confirm **End session**. The camera should stop, the studio should return to the consent/key flow, and the in-memory key should be gone. Relaunching should ask for a key again unless an operator key is configured.
9. **No network from the renderer.** Optional source check: `index.html` and `stage.html` use `connect-src 'none'`; the renderer does not call `getUserMedia`. The native SDK is created in `main.js` with `enableTelemetry: false`.
10. **No key in a public artifact.** The repository and public installers contain no key. The private keyed package uses a `kin.key` sidecar and must not be published.

## Expected result

- The live self-view and the live pulse/breathing values are visible at the same time.
- The self-view is a clean 4:3 video frame with no face circle, chest circle, framing guide, labels, or text over it.
- Positioning guidance is text in the rail only and never uses the microphone.
- The camera is requested at 640×480 and 30 fps; the preview is a 640×480 RGBA display copy at about 15 fps, uploaded as a WebGL texture.
- The layout adapts to the available work area. On 1024×768, 1280×720, 1366×768, and 1920×1080, both the self-view and the portrait remain visible. When the display has room, the portrait opens beside the studio. On a smaller display it shares the stage with the self-view, so it does not cover the rail or the End button.
- At a 1280×720 display with 150% scaling (about 853×480 DIP), the rail remains usable and the Pause/End actions stay visible.
- The portrait moves from measured signals, not a looping animation.
- The expression mirror is off unless explicitly enabled.
- No video, audio, images, measurements, history, or API key are written by Kin.
- The native SDK may use the network for authentication, usage verification, and encrypted models; the renderer cannot make network requests.
- No diagnosis, treatment, medical decision, emotion, or stress claim is made.

## Troubleshooting

- **Camera does not open:** close other apps that may own the webcam. Kin and vokoscreenNG (or OBS) cannot reliably use the same camera at the same time.
- **Camera running slowly:** add soft front light, close other camera apps, and keep the camera on a stable mount. Low light can make auto-exposure reduce frame rate.
- **No positioning text:** confirm the SDK is reporting a warning in the rail card. A correctly framed session shows **Good position**; the self-view never carries an alert or label.
- **Key rejected or no credits:** create a fresh free key. Do not use a key from a public repository or a shared screenshot. A trial key with no credits cannot start a session.
- **No pulse yet:** breathing can appear before pulse. Hold still, improve front lighting, and keep the upper chest in frame. Wait for the SDK warm-up.
- **Session stops with an auth/usage error:** Presage's usage verification could not complete. Check the network and click **Try Again**. Kin will not continue from stale values.
- **No portrait or companion window:** press `F` in the studio to open it. On a smaller display the portrait is already inside the studio; `F` opens the floating companion instead.
- **Present mode:** press `P`; press `P` again to return to the studio.

## What not to expect

- A Kin login. There is none.
- A bundled API key in the public artifacts. There is none. The private keyed judging package uses a local sidecar file and is not public.
- A recording feature. Kin does not record. If a demo video exists, it was recorded by separate software such as vokoscreenNG or OBS, not by Kin.
- A medical device. Kin provides general-wellness and entertainment estimates only.
