# Project Review: `sw`

## Overview
This WebXR “Drone Training” prototype is modular and readable, with clear separation between rendering (scene/camera), XR setup, and gameplay entities (saber, drone, HUD). The in-code comments are thorough and help clarify intent. Below are priority issues and opportunities to strengthen robustness and user experience.

## Findings & Recommended Tasks
1. ✅ **Bolt–player collision can miss fast shots.** Player hits now use swept collision against the player capsule/sphere along the bolt’s full frame path to avoid tunneling misses.【F:sw/drone.js†L437-L510】
2. ✅ **Drone gameplay stalls if the GLB fails to load.** A timed fallback now swaps in a lightweight placeholder mesh, sets `ready=true`, and shows a visible warning when the GLB is slow or fails so the encounter can still start.【F:sw/drone.js†L8-L84】【F:sw/drone.js†L703-L732】
3. ✅ **Score HUD is easy to lose in XR space.** The HUD now follows the camera with smoothed, clamped distance and a slight vertical offset, keeping stats anchored in view without manual repositioning in XR or flat modes.【F:sw/hud3d.js†L5-L84】【F:sw/game.js†L14-L32】
4. ✅ **XR passthrough defaults can produce transparent canvas in flat mode.** Renderer and scene setup now gate passthrough alpha and background removal on actual WebXR support, keeping the canvas opaque when XR isn’t available while retaining passthrough visuals when it is.【F:sw/scene.js†L8-L64】
5. **Audio nodes lack teardown on XR session end/page unload.** Saber oscillators and positional audio nodes run indefinitely once started, with no stop/disconnect path when leaving XR or tearing down the scene, potentially leaking AudioContext resources. Add lifecycle management to stop oscillators and remove audio nodes when sessions end or on cleanup hooks.【F:sw/saber.js†L70-L139】【F:sw/drone.js†L449-L732】
