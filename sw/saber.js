// saber.js
import { THREE } from './scene.js';
import { DEBUG } from './config.js';

export const SABER_LENGTH = 1.0;
export const SABER_EFFECTIVE_RADIUS = SABER_LENGTH * 0.5;

export class Saber {
  constructor(scene, camera, renderer, isXR, handedness = 'right') {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.isXR = isXR;

    this.bladeThickness = 0.03;

    // --- crea geometria lama + impugnatura ---
    const bladeGeo = new THREE.CylinderGeometry(
      this.bladeThickness,
      this.bladeThickness,
      SABER_LENGTH,
      12
    );
    const bladeMat = new THREE.MeshBasicMaterial({
      color: 0x66ccff,
      transparent: true,
      opacity: 0.9,
    });
    this.blade = new THREE.Mesh(bladeGeo, bladeMat);

    const hiltGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.2, 12);
    const hiltMat = new THREE.MeshPhongMaterial({ color: 0x444444 });
    this.hilt = new THREE.Mesh(hiltGeo, hiltMat);

    this.holder = new THREE.Group();
    this.holder.add(this.hilt);
    this.holder.add(this.blade);

    // posizionamento relativo
    this.hilt.position.set(0, 0, 0);
    this.blade.position.set(0, 0.6, 0);

    // attach
    if (isXR) {
      // Usa detection della mano giusta
      this._attachToXRController(handedness);
    } else {
      camera.add(this.holder);
      scene.add(camera);
      this.holder.position.set(0.25, -0.25, -0.5);
    }

    // temp
    this._tmpPos = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
  }

  _attachToXRController(handedness) {
    const renderer = this.renderer;
    const scene = this.scene;

    for (let i = 0; i < 2; i++) {
      const c = renderer.xr.getController(i);
      scene.add(c);
      c.addEventListener('connected', (evt) => {
        const input = evt.data;
        if (input && input.handedness === handedness) {
          c.add(this.holder);
          if (DEBUG) console.log(`Spada agganciata alla mano ${handedness} (controller ${i})`);
        }
      });
    }
  }

  getBladeWorldPosition(target = this._tmpPos) {
    this.blade.getWorldPosition(target);
    return target;
  }

  getBladeWorldDirection(target = this._tmpDir) {
    // Asse Y locale della lama
    target.set(0, 1, 0);
    this.blade.getWorldQuaternion(this._tmpQuat);
    target.applyQuaternion(this._tmpQuat).normalize();
    return target;
  }
}
