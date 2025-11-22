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
    if (
      !this.audio ||
      !this.audioContext ||
      !this.gainNode ||
      !this.filter ||
      !this.oscMain1 ||
      !this.oscMain2 ||
      !this.oscSub ||
      dt <= 0
    ) {
      return;
    }

    // In alcuni ambienti l'AudioContext parte "suspended"
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    // Calcola velocità della lama
    this.getBladeWorldPosition(this._curPosForAudio);

    const vel = this._curPosForAudio
      .clone()
      .sub(this._prevPosForAudio)
      .divideScalar(dt);

    const speed = vel.length();

    // Smoothing
    const smoothing = 1 - Math.exp(-6 * dt);
    this.smoothedSpeed =
      this.smoothedSpeed +
      (speed - this.smoothedSpeed) * smoothing;

    // Normalizza velocità in [0,1]
    const minSpeed = 0.0;
    const maxSpeed = 4.0;
    const tRaw = (this.smoothedSpeed - minSpeed) / (maxSpeed - minSpeed);
    const t = THREE.MathUtils.clamp(tRaw, 0, 1);

    const now = this.audioContext.currentTime;

    // Volume globale (gain)
    const baseGain = 0.15;
    const maxGain = 0.6;
    const gainValue = baseGain + (maxGain - baseGain) * t;
    this.gainNode.gain.setTargetAtTime(gainValue, now, 0.03);

    // Cutoff del filtro: più veloce = più brillante/aggressivo
    const baseCutoff = 500;   // Hz con spada ferma
    const maxCutoff = 2500;   // Hz con swing forte
    const cutoffValue = baseCutoff + (maxCutoff - baseCutoff) * t;
    this.filter.frequency.setTargetAtTime(cutoffValue, now, 0.03);

    // Un po' di movimento di pitch, ma senza esagerare (per non diventare caricatura)
    const baseFreq = 110;   // "nota" di base
    const maxFreq = 160;    // con swing
    const mainFreq = baseFreq + (maxFreq - baseFreq) * t;

    // Piccolissimo vibrato lento
    const vibratoAmt = 2;   // Hz di escursione
    const vibratoSpeed = 3; // Hz oscillazione vibrato
    const vibrato =
      Math.sin(now * vibratoSpeed * 2 * Math.PI) * vibratoAmt;

    const finalFreq1 = mainFreq + vibrato;
    const finalFreq2 = mainFreq * 1.02 + vibrato;

    this.oscMain1.frequency.setTargetAtTime(finalFreq1, now, 0.05);
    this.oscMain2.frequency.setTargetAtTime(finalFreq2, now, 0.05);

    // Sub segue più lentamente, meno escursione
    const subBase = baseFreq / 2;
    const subMax = maxFreq / 2;
    const subFreq = subBase + (subMax - subBase) * t * 0.6;
    this.oscSub.frequency.setTargetAtTime(subFreq, now, 0.07);

    // Aggiorna posizione precedente
    this._prevPosForAudio.copy(this._curPosForAudio);
  }

}
