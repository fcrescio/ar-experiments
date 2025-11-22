// xr.js
import { USE_XR, USE_PASSTHROUGH, DEBUG } from './config.js';
import { THREE } from './scene.js';

import { VRButton } from 'https://unpkg.com/three@0.161.0/examples/jsm/webxr/VRButton.js';
import { ARButton } from 'https://unpkg.com/three@0.161.0/examples/jsm/webxr/ARButton.js';
import { OrbitControls } from 'https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js';

/**
 * Imposta o WebXR o modalità "flat".
 * Ritorna un oggetto:
 *   { isXR: boolean, update: (dt) => void }
 */
export function setupXROrFlat(renderer, camera) {
  // Se da config vogliamo XR, e il browser lo supporta:
  if (USE_XR && 'xr' in navigator) {
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');

    if (USE_PASSTHROUGH) {
      // immersive-AR (passthrough) – se il visore/browser lo supporta,
      // vedrai il mondo reale dietro agli oggetti 3D.
      const btn = ARButton.createButton(renderer, {
        requiredFeatures: ['local-floor'],
      });
      document.body.appendChild(btn);
      if (DEBUG) console.log('XR: immersive-AR (passthrough) richiesto');
    } else {
      const btn = VRButton.createButton(renderer);
      document.body.appendChild(btn);
      if (DEBUG) console.log('XR: immersive-VR richiesto');
    }

    return {
      isXR: true,
      update: () => {}, // in XR non usiamo OrbitControls
    };
  }

  // Fallback: niente XR, uso 3D classico + OrbitControls
  if (DEBUG && USE_XR && !('xr' in navigator)) {
    console.warn('WebXR richiesto ma non supportato, uso modalità flat.');
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.6, 0);
  controls.update();

  return {
    isXR: false,
    update: () => controls.update(),
  };
}
