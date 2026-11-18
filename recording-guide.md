# Recording guide for the Kin demo

## Recommendation

Use **OBS Studio**. It is free, open source, has no account requirement, no watermark, and no time limit. It records the screen, microphone, and a webcam, and it can also stream to YouTube. The current Windows release is OBS Studio 33.0.1 (October 29, 2026).

Official download: <https://obsproject.com/>

OBS is the safest choice for this demo because the recording must show the screen and the live self-view at the same time. The self-view is already inside Kin, so the recording does not need a second webcam feed.

## The camera conflict

Kin's native SmartSpectra SDK owns the webcam while a session is running. Do not add that same webcam as a **Video Capture Device** in OBS during the measurement. On many Windows cameras the second open fails, or it can make Kin lose frames.

There are three workable setups:

1. **Screen only, face in Kin (recommended).** Capture the display with OBS. Kin's live self-view shows your face, and the portrait and signal cards are beside it. This satisfies "face and screen" without opening the camera twice.
2. **Second camera for a talking-head overlay.** Use a second USB camera or a phone as a webcam for OBS, and leave the primary camera for Kin. Test both before recording.
3. **Separate intro and outro.** Record a short talking-head clip with Kin closed, then record the screen-only demo with Kin running, and join the clips in an editor. This is more work and is not necessary for the challenge.

Do not add the primary webcam to OBS "just in case." Test the exact setup before the real take.

## OBS setup

1. Download OBS Studio from <https://obsproject.com/> and install it. There is no account or paid tier.
2. On first launch, run the Auto-Configuration Wizard. Choose **Optimize for recording**, not streaming. If you skip the wizard, use the settings below.
3. Open **Settings → Video**.
   - Base (Canvas) Resolution: `1920x1080`
   - Output (Scaled) Resolution: `1920x1080`
   - Common FPS Values: `30`
4. Open **Settings → Output**.
   - Output Mode: `Advanced`
   - Recording tab
   - Encoder: `NVIDIA NVENC H.264` if you have an NVIDIA GPU, `Intel QuickSync H.264` for Intel, `AMD HW H.264` for AMD, or `x264` as a fallback.
   - Rate Control: `CQP` with `20`, or `CRF` with `20` for x264.
   - Recording Format: `MP4`. If you are worried about a crash, use `MKV` and remux to MP4 from **File → Remux Recordings**.
   - Recording Path: a folder with enough free space. A 2-minute 1080p30 recording is usually under 200 MB.
5. Open **Settings → Audio**.
   - Mic/Auxiliary Audio: your microphone.
   - Sample Rate: `48 kHz`.
   - Disable desktop audio unless you specifically want system sounds. Kin has no sound of its own.
   - In the Audio Mixer, open the microphone filter menu and add **Noise Suppression** (RNNoise) and, if needed, **Gain**. Do not over-process; a quiet room is better.
6. In the **Sources** panel, add **Display Capture**. Choose the display that contains both Kin windows. Do not use Window Capture for the main recording; Electron windows with GPU rendering can capture as a black frame in some setups.
7. Resize the display capture to fill the canvas. Right-click it and choose **Fit to screen** if needed.
8. Optional: add a **Text** source in a corner with `Kin — live SmartSpectra demo`. Keep it out of the way of the pulse and breathing cards.
9. Do not add a Video Capture Device for the primary webcam. Kin's self-view is the face.
10. Click **Start Recording**, wait two seconds, and record a 10-second test. Stop it, open the file, and check:
    - The screen is sharp.
    - The microphone level is not clipping.
    - Kin's self-view and the portrait are both visible.
    - No notification, key, or private window is on screen.

## Hiding OBS while recording

If OBS is on the same display as Kin, it will appear in the recording. Use one of these:

- Set a hotkey in **Settings → Hotkeys** for **Start Recording** and **Stop Recording**, then minimize OBS to the taskbar before the take.
- Move OBS to a second monitor, if you have one.
- Start the recording, minimize OBS, and begin the script.

Do not use a hotkey that clashes with Kin's `P` (present) or `F` (frame) shortcuts.

## Recording the demo

1. Launch Kin and leave it on the consent screen.
2. Start the OBS recording. Wait two seconds.
3. Follow `demo-script.md`.
4. Stop the recording after the closing line.
5. Open the file and check the editing list at the end of `demo-script.md`.
6. Upload to YouTube with **Public** visibility. **Unlisted** also works if the link is in the submission, but Public is the simplest for judges. Do not leave it Private.
7. In YouTube Studio, add a title such as `Kin — live pulse and breathing portrait with Presage SmartSpectra`, the repository link, the setup link, and `#presagechallenge` in the description.
8. Put the YouTube URL in `dev-post.md` where it links the demo video.

## If the recording is choppy

Kin runs the SmartSpectra measurement loop and a portrait animation. OBS adds a screen capture and an encoder. On a laptop, the combination can be heavy.

- Use a hardware encoder (NVENC, QuickSync, or AMF) instead of x264.
- Record at 30 fps, not 60.
- Close browsers and other GPU-heavy apps.
- Keep the OBS preview hidden or minimized.
- If it is still choppy, record at 1280×720 and upload that. The app's content is readable at 720p, and a clean 720p video is better than a stuttering 1080p one.
- Do not solve choppiness by speeding up or slowing down the signal. The video must show a live signal at real time.

## Free alternatives

| Tool | Free? | Face + screen | Notes |
| --- | --- | --- | --- |
| **OBS Studio** | Yes, GPL, no watermark, no account | Yes, with a webcam source or Kin's self-view | Recommended. Most control. Can also stream to YouTube. |
| **vokoscreenNG** | Yes, GPL-2.0, no watermark | Yes, built-in camera support | Simpler than OBS. Windows 64-bit installer, current 4.11.0 (October 1, 2026). No editor or upload. Good if OBS feels too heavy. |
| **Cap** | Free for personal use only | Yes | The official binary needs a paid license for commercial use. It is open source, but it is not "free for any use." Skip it for a contest submission. |
| **Xbox Game Bar** | Yes, built into Windows | Screen and mic; no reliable webcam overlay | Fine for a quick screen clip, not for this demo. |
| **Loom free tier** | Limited | Yes | Time limits and account requirements. Not suitable for a full demo. |

vokoscreenNG: <https://linuxecke.volkoh.de/vokoscreen/vokoscreen.html>

## Do not do this

- Do not put a SmartSpectra key in the video, the repository, the description, or a public build.
- Do not use a synthetic pulse or breathing signal to make the portrait move.
- Do not record a separate camera feed and label it as the live SmartSpectra self-view.
- Do not add medical, diagnosis, treatment, emotion, or stress claims in the voice-over or description.
- Do not upload the video as Private and assume judges can open it.
