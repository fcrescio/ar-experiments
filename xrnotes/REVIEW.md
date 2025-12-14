# XR Notes Review

## Functionality Overview
- WebXR AR scene bootstrapped with Three.js, featuring a visible reticle from hit-test results for grounded note placement.
- Session label persisted in `localStorage` and shown on page load to help correlate captured notes.
- Notes are colored spheres placed either at the reticle or controller position, labeled sequentially (Note 1, Note 2, ...).
- Selecting notes connects them with lines, allows audio playback of stored clips, and highlights hover targets.
- Long-press/select-start triggers microphone recording on a note; stop releases the stream and assigns decoded audio to the note for playback.
- Left-hand controller gains an attached recall panel listing notes with "Recall" buttons to reposition notes in front of the camera; panel updates as notes are added/removed.
- Controllers support placing notes via trigger/select and button A, while continual raycasts maintain hover state and panel hit-testing.

## Weak Points & Potential Bugs
- **No persistence of notes/audio across sessions.** All geometry and decoded audio buffers live in memory only; refreshing or restarting an AR session drops the capture, which limits usefulness for field notes.
- **Recording UX lacks in-scene feedback.** Recording state is only logged to the console/status helper; there is no visual indicator (e.g., material glow/timer) on the note or controller to show active capture.
- **Panel hit-test can override note hover without visual differentiation.** `updateControllers` replaces controller hover with panel hits but uses the same highlight logic; panel buttons never highlight, so users get no feedback about recall targets.
- **Controller button mapping is hard-coded to `buttons[4]`.** Different XR gamepads may map A/primary buttons elsewhere; the current check could miss presses or misfire on other hardware.
- **Hit-test source not cleared on navigation errors.** If `requestHitTestSource` fails (e.g., permissions denied), `hitTestSourceRequested` stays true and reticle never appears, with no error surfaced to the user.

## Proposed Follow-up Tasks
- Add local persistence (e.g., IndexedDB) to serialize note positions, connections, and audio blobs, restoring them on reload and AR session restart.
- Provide visible recording state (material pulse, HUD timer, or waveform icon) and a way to cancel/stop recording without releasing the trigger.
- Distinguish panel interactions with hover/active styling and separate raycast state so controller highlights don't disappear when aiming at the menu.
- Make controller button mapping configurable per handedness and fall back to primary action buttons, improving compatibility across XR devices.
- Surface hit-test setup failures with on-screen messaging and retry logic to avoid silent reticle loss when hit-test acquisition fails.
