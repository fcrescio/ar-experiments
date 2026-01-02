// saber.js
import { THREE } from './scene.js';
import { DEBUG } from './config.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const SABER_LENGTH = 1.0;
export const SABER_EFFECTIVE_RADIUS = 0.08;

export class Saber {
  constructor(scene, camera, renderer, isXR, handedness = 'right', audioListener = null) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.isXR = isXR;
    this.attachedToController = false;
    this.fallbackAttachedToCamera = false;
    this.audioListener = audioListener;

    this.bladeThickness = 0.012;
    this.bladeFalloffRadius = 0.05;

    // --- crea geometria lama + impugnatura ---
    const bladeGeo = new THREE.CylinderGeometry(
      this.bladeThickness,
      this.bladeThickness,
      SABER_LENGTH,
      24
    );
    const bladeUniforms = {
      time: { value: 0 },
      color: { value: new THREE.Color(0x66ccff) },
      opacity: { value: 0.92 },
      radius: { value: this.bladeFalloffRadius },
      pulseStrength: { value: 0.2 },
    };
    const bladeMat = new THREE.ShaderMaterial({
      uniforms: bladeUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPos;
        void main() {
          vUv = uv;
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 color;
        uniform float opacity;
        uniform float radius;
        uniform float pulseStrength;
        varying vec2 vUv;
        varying vec3 vPos;

        // Cheap 2D noise for shimmer
        float hash(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return fract(sin(p.x + p.y) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        void main() {
          // Radial falloff so the blade edges stay soft
          float radial = clamp(length(vPos.xz) / radius, 0.0, 1.0);
          float core = smoothstep(0.25, 0.0, radial);
          float glow = smoothstep(1.2, 0.1, radial);

          // Subtle taper toward the tip and base for a more organic falloff
          float edgeFade = smoothstep(0.02, 0.12, vUv.y) * (1.0 - smoothstep(0.88, 1.0, vUv.y));

          // Layered pulse: slow breathing + faster micro flicker
          float slowPulse = sin(time * 1.6) * 0.5 + 0.5;
          float fastPulse = noise(vec2(vUv.y * 6.0, time * 12.0));
          float pulse = 1.0 + pulseStrength * (slowPulse * 0.6 + fastPulse * 0.4);

          vec3 finalColor = color * (1.2 * core + 0.45 * glow);

          float alpha = opacity * edgeFade * (core + glow * 0.6) * pulse;
          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
    });
    this.blade = new THREE.Mesh(bladeGeo, bladeMat);
    this.blade.material.uniformsNeedUpdate = true;
    this.bladeMaterial = bladeMat;
    this.bladeUniforms = bladeUniforms;
    this.elapsedTime = 0;

    this.hilt = new THREE.Group();   // placeholder
    this.hiltModelRoot = null;
    this.hiltReady = false;              // diventa true quando il glb è caricato
    // --- CARICAMENTO MODELLO GLB ---
    const loader = new GLTFLoader();
    loader.load(
      'assets/lightsaber_holder.glb',    // path relativo a index.html
      (gltf) => {
        this.hiltModelRoot = gltf.scene;

        // opzionale: scala e orientamento del modello
        this.hiltModelRoot.scale.set(0.2, 0.2, 0.2);    // riduci/ingrandisci
        // se “guarda” nella direzione sbagliata, ruotalo:
        this.hiltModelRoot.rotation.x = Math.PI/2; // ad es. 180°

        this.hilt.add(this.hiltModelRoot);

        this.hiltReady = true;
        if (DEBUG) console.log('Lightsaber GLB caricato');
      },
      undefined,
      (err) => {
        console.error('Errore nel caricamento del lightsaber GLB:', err);
      }
    );


    //const hiltGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.2, 12);
    //const hiltMat = new THREE.MeshPhongMaterial({ color: 0x444444 });
    //this.hilt = new THREE.Mesh(hiltGeo, hiltMat);

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
    this._audioDisposed = false;
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

  dispose() {
    this.disposeAudio();
  }

  disposeAudio() {
    if (this._audioDisposed) return;
    this._audioDisposed = true;

    const oscillators = [this.oscMain1, this.oscMain2, this.oscSub];
    oscillators.forEach((osc) => {
      if (osc) {
        try {
          osc.stop();
        } catch (e) {
          // oscillator might already be stopped
        }
        osc.disconnect();
      }
    });

    if (this.filter) this.filter.disconnect();
    if (this.gainNode) this.gainNode.disconnect();

    if (this.audio) {
      try {
        this.audio.stop();
      } catch (e) {
        // ignore stop errors on already stopped sources
      }
      if (this.audio.parent) {
        this.audio.parent.remove(this.audio);
      }
    }

    this.audio = null;
    this.oscMain1 = null;
    this.oscMain2 = null;
    this.oscSub = null;
    this.filter = null;
    this.gainNode = null;
    this.audioContext = null;
  }

  _attachToXRController(handedness) {
    const renderer = this.renderer;
    const scene = this.scene;

    for (let i = 0; i < 2; i++) {
      const c = renderer.xr.getControllerGrip(i);
      scene.add(c);
      c.addEventListener('connected', (evt) => {
        const input = evt.data;
        if (input && input.handedness === handedness) {
          c.add(this.holder);
          // *** reset del transform locale rispetto al controller ***
          this.holder.position.set(0, 0, 0);
          this.holder.rotation.set(0, 0, 0);

          // ora orientiamo la spada in avanti rispetto alla mano
          // (da Y-up a -Z-forward, aggiusta a gusto)
          this.holder.rotateX(-Math.PI / 2);
	  this.attachedToController = true;
	  this.fallbackAttachedToCamera = false;
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
    if (dt > 0 && this.bladeMaterial && this.bladeUniforms) {
      this.elapsedTime += dt;
      this.bladeUniforms.time.value = this.elapsedTime;
    }

    if (
      this.isXR &&
      !this.attachedToController &&
      !this.fallbackAttachedToCamera
    ) {
      this.camera.add(this.holder);
      this.fallbackAttachedToCamera = true;
      this.holder.position.set(0.25, -0.25, -0.5);

      if (DEBUG) console.log('XR senza controller: spada agganciata alla camera (modalità telefono).');
    }
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
