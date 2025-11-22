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
    this.audioListener = audioListener;

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

    // --- AUDIO DELLA SPADA (SINTETIZZATO, MULTI-OSC + FILTRO) ---
    this.audio = null;
    this.oscMain1 = null;
    this.oscMain2 = null;
    this.oscSub = null;
    this.filter = null;
    this.gainNode = null;
    this.audioContext = null;
    this.smoothedSpeed = 0;
    this._prevPosForAudio = new THREE.Vector3();
    this._curPosForAudio = new THREE.Vector3();

    if (this.audioListener) {
      const audio = new THREE.PositionalAudio(this.audioListener);
      const context = this.audioListener.context;

      this.audioContext = context;

      // Oscillatori principali (due saw detunati)
      const osc1 = context.createOscillator();
      const osc2 = context.createOscillator();
      const sub = context.createOscillator();

      osc1.type = 'sawtooth';
      osc2.type = 'sawtooth';
      sub.type = 'sine';

      // Frequenze base (regolate in update(), ma mettiamo dei default)
      osc1.frequency.value = 110;       // A2 circa
      osc2.frequency.value = 110 * 1.02; // leggermente detunato
      sub.frequency.value = 55;         // un'ottava sotto

      // Filtro low-pass per togliere digitale cattivo
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 800;     // Hz iniziale
      filter.Q.value = 1.0;            // risonanza moderata

      // Mix osc -> filter
      osc1.connect(filter);
      osc2.connect(filter);
      sub.connect(filter);

      // Gain globale (volume della spada)
      const gain = context.createGain();
      gain.gain.value = 0.2; // base, verrà modulato

      filter.connect(gain);
      audio.setNodeSource(gain);

      audio.setRefDistance(1.5);
      audio.setRolloffFactor(1.0);

      this.holder.add(audio);

      // Avvia gli oscillatori
      osc1.start();
      osc2.start();
      sub.start();

      this.audio = audio;
      this.oscMain1 = osc1;
      this.oscMain2 = osc2;
      this.oscSub = sub;
      this.filter = filter;
      this.gainNode = gain;

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
    // Assicurati che tutto l’audio sia inizializzato
    if (!this.audio || !this.oscillator || !this.gainNode || !this.audioContext || dt <= 0) return;

    // Se l’AudioContext è sospeso, prova a resumerlo (dopo l’interazione XR dovrebbe andare)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

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

    // mappa la velocità a volume + frequenza
    const minSpeed = 0.0;
    const maxSpeed = 4.0; // oltre questo consideriamo “veloce”
    const tRaw = (this.smoothedSpeed - minSpeed) / (maxSpeed - minSpeed);
    const t = THREE.MathUtils.clamp(tRaw, 0, 1);

    const baseGain = 0.15;
    const maxGain = 0.7;
    const gainValue = baseGain + (maxGain - baseGain) * t;

    const baseFreq = 90;    // Hz base
    const maxFreq = 220;    // Hz max
    const freqValue = baseFreq + (maxFreq - baseFreq) * t;

    const now = this.audioContext.currentTime;
    this.gainNode.gain.setTargetAtTime(gainValue, now, 0.03);
    this.oscillator.frequency.setTargetAtTime(freqValue, now, 0.03);

    this._prevPosForAudio.copy(this._curPosForAudio);
  }

}
