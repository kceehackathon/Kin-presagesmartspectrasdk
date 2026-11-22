# Recording guide for the Kin demo

## Recommendation

Use **vokoscreenNG 4.11.0** for Windows. It is free, open source, has no account requirement, no watermark, and records locally. The Windows download is a 64-bit installer. It captures the full screen, a window, or an area, and it can also capture a camera and microphone.

Official download: <https://linuxecke.volkoh.de/vokoscreen/vokoscreen.html>

Record the **screen only**, with Kin's live self-view visible. The self-view is already inside Kin. You do not need a second webcam feed, and you should not enable vokoscreenNG's camera while Kin is measuring.

vokoscreenNG is a recorder, not an editor. If you need to trim the start or end, use Clipchamp on Windows or another editor. Keep the live measurement segment continuous.

These steps are for vokoscreenNG 4.11.0, the current Windows app. If you are using an older vokoscreen release, update it first; the camera and codec modules changed in recent versions. The main rule is the same: screen-only capture, camera off, and Kin's self-view visible.

## The camera conflict

Kin's native SmartSpectra SDK owns the webcam while a session is running. Do not enable the **Camera** tab in vokoscreenNG during the measurement. On many Windows cameras the second open fails, or it can make Kin lose frames. If vokoscreenNG opens the camera, close that camera window before you start Kin.

There are three workable setups:

1. **Screen only, face in Kin (recommended).** Capture the display with vokoscreenNG. Kin's live self-view shows your face, and the portrait and signal cards are beside it. This satisfies "face and screen" without opening the camera twice.
2. **Second camera for a talking-head overlay.** Use a second USB camera or a phone as a webcam for vokoscreenNG, and leave the primary camera for Kin. Test both before recording. Do not label the second camera as the SmartSpectra self-view.
3. **Separate intro and outro.** Record a short talking-head clip with Kin closed, then record the screen-only demo with Kin running, and join the clips in an editor. This is more work and is not necessary.

Do not open the primary webcam in vokoscreenNG "just in case." Test the exact setup before the real take.

## vokoscreenNG setup

1. Download vokoscreenNG from the official page and install it. There is no account or paid tier.
2. Launch vokoscreenNG. On the **Screen** tab, choose **Fullscreen** and select the display that contains both Kin panels (and the separate portrait window, if it is open). Do not use **Window** for the main recording; it can miss the portrait or the self-view. Do not use **Area** unless you deliberately want to crop.
3. This demo is screen-only. Disable microphone and desktop audio capture in vokoscreenNG; Kin has no synthesized speech or app audio.
4. Set **Frames** to `30`.
5. Set **Format** to `MP4` and **Video codec** to `H.264`. If vokoscreenNG asks to download the Cisco OpenH264 encoder, accept it. If MP4 with H.264 is not available on your install, record `MKV` with H.264 and convert or remux to MP4 before upload.
6. Leave **Countdown** at `3` seconds, or set a short countdown. This gives you time to move the pointer away.
7. Open the **Settings** tab (wrench icon):
   - Set **Videopath** to a folder with enough free space.
   - Check **Minimized when recording starts**. This keeps the vokoscreenNG window out of the capture.
   - Set **Second wait before recording** to `2` or `3`.
   - Leave **Show in systray** on if you want to stop from the tray.
8. Open the **Codecs** tab and confirm that the selected format and video codec show **Available**. Audio is disabled for this demo; do not add an audio track. If H.264 is missing, use the download or license prompt or choose a supported codec.
9. Do not enable the **Camera** tab. Kin's self-view is the face.
10. Optional: open the **Timer** tab and enable **Stop recording after** `4` minutes as a safety net. The demo should be about 2:10.
11. Click **Start**. Wait for the countdown. If vokoscreenNG did not minimize itself, minimize it now.
12. Record a 10-second test, stop it, and open the **Folder** to check:
    - The screen is sharp.
    - The recording has no microphone or desktop-audio track.
    - Kin's self-view and the portrait are both visible.
    - No notification, key file, or private window is on screen. The keyed demo build skips the key screen; keep its folder and `kin.key` out of the capture.

The default Start/Stop shortcut is `CTRL+SHIFT+F10`. It does not clash with Kin's `P` or `F` shortcuts.

## Hiding vokoscreenNG while recording

- The easiest method is **Settings → Minimized when recording starts**. Leave it checked. Start the recording, and vokoscreenNG minimizes after the countdown.
- If the window is still visible, minimize it manually before you begin the script.
- Move it to a second monitor if you have one.
- Stop with `CTRL+SHIFT+F10` or the tray icon. Do not leave the vokoscreenNG window in the finished video.

## Recording the demo

1. Launch Kin and leave it on the consent screen.
2. In vokoscreenNG, confirm **Fullscreen**, the correct display, `30` frames, `MP4`/`H.264`, audio off, camera off, and **Minimized when recording starts**.
3. Click **Start**. Wait for the countdown and confirm vokoscreenNG has minimized. Begin `demo-script.md`.
4. Stop the recording after the closing line with `CTRL+SHIFT+F10`.
5. Open the **Folder** and check the editing list at the end of `demo-script.md`.
6. If you recorded MKV, convert or remux it to MP4 before uploading.
7. Upload to YouTube with **Public** visibility. **Unlisted** also works if the link is in the submission, but Public is the simplest for judges. Do not leave it Private.
8. In YouTube Studio, add a title such as `Kin — live pulse and breathing portrait with Presage SmartSpectra`, the repository link, the setup link, and `#presagechallenge` in the description.
9. Put the YouTube URL in `dev-post.md` where it links the demo video.

## If the recording is choppy

Kin runs the SmartSpectra measurement loop and a portrait animation. vokoscreenNG adds a screen capture and an encoder. On a laptop, the combination can be heavy.

- Record at 30 fps, not 60.
- Close browsers and other GPU-heavy apps.
- Keep the vokoscreenNG window minimized.
- If H.264 encoding is still too heavy, record at 1600×900 or 1280×720. Check that both Kin windows are still readable.
- Do not solve choppiness by speeding up or slowing down the signal. The video must show a live signal at real time.

## If you already use OBS

OBS Studio is also acceptable. The camera rule is the same: do not add the primary webcam while Kin is measuring. Use **Display Capture**, 1080p at 30 fps, and a hardware encoder if available. The important part is the recording shows Kin's live self-view, the pulse and breathing values, and the portrait together.

## Free alternatives

| Tool | Free? | Face + screen | Notes |
| --- | --- | --- | --- |
| **vokoscreenNG** | Yes, GPL-2.0, no watermark, no account | Yes, with built-in camera support or Kin's self-view | Recommended for this demo. Windows 64-bit installer, current 4.11.0 (October 1, 2026). No editor or upload. |
| **OBS Studio** | Yes, GPL, no watermark, no account | Yes, with a webcam source or Kin's self-view | More control. Can also stream to YouTube. Good alternative if you already know it. |
| **Cap** | Free for personal use only | Yes | The official binary needs a paid license for commercial use. It is open source, but it is not "free for any use." Skip it for a contest submission. |
| **Xbox Game Bar** | Yes, built into Windows | Screen and mic; no reliable webcam overlay | Fine for a quick screen clip, not for this demo. |
| **Loom free tier** | Limited | Yes | Time limits and account requirements. Not suitable for a full demo. |

vokoscreenNG: <https://linuxecke.volkoh.de/vokoscreen/vokoscreen.html>

## Do not do this

- Before recording, confirm the key has trial credits. If Kin reports **no credits left**, stop and obtain a fresh key; the public build and private keyed build both depend on Presage usage allowance.
- Do not put a SmartSpectra key in the video, the repository, the description, or a public build.
- Do not use a synthetic pulse or breathing signal to make the portrait move.
- Do not record a separate camera feed and label it as the live SmartSpectra self-view.
- Do not enable vokoscreenNG's camera while Kin owns the primary webcam.
- Do not add medical, diagnosis, treatment, emotion, or stress claims in the narration, captions, or description.
- Do not upload the video as Private and assume judges can open it.
- Kin's positioning cues are text in the rail; the self-view has no text or markings over it. Do not describe them as recorded speech or as cloud audio; the microphone is never opened by Kin.
