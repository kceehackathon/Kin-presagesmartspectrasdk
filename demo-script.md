# Kin demo video script

Target length: 2:10 to 2:20. This keeps the live session short and leaves time to cut a bad take. The video should be recorded with vokoscreenNG, with Kin's screen visible. See `recording-guide.md` for the vokoscreenNG setup and the webcam conflict.

The narration lines below are optional. Keep the screen actions in order; the app itself has no synthesized voice.

## Before recording

- Use the release build (installer or portable). It bundles the author's demo key, so no key screen appears. The source repository contains no key.
- Use a demo key that still has credits. If the key screen or studio reports **no credits left**, stop and use a valid key from an account that still has credits, or request a reset through Presage Discord; Kin cannot bypass Presage usage limits. Keep the key active through judging.
- Put Kin on the recording display. It opens maximized with its own minimize, maximize/restore, and close buttons at the top right; press `F11` for fullscreen so the portrait and self-view fill the display together. No separate companion window is needed. If you want the taskbar out of the shot, use `F11`.
- Close other apps and notifications, especially Chrome and Discord. Do not show email, browser tabs, or a key.
- Set the display to 1920×1080 if possible. Kin scales the portrait, self-view, and rail to the display.
- Plug the laptop in and set Windows power mode to **Best performance**. On battery the CPU is capped and the SDK cannot sustain 30 fps.
- Light your face evenly from the front.
- Leave **Camera settings** (button in the Studio header, or `S`) on **Reliable** mode, Standard resolution, 30 fps. Check the dialog's live performance once before recording, then close it.
- Start from a fresh launch with the consent screen showing. Do not start from a session that has already been running.
- Keep microphone and desktop-audio capture off in vokoscreenNG. The demo is screen-only; Kin has no synthesized speech or app audio.
- Do not enable the same webcam in vokoscreenNG while Kin is measuring. Kin owns the camera through the native SDK. The face on screen is Kin's live self-view. If you want a separate talking-head shot, use a second camera or a phone, or record that shot separately with Kin closed.
- Leave the **Expression mirror** off unless you want to show the animated emoji (the Expression card then shows a 3D emoji and the expression name, "visible expression, not a feeling"). The positioning card is text in the rail; the self-view itself has no overlay. A correctly framed session shows the quiet **Good position** state.
- If the SDK shows a validation warning, fix the position and wait. Do not edit in a fake signal. A cut is fine; a substituted signal is not.

## Shot list

| Time | Screen | What you do | What you say |
| --- | --- | --- | --- |
| 0:00–0:10 | Consent screen | Start on the consent card. Move the pointer over the camera consent text, then leave it still. | "This is Kin. It is an Electron app that uses Presage SmartSpectra to drive a portrait from live pulse and breathing. I am recording the screen with a separate recorder. Kin itself does not record." |
| 0:10–0:25 | Consent screen | Check **I agree** under **Camera + pulse + breathing**. Leave the **Expression mirror** switch off. Check the general-wellness acknowledgement. Click **I consent — continue**. | "The camera is gated by consent. I am agreeing to camera, pulse, and breathing measurement, and I understand this is a general-wellness estimate, not a diagnosis. The expression mirror stays off. Positioning text stays in the rail and quiet when I am framed." |
| 0:25–0:40 | Camera opens | After consent, let the camera open. | "The release build bundles my SmartSpectra demo key, so there is no key screen and no sign-up. The source repository contains no key. The camera is opening now." |
| 0:40–0:55 | Studio and portrait | Keep your face, shoulders, and upper chest in frame. Point to the clean self-view and the positioning card in the rail. Show both panels. | "This is the live SDK self-view, with no face circle, guide lines, or text over the video. The positioning card in the rail tells me what to fix if I drift out. The portrait receives only derived movement values, not camera frames. I am in front of the camera now; there is no pre-recorded signal." |
| 0:55–1:15 | Studio | Sit still. Point to the validation line if it changes. If the positioning card changes, pause long enough for the viewer to read it. Wait for breathing first, then pulse. Keep the session clock and at least one live number or trace in view so the signal is visibly changing. | "SmartSpectra gives validation hints. I sit about 50 to 90 centimetres away with my chest in frame. If I drift out, Kin shows what to fix in the rail. Breathing usually appears before pulse. The portrait stays still until there is a fresh signal." |
| 1:15–1:40 | Studio and portrait | Point to the pulse and breathing cards. Let the pulse light repeat. Keep the expression mirror off. | "The pulse and breathing numbers are live from SmartSpectra. The small light at the sternum is paced by the measured pulse, and the breathing trace shows what the SDK is receiving. If a signal is missing, the number stays blank and the portrait holds still. I am not using the expression mirror, so there are no emotion labels here." |
| 1:40–1:55 | Privacy panel | Click **Privacy & data**. Scroll slowly to **Presage network requests** and **Retention & deletion**. Then click **Done**. (Optional: before this, open **Camera settings** for a second and close it.) | "Kin records nothing and uploads no frames, audio, or measurements. The only thing it saves is your camera settings. The native SDK authenticates with Presage and downloads encrypted models. Those requests can include the key and session usage metadata, but not frames, audio, or measurements. Telemetry is off. The README lists the technical caches and how to delete them." |
| 1:55–2:05 | Ending | Click **End**. In the confirmation, click **End session**. Let the consent screen return. | "End stops the camera and clears the in-memory key. There is no Kin account or cloud copy to delete." |
| 2:05–2:15 | Consent screen or repository README | Keep the consent screen up, or show the repository README without scrolling a key into view. Stop the recording. | "The code, setup instructions, and Windows build are in the public repository linked below. Download the installer or portable from the Releases page and it runs with no key. Kin is not a medical device." |

## Follow-up lines for the YouTube description

Use these in the description or captions if needed:

- Kin uses `@smartspectra/node-sdk` in Electron's main process. In the default Reliable mode the live self-view is the SDK's processed `videoOutput` and the renderer never opens the camera; the optional Smooth preview mode opens the camera in the studio window, video only, and stays on the device.
- Metrics: chest breathing trace (`0`), breathing rate (`2`), and pulse rate (`15`). Kin does not request the arterial-pressure trace (`16`); it pulls a separate native model and caused self-view lag at pulse onset, so the portrait paces its light from the measured pulse rate instead. Optional expression metrics: blinking (`12`), talking (`13`), expressions (`14`). No facial landmarks.
- No Kin account. The Windows release bundles the author's SmartSpectra demo key so judges can try Kin without signing up; running from source needs your own key. The source repository contains no key.
- No diagnosis, treatment, or medical decision-making. No emotion or stress claims.
- Consent gate; expression mirror off by default; local-only processing; no recordings or uploads by Kin; SDK telemetry disabled.
- Setup and judge instructions: link to the repository README and the DEV post.
- Demo recorded with vokoscreenNG. Kin did not record the demo.

## Editing check

Before upload, verify:

- [ ] The video shows the live self-view and the live pulse/breathing values at the same time.
- [ ] The key is never readable. The release build skips the key screen; do not show `.env`, `kin.key`, or their folders.
- [ ] The expression mirror is visibly off (or, if shown, the emoji is labelled as a visible expression, not a feeling).
- [ ] The clean self-view and the rail positioning card are visible, and the self-view has no text or markings over it. No audio or synthesized speech is presented as part of Kin.
- [ ] The session clock is running, and at least one live value or trace changes on screen; the camera self-view shows the live participant.
- [ ] The consent screen and the privacy panel are visible.
- [ ] The ending shows the camera stopping or the consent screen returning.
- [ ] There is no claim of diagnosis, treatment, emotion detection, or stress detection.
- [ ] The repository link in the description opens without a login.
- [ ] The video is public or unlisted with link access, not private. The challenge judges must be able to open it.
- [ ] The title and description include `#presagechallenge`.
