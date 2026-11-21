# Kin demo video script

Target length: 2:10 to 2:20. This keeps the live session short and leaves time to cut a bad take. The video should be recorded with vokoscreenNG, with Kin's screen visible. See `recording-guide.md` for the vokoscreenNG setup and the webcam conflict.

The narration lines below are optional. Keep the screen actions in order; the app itself has no synthesized voice.

## Before recording

- Use the private keyed demo build. It reads a local `kin.key` beside the executable, so no key screen appears. Do not show the key file, its folder, or the path in the recording. The public repository and public installer contain no key.
- Use a trial key that still has credits. If the key screen or studio reports **no credits left**, stop and obtain a fresh key before recording; Kin cannot bypass Presage usage limits.
- Keep the keyed package private; anyone who receives it can extract the key. If you share a keyed package with judges, keep that key active through judging and rotate it afterward. If the demo and judging keys are separate, rotate the demo key after recording.
- Put the Kin studio where the portrait and self-view are both visible. The default studio keeps them side by side; the optional companion window is not needed for the recording. The recording captures the whole display, so both panels must be visible.
- Close other apps and notifications. Do not show email, browser tabs, or a key.
- Set the display to 1920×1080 if possible. Kin is designed for a 1280-wide studio plus a portrait panel.
- Start from a fresh launch with the consent screen showing. Do not start from a session that has already been running.
- Keep microphone and desktop-audio capture off in vokoscreenNG. The demo is screen-only; Kin has no synthesized speech or app audio.
- Do not enable the same webcam in vokoscreenNG while Kin is measuring. Kin owns the camera through the native SDK. The face on screen is Kin's live self-view. If you want a separate talking-head shot, use a second camera or a phone, or record that shot separately with Kin closed.
- Leave the **Expression mirror** off. The positioning alert is on-screen text inside the self-view; a correctly framed session shows only the quiet **Good position** state.
- If the SDK shows a validation warning, fix the position and wait. Do not edit in a fake signal. A cut is fine; a substituted signal is not.

## Shot list

| Time | Screen | What you do | What you say |
| --- | --- | --- | --- |
| 0:00–0:10 | Consent screen | Start on the consent card. Move the pointer over the camera consent text, then leave it still. | "This is Kin. It is an Electron app that uses Presage SmartSpectra to drive a portrait from live pulse and breathing. I am recording the screen with a separate recorder. Kin itself does not record." |
| 0:10–0:25 | Consent screen | Check **I agree** under **Camera + pulse + breathing**. Leave the **Expression mirror** switch off. Check the general-wellness acknowledgement. Click **I consent — continue**. | "The camera is gated by consent. I am agreeing to camera, pulse, and breathing measurement, and I understand this is a general-wellness estimate, not a diagnosis. The expression mirror stays off. The positioning alert is text-only and stays quiet when I am framed." |
| 0:25–0:40 | Camera opens | After consent, let the camera open. Keep the key file and its folder off screen. | "This private demo build gets the SmartSpectra key from a local operator-key file, so there is no key screen. The key is not in the public repository or public installer. The camera is opening now." |
| 0:40–0:55 | Studio and portrait | Keep your face, shoulders, and upper chest in frame. Point to the **FACE** and **CHEST** guide lines, then the text alert. Show both panels. | "This is the live SDK self-view, with a quiet face-and-chest viewfinder instead of a face circle. The text alert tells me what to fix if I drift out. The portrait on the right receives only derived movement values, not camera frames. I am in front of the camera now; there is no pre-recorded signal." |
| 0:55–1:15 | Studio | Sit still. Point to the validation line if it changes. If the text alert changes, pause long enough for the viewer to read it. Wait for breathing first, then pulse. Keep the session clock and at least one live number or trace in view so the signal is visibly changing. | "SmartSpectra gives validation hints. I sit about 50 to 90 centimetres away with my chest in frame. If I drift out, Kin shows what to fix in the self-view alert. Breathing usually appears before pulse. The portrait stays still until there is a fresh signal." |
| 1:15–1:40 | Studio and portrait | Point to the pulse and breathing cards. Let the pulse light repeat. Keep the expression mirror off. | "The pulse and breathing numbers are live from SmartSpectra. The small light at the sternum is paced by the measured pulse, and the traces show what the SDK is receiving. If a signal is missing, the number stays blank and the portrait holds still. I am not using the expression mirror, so there are no emotion labels here." |
| 1:40–1:55 | Privacy panel | Click **Privacy & data**. Scroll slowly to **Presage network requests** and **Retention & deletion**. Then click **Done**. | "Kin records nothing and uploads no frames, audio, or measurements. The native SDK authenticates with Presage and downloads encrypted models. Those requests can include the key and session usage metadata, but not frames, audio, or measurements. Telemetry is off. The README lists the technical caches and how to delete them." |
| 1:55–2:05 | Ending | Click **End**. In the confirmation, click **End session**. Let the consent screen return. | "End stops the camera and clears the in-memory key. There is no Kin account or cloud copy to delete." |
| 2:05–2:15 | Consent screen or repository README | Keep the consent screen up, or show the repository README without scrolling a key into view. Stop the recording. | "The code, setup instructions, and Windows build are in the public repository linked below. The public build uses a free SmartSpectra key; the private keyed judging build skips that screen. Kin is not a medical device." |

## Follow-up lines for the YouTube description

Use these in the description or captions if needed:

- Kin uses `@smartspectra/node-sdk` in Electron's main process. The live self-view is the SDK's processed `videoOutput`; the renderer never opens the camera.
- Metrics: chest breathing trace (`0`), breathing rate (`2`), pulse rate (`15`), arterial-pressure trace (`16`). Optional expression metrics: blinking (`12`), talking (`13`), expressions (`14`). No facial landmarks.
- No Kin account. The public build uses a free SmartSpectra key; the private keyed judging build supplies an operator key at runtime. The public repository and public installer contain no key.
- No diagnosis, treatment, or medical decision-making. No emotion or stress claims.
- Consent gate; expression mirror off by default; local-only processing; no recordings or uploads by Kin; SDK telemetry disabled.
- Setup and judge instructions: link to the repository README and the DEV post.
- Demo recorded with vokoscreenNG. Kin did not record the demo.

## Editing check

Before upload, verify:

- [ ] The video shows the live self-view and the live pulse/breathing values at the same time.
- [ ] The key is never readable. The keyed build skips the key screen; do not show `kin.key`, its folder, or its path.
- [ ] The expression mirror is visibly off.
- [ ] The face-and-chest viewfinder and the on-screen alert are visible. No audio or synthesized speech is presented as part of Kin.
- [ ] The session clock is running, and at least one live value or trace changes on screen; the camera self-view shows the live participant.
- [ ] The consent screen and the privacy panel are visible.
- [ ] The ending shows the camera stopping or the consent screen returning.
- [ ] There is no claim of diagnosis, treatment, emotion detection, or stress detection.
- [ ] The repository link in the description opens without a login.
- [ ] The video is public or unlisted with link access, not private. The challenge judges must be able to open it.
- [ ] The title and description include `#presagechallenge`.
