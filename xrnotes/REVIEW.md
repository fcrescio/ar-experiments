# XR Notes Review

## Functionality Overview
- WebXR AR scene bootstrapped with Three.js and a reticle updated from hit-test results for grounded note placement.
- Session label persisted in `localStorage` and shown on page load to help correlate captured notes.
- Notes are colored spheres placed either at the reticle or controller position, labeled sequentially (Note 1, Note 2, ...). Selecting notes connects them with lines, allows audio playback of stored clips, and highlights hover targets.
- Long-press/select-start triggers microphone recording on a note; stop releases the stream and assigns decoded audio to the note for playback. Recording now adds a pulsing emissive glow to the target note and updates a HUD label while active.【F:xrnotes/js/main.js†L24-L55】【F:xrnotes/js/recording.js†L1-L78】
- Left-hand controller gains an attached recall panel listing notes with "Recall" buttons to reposition notes in front of the camera; the panel now highlights hovered buttons and refreshes when notes are added/removed.【F:xrnotes/js/panel.js†L33-L70】
- Notes, lines, and recorded audio are persisted in IndexedDB (including audio blobs and the note counter) and restored on reload/session restart, keeping captures available across immersive entries.【F:xrnotes/js/storage.js†L1-L142】【F:xrnotes/js/main.js†L56-L183】

## Current Gaps & Risks
- **Flat HUD disappears in AR.** Status/recording labels live in the DOM (`#status`, `#recording`) and are not rendered inside the immersive AR session, so the user still lacks in-headset confirmation of readiness or recording state beyond the subtle note glow.【F:xrnotes/index.html†L17-L21】【F:xrnotes/js/main.js†L16-L34】
- **Controls are still opaque in-headset.** There is no in-AR keybind legend explaining that: (a) `select`/trigger places a note at the reticle, (b) pressing the configured primary gamepad button places at the controller, (c) recording starts on `selectstart` over an existing note, and (d) recording cancel is bound to `buttons[1]`. Users must guess these flows.
- **Trigger can still double-place notes.** The primary action button now falls back across indices and can be cached per hand, but it defaults to buttons that overlap the trigger on many controllers; pressing the trigger therefore fires both the select handler (reticle placement) and the action button path (controller placement), recreating the duplicate-note issue the user reported.【F:xrnotes/js/interactions.js†L60-L112】
- **Recording remains hover-gated and permission-heavy.** Capture only starts on `selectstart` while hovering a note; if hover detection misses or microphone permission is denied, the flow silently fails in-headset because errors surface only to the DOM status element. This matches the report of being unable to record a note without clear feedback.【F:xrnotes/js/interactions.js†L82-L91】【F:xrnotes/js/recording.js†L13-L78】

## Proposed Follow-up Tasks
- Render minimal XR-space UI (floating text/icon or controller-attached badge) for status/recording so headset users can confirm readiness and active capture without leaving AR.
- Add an in-AR controls panel/tooltips enumerating placement, recording, recall, and cancel bindings.
- Decouple note placement actions so trigger `select` and primary button do not both spawn notes on the same press; consider gating the controller-placement path behind a distinct button or long-press.
- Surface recording and permission failures inside the headset (e.g., transient toast in AR) and provide an alternate start action when hover/selectstart is unreliable.
