# Kin demo video script

Target length: 2:10 to 2:20. This keeps the live session short and leaves time to cut a bad take. The video should be recorded with vokoscreenNG, with Kin's screen visible. See `recording-guide.md` for the vokoscreenNG setup and the webcam conflict.

The spoken lines below are written to be read at a normal pace. They are not a voice-over script that has to be followed word for word. Keep the screen actions in order.

## Before recording

- Use a temporary SmartSpectra demo key. Do not use your main key. Rotate or delete the demo key after the video.
- Do not click **Show** in the key field. The field is a password field, so the key stays masked. If you paste it, clear the clipboard afterward.
- Put the Kin studio and the portrait window on the same display. The recording captures the whole display, so both windows must be visible.
- Close other apps and notifications. Do not show email, browser tabs, or a key.
- Set the display to 1920×1080 if possible. Kin is designed for a 1280-wide studio plus a portrait panel.
- Start from a fresh launch with the consent screen showing. Do not start from a session that has already been running.
- Check the microphone with a 10-second test recording.
- Do not enable the same webcam in vokoscreenNG while Kin is measuring. Kin owns the camera through the native SDK. The face on screen is Kin's live self-view. If you want a separate talking-head shot, use a second camera or a phone, or record that shot separately with Kin closed.
- If the SDK shows a validation warning, fix the position and wait. Do not edit in a fake signal. A cut is fine; a substituted signal is not.

## Shot list

| Time | Screen | What you do | What you say |
| --- | --- | --- | --- |
| 0:00–0:10 | Consent screen | Start on the consent card. Move the pointer over the camera consent text, then leave it still. | "This is Kin. It is an Electron app that uses Presage SmartSpectra to drive a portrait from live pulse and breathing. I am recording the screen with a separate recorder. Kin itself does not record." |
| 0:10–0:25 | Consent screen | Check **I agree** under **Camera + pulse + breathing**. Leave the **Expression mirror** switch off. Check the general-wellness acknowledgement. Click **I consent — continue**. | "The camera is gated by consent. I am agreeing to camera, pulse, and breathing measurement, and I understand this is a general-wellness estimate, not a diagnosis. The expression mirror stays off." |
| 0:25–0:40 | Key prompt | Paste the temporary key into the masked field. Do not click **Show**. Click **Begin listening**. | "Kin has no account. It needs a free SmartSpectra key. I paste it here. The field masks it, and the key stays in memory for this session. It is not written to disk or included in the repository." |
| 0:40–0:55 | Studio and portrait | Let the camera open. Keep your face, shoulders, and upper chest in frame. Show both windows with the pointer. | "This is the live SDK self-view on the left. The portrait is a separate window on the right. It receives only derived movement values, not camera frames. I am in front of the camera now; there is no pre-recorded signal." |
| 0:55–1:15 | Studio | Sit still. Point to the validation line if it changes. Wait for breathing first, then pulse. Do not talk over the SDK warm-up for too long. | "SmartSpectra gives validation hints. I sit about 50 to 90 centimetres away with my chest in frame. Breathing usually appears before pulse. The portrait stays still until there is a fresh signal." |
| 1:15–1:40 | Studio and portrait | Point to the pulse and breathing cards. Let the portrait move. Keep the expression mirror off. | "The pulse and breathing numbers are live from SmartSpectra. The chest trace moves the bust, and the arterial-pressure trace drives the light at the sternum. If a signal is missing, the number stays blank and the portrait stops. I am not using the expression mirror, so there are no emotion labels here." |
| 1:40–1:55 | Privacy panel | Click **Privacy & data**. Scroll slowly to **Presage network requests** and **Retention & deletion**. Then click **Done**. | "Kin records nothing and uploads nothing. The native SDK authenticates with Presage and downloads encrypted models. Those requests can include the key and session usage metadata, but not frames, audio, or measurements. Telemetry is off. The README lists the technical caches and how to delete them." |
| 1:55–2:05 | Ending | Click **End**. In the confirmation, click **End session**. Let the consent screen return. | "End stops the camera and clears the in-memory key. There is no Kin account or cloud copy to delete." |
| 2:05–2:15 | Consent screen or repository README | Keep the consent screen up, or show the repository README without scrolling a key into view. Stop the recording. | "The code, setup instructions, and Windows build are in the public repository linked below. Judges can use a free SmartSpectra key. Kin is not a medical device." |

## Follow-up lines for the YouTube description

Use these in the description, not in the voice-over unless you need them:

- Kin uses `@smartspectra/node-sdk` in Electron's main process. The live self-view is the SDK's processed `videoOutput`; the renderer never opens the camera.
- Metrics: chest breathing trace (`0`), breathing rate (`2`), pulse rate (`15`), arterial-pressure trace (`16`). Optional expression metrics: blinking (`12`), talking (`13`), expressions (`14`). No facial landmarks.
- No Kin account. A free SmartSpectra key is required. Public installers contain no key.
- No diagnosis, treatment, or medical decision-making. No emotion or stress claims.
- Consent gate; expression mirror off by default; local-only processing; no recordings or uploads by Kin; SDK telemetry disabled.
- Setup and judge instructions: link to the repository README and the DEV post.
- Demo recorded with vokoscreenNG. Kin did not record the demo.

## Editing check

Before upload, verify:

- [ ] The video shows the live self-view and the live pulse/breathing values at the same time.
- [ ] The key is never readable. The field shows dots only.
- [ ] The expression mirror is visibly off.
- [ ] The consent screen and the privacy panel are visible.
- [ ] The ending shows the camera stopping or the consent screen returning.
- [ ] There is no claim of diagnosis, treatment, emotion detection, or stress detection.
- [ ] The repository link in the description opens without a login.
- [ ] The video is public or unlisted with link access, not private. The challenge judges must be able to open it.
- [ ] The title and description include `#presagechallenge`.
