// saber.js
import { THREE } from './scene.js';
import { DEBUG } from './config.js';

export const SABER_LENGTH = 1.0;
export const SABER_EFFECTIVE_RADIUS = SABER_LENGTH * 0.5;

export class Saber {
  constructor(scene, camera, renderer, isXR, handedness = 'right', audioListener = null) {
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

    // --- AUDIO DELLA SPADA (SINTETIZZATO) ---
    this.audio = null;
    this.oscillator = null;
    this.gainNode = null;
    this.audioContext = null;
    this.smoothedSpeed = 0;
    this._prevPosForAudio = new THREE.Vector3();
    this._curPosForAudio = new THREE.Vector3();

    if (this.audioListener) {
      const audio = new THREE.PositionalAudio(this.audioListener);
      const context = this.audioListener.context;

      // Oscillatore "grezzo" tipo hum di spada
      const osc = context.createOscillator();
      const gain = context.createGain();

      // Timbro base: prova triangle o sawtooth
      osc.type = 'sawtooth';        // 'triangle' se lo vuoi più morbido
      osc.frequency.value = 90;     // Hz base, regoliamo in update()

      // Volume iniziale molto basso, per non spaccare le orecchie
      gain.gain.value = 0.2;

      // Catena: osc -> gain -> PositionalAudio
      osc.connect(gain);
      audio.setNodeSource(gain);

      audio.setRefDistance(1.5);
      audio.setRolloffFactor(1.0);

      this.holder.add(audio);

      // Avvia il sintetizzatore
      osc.start();

      this.audio = audio;
      this.oscillator = osc;
      this.gainNode = gain;
      this.audioContext = context;

      // posizione iniziale per il calcolo velocità
      this.getBladeWorldPosition(this._prevPosForAudio);
    }

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

  update(dt) {
    if (!this.audio || dt <= 0) return;

    // calcola velocità della lama
    this.getBladeWorldPosition(this._curPosForAudio);

    const vel = this._curPosForAudio
      .clone()
      .sub(this._prevPosForAudio)
      .divideScalar(dt);

    const speed = vel.length(); // m/s circa, in unità della scena

    // smoothing (per evitare "tremolio" di volume/pitch)
    const smoothing = 1 - Math.exp(-6 * dt); // costante ~6 = reattivo ma non isterico
    this.smoothedSpeed =
      this.smoothedSpeed +
      (speed - this.smoothedSpeed) * smoothing;

    // mappa la velocità a volume + pitch
    const minSpeed = 0.0;
    const maxSpeed = 4.0; // oltre questo consideriamo “veloce”
    const tRaw = (this.smoothedSpeed - minSpeed) / (maxSpeed - minSpeed);
    const t = THREE.MathUtils.clamp(tRaw, 0, 1);

    const baseVolume = 0.25;
    const maxVolume = 0.9;
    const volume = baseVolume + (maxVolume - baseVolume) * t;

    const basePitch = 0.9;
    const maxPitch = 1.6;
    const playbackRate = basePitch + (maxPitch - basePitch) * t;

    if (this.audio.isPlaying) {
      this.audio.setVolume(volume);
      this.audio.setPlaybackRate(playbackRate);
    }

    this._prevPosForAudio.copy(this._curPosForAudio);
  }
}
