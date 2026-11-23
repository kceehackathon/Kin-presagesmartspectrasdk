# Testing Kin

Kin has no Kin account, login, or cloud service. Judges do not need their own key: the Windows release build bundles the author's SmartSpectra demo key and skips the key screen.

## What you need

- Windows 10 or 11, x64
- A webcam
- Node.js 20 or newer if you run from source
- The Windows release needs no key. Running from source needs a free SmartSpectra key from <https://physiology.presagetech.com/auth/register> (in a `.env` file as `KIN_API_KEY=...`, or pasted at the key prompt)

The release build bundles the author's demo key so judges can try Kin without signing up; the source repository contains no key.

## Run it

### Installer

Download `Kin-1.0.0-Setup.exe` or `Kin-1.0.0-Portable.exe` from the [Releases page](https://github.com/kceehackathon/Kin-presagesmartspectrasdk/releases/latest). The build is unsigned, so if Windows SmartScreen warns, choose **More info**, then **Run anyway**. No key is needed.

### Source

```bash
git clone https://github.com/kceehackathon/Kin-presagesmartspectrasdk.git
cd Kin-presagesmartspectrasdk
npm install
npm start
```

## Three-minute test

1. **Consent gate.** Launch Kin. It should open maximized (not fullscreen) with its own minimize, maximize/restore, and close buttons visible at the top right. The consent screen should appear before any camera access. Try clicking **I consent — continue** without checking both required boxes; it should stay disabled. Check **I agree** under **Camera + pulse + breathing** and the general-wellness acknowledgement. Leave **Expression mirror** off.
2. **Key handling.** Click **I consent — continue**. In the release build the key page is skipped and the camera opens. From source (no `.env`), paste a free SmartSpectra key into the masked field (do not click **Show**) and click **Begin listening**. Either way, the studio self-view appears.
3. **Live self-view.** Confirm that you can see yourself in the studio beside the portrait. Kin is maximized by default; press `F11` to check fullscreen and back, and try the minimize, maximize/restore, and close buttons. The portrait should be in the same window and should not show a camera feed. The self-view should be clean: no face circle, chest circle, corner brackets, guide lines, or labels over the video. In the default Reliable mode the self-view updates at about 12–15 fps; it should feel continuous rather than like a slideshow. Watch it again when the pulse value first appears; the self-view should not become choppy at that moment.
4. **Positioning text.** Sit about 50–90 cm from the camera with your face, shoulders, and upper chest visible. The validation line and positioning card in the rail should change from a warning such as **No face yet** or **Chest not in frame** to a normal listening state. If a warning persists, the text should say what to fix. The self-view should stay free of text and markings. Confirm that no speech or audio is produced.
5. **Live signals.** Wait for breathing and pulse. Breathing usually appears first. The pulse and breathing cards should show live numbers. The chest trace drives the breathing motion, and the measured pulse rate paces the sternum light; Kin does not request the arterial waveform. When a signal is missing, the number should stay blank and the portrait should stop rather than inventing a value.
6. **Expression default.** Confirm that the expression mirror is off by default and that no emotion or stress label is shown. The optional mirror is a separate consent; it is not required to test the live signal. If you opt in, make a clear expression and confirm that the portrait follows within roughly a beat; the SDK's expression window can add its own delay. The labels describe visible facial shapes, never emotion. With the mirror on, the Expression card should show an animated 3D emoji that follows your visible expression, plus the expression name (Neutral, Angry, Contempt, Disgust, Fear, Happy, Sad, Surprise) and the note "visible expression, not a feeling". With the mirror off, no emoji or expression name appears.
7. **Privacy.** Open **Privacy & data**. Check that it covers storage, sharing, retention, deletion, SDK telemetry, positioning text, and AI. Confirm that Kin has no recording control, no upload control, no microphone request, and no account. The storage text should mention the single camera-preferences file.
8. **End.** Click **End**. Confirm **End session**. The camera should stop, the studio should return to the consent/key flow, and any key you pasted should be gone. Relaunching from source should ask for a key again unless one is set in `.env`; the release build uses its bundled demo key.
9. **No network from the renderer.** Optional source check: `index.html` and `stage.html` use `connect-src 'none'`. In Reliable mode the renderer does not call `getUserMedia`; in Smooth preview mode it calls it for video only, never audio. The native SDK is created in `main.js` with `enableTelemetry: false`.
10. **No key in the repository.** The source repository contains no key (`.env` and `kin.key` are gitignored). The Releases build bundles the author's demo key so judges can test without signing up.
11. **Camera settings.** Open **Camera settings** from the Studio header button and with `S`. Confirm Camera mode (Reliable / Smooth preview), Measurement frame rate (25 / 30), Resolution (Standard 640×480 / HD 1280×720), and Self-view (On / Off) are present, with a device recommendation (CPU, threads, RAM, GPU, tier), live performance (measuring fps, self-view, reading delay), and tips. Change a setting, close and relaunch Kin, and confirm it persisted. Confirm `%APPDATA%\Kin\kin-settings.json` holds only those preferences. Switch to **Smooth preview** and confirm the self-view is a full-rate live video, readings keep arriving, and no audio permission is requested; switch back to **Reliable**.
12. **Auto-reconnect.** While measuring, cause a transient stop (for example briefly start a heavy CPU load or unplug the network). Kin should show **Reconnecting…**, keep the last readings on screen, and recover within a few seconds. After more than 4 restarts in 3 minutes it should show the normal **Try again** screen. A bad key or no-credits error must go straight to an error screen without retrying.
13. **Stability soak.** On a plugged-in laptop in **Best performance** power mode, in Reliable mode, run five minutes: the pulse should stay steady and the camera should hold 30 fps in the camera settings dialog with no engine stops.

## Expected result

- The live self-view and the live pulse/breathing values are visible at the same time.
- The self-view is a clean 4:3 video frame with no face circle, chest circle, framing guide, labels, or text over it.
- Positioning guidance is text in the rail only and never uses the microphone.
- The camera runs at 640×480 and 30 fps. In Reliable mode the self-view is drawn from the SDK's processed frames at about 12–15 fps and uploaded as a WebGL texture; in Smooth preview it is a full-rate video element.
- The layout adapts to the display. On 1024×768, 1280×720, 1366×768, and 1920×1080, the portrait and self-view stay together in the studio and the rail remains usable and fills the screen height. Press `F11` to verify fullscreen too. In windowed mode on a wide display, the companion portrait can be opened beside the studio; in fullscreen it stays in the studio so it cannot cover the rail or the End button.
- At a 1280×720 display with 150% scaling (about 853×480 DIP), the rail remains usable and the Pause/End actions stay visible.
- The portrait moves from measured signals, not a looping animation.
- The expression mirror is off unless explicitly enabled.
- No video, audio, images, measurements, history, or API key are written by Kin. The only file Kin writes is the camera-preferences file `%APPDATA%\Kin\kin-settings.json`.
- The native SDK may use the network for authentication, usage verification, and encrypted models; the renderer cannot make network requests.
- No diagnosis, treatment, medical decision, emotion, or stress claim is made.

## Troubleshooting

- **Camera does not open:** close other apps that may own the webcam. Kin and vokoscreenNG (or OBS) cannot reliably use the same camera at the same time.
- **Camera running slowly:** add soft front light, close other camera apps, and keep the camera on a stable mount. Low light can make auto-exposure reduce frame rate. Plug in the charger and set Windows power mode to **Best performance**; on battery the CPU is capped and the SDK cannot sustain 30 fps. Use **Reliable** camera mode and the Standard resolution.
- **No positioning text:** confirm the SDK is reporting a warning in the rail card. A correctly framed session shows **Good position**; the self-view never carries an alert or label.
- **Key rejected or no credits:** if the demo key runs out or is rejected, Kin shows the key page with a message. Paste a free key from <https://physiology.presagetech.com/auth/register>, or request a trial reset through Presage Discord. A key with no credits cannot start a session.
- **No pulse yet:** breathing can appear before pulse. Hold still, improve front lighting, and keep the upper chest in frame. Wait for the SDK warm-up.
- **Session stops with an auth/usage error:** Presage's usage verification could not complete. Check the network and click **Try Again**. Kin retries transient stops by itself first (**Reconnecting…**) but will not continue from stale values.
- **No portrait or companion window:** in fullscreen, the portrait and self-view are already together in the studio. Press `F11` to toggle fullscreen; in windowed mode press `F` to open the floating companion.
- **Present mode:** press `P`; press `P` again to return to the studio.

## What not to expect

- A Kin login. There is none.
- A key page in the release build. It bundles the author's demo key; the key page only appears if that key is rejected or out of credits. The source repository contains no key.
- A recording feature. Kin does not record. If a demo video exists, it was recorded by separate software such as vokoscreenNG or OBS, not by Kin.
- A medical device. Kin provides general-wellness and entertainment estimates only.
