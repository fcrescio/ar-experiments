// drone.js
import { THREE } from './scene.js';
import { DEBUG } from './config.js';
import { SABER_LENGTH, SABER_EFFECTIVE_RADIUS } from './saber.js';

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class Drone {
  constructor(scene, camera, audioListener) {
    this.scene = scene;
    this.camera = camera;
    this.audioListener = audioListener;
    this.audioCtx = (audioListener ? audioListener.context : null);

    // --- mesh del drone ---
    this.mesh = new THREE.Group();   // placeholder
    this.modelRoot = null;
    this.mixer = null;
    this.ready = false;              // diventa true quando il glb è caricato

    scene.add(this.mesh);

    // 👉 stato per la rotazione “random”
    this.spinAngleY = 0;        // rotazione attuale attorno a Y
    this.spinSpeedY = 0;        // velocità attuale (rad/s)
    this.wobbleX = 0;           // piccola inclinazione su X
    this.wobbleZ = 0;           // piccola inclinazione su Z
    this.spinTimer = 0;
    this.spinInterval = 0;

    // helper per generare il prossimo stato di spin
    this._pickNewSpin();

    // --- CARICAMENTO MODELLO GLB ---
    const loader = new GLTFLoader();
    loader.load(
      'assets/training_droid.glb',    // path relativo a index.html
      (gltf) => {
        this.modelRoot = gltf.scene;

        // opzionale: scala e orientamento del modello
        this.modelRoot.scale.set(0.2, 0.2, 0.2);    // riduci/ingrandisci
        // se “guarda” nella direzione sbagliata, ruotalo:
        // this.modelRoot.rotation.y = Math.PI; // ad es. 180°

        this.mesh.add(this.modelRoot);

        // --- ANIMAZIONI ---
        if (gltf.animations && gltf.animations.length > 0) {
          this.mixer = new THREE.AnimationMixer(this.modelRoot);

          // opzione 1: fai partire TUTTE le animazioni in loop
          gltf.animations.forEach((clip) => {
            const action = this.mixer.clipAction(clip);
            action.play();
          });

          // opzione 2: se vuoi solo una clip specifica:
          // const idleClip = gltf.animations[0];
          // this.mixer.clipAction(idleClip).play();
        }

        this.ready = true;
        if (DEBUG) console.log('Drone GLB caricato');
      },
      undefined,
      (err) => {
        console.error('Errore nel caricamento del drone GLB:', err);
      }
    );


    // stato movimento
    this.state = 'idle';
    this.stateTimer = 0;
    this.stateDuration = 2.0;

    this.idleLerpSpeed = 1.5;
    this.dashLerpSpeed = 10.0;

    this.baseDistance = 2.6;
    this.idleRadius = 0.25;
    this.dashRadius = 0.45;

    this.currentOffset = new THREE.Vector2(0, 0);
    this.targetOffset = new THREE.Vector2(0, 0);

    this.center = new THREE.Vector3();
    this.forwardDir = new THREE.Vector3();
    this.initialized = false;

    this.RECENTER_ANGLE_DEG = 50;

    // colpi
    this.bolts = [];

    // velocità media "base", usata come riferimento
    this.boltSpeed = 4.0;

    // RANGE velocità colpi (m/s)
    this.minBoltSpeed = 3.0;
    this.maxBoltSpeed = 7.0;

    // INTERVALLI di fuoco
    this.shootTimer = 0;
    this.shootInterval = 1.6;     // valore iniziale (verrà subito ricalcolato)
    this.minShootInterval = 0.35; // molto vicino = fuoco intenso
    this.maxShootInterval = 2.0;  // molto lontano = fuoco lento

    this.currentDistanceToPlayer = this.baseDistance;

    // --- geometria "laser bolt" ---
    this.boltLength = 0.35;
    this.boltRadius = 0.003;

    // core: cilindro sottile lungo Y
    this.boltCoreGeo = new THREE.CylinderGeometry(
      this.boltRadius,
      this.boltRadius,
      this.boltLength,
      8
    );
    this.boltCoreMat = new THREE.MeshStandardMaterial({
      color: 0xff5533,
      emissive: 0xff5533,
      emissiveIntensity: 3.0,
      metalness: 0.0,
      roughness: 0.2,
      transparent: true,
      opacity: 0.9,
    });

	// alone: plane additivo che dà glow lungo il colpo
	this.boltGlowGeo = new THREE.PlaneGeometry(
	  this.boltRadius * 8,        // spessore "glow"
	  this.boltLength * 1.1       // lunghezza un po' > del core
	);
	this.boltGlowMat = new THREE.MeshBasicMaterial({
	  color: 0xffddaa,
	  transparent: true,
	  opacity: 0.7,
	  blending: THREE.AdditiveBlending,
	  depthWrite: false,
	  side: THREE.DoubleSide,
	});

    this.reflectedColor = 0x00ff44;

    // callback da assegnare da fuori
    this.onPlayerHit = null;
    this.onBoltDeflected = null;

    // temp
    this._tmpCameraPos = new THREE.Vector3();
    this._tmpCameraDir = new THREE.Vector3();
    this._tmpUp = new THREE.Vector3(0, 1, 0);
    this._tmpRight = new THREE.Vector3();
    this._tmpToDrone = new THREE.Vector3();
    this._tmpDronePos = new THREE.Vector3();
    this._tmpBoltDir = new THREE.Vector3();
    this._tmpFromSaberToBolt = new THREE.Vector3();

    this._tmpBladeStart = new THREE.Vector3();
    this._tmpBladeEnd = new THREE.Vector3();
    this._tmpBladeSegment = new THREE.Vector3();
    this._tmpToBolt = new THREE.Vector3();
    this._tmpClosestOnBlade = new THREE.Vector3();
    this._tmpBoltStart = new THREE.Vector3();
    this._tmpClosestOnBoltPath = new THREE.Vector3();

    this._tmpSegU = new THREE.Vector3();
    this._tmpSegV = new THREE.Vector3();
    this._tmpSegW = new THREE.Vector3();

    this._tmpVelDelta = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpYAxis = new THREE.Vector3(0, 1, 0);
  }

  randomOffset(radius) {
    const angle = Math.random() * Math.PI * 2;
    const r = radius * Math.sqrt(Math.random());
    return new THREE.Vector2(Math.cos(angle) * r, Math.sin(angle) * r);
  }

  _pickNewSpin() {
    // durata di questo “stato” di rotazione
    this.spinInterval = 0.7 + Math.random() * 1.3; // tra 0.7 e 2.0 secondi
    this.spinTimer = 0;

    // velocità di rotazione attorno a Y (rad/s)
    const minSpin = -2.5;
    const maxSpin =  2.5;
    this.spinSpeedY = THREE.MathUtils.randFloat(minSpin, maxSpin);

    // piccola inclinazione random su X/Z (wobble)
    const maxTilt = THREE.MathUtils.degToRad(12); // 12°
    this.wobbleX = THREE.MathUtils.randFloatSpread(maxTilt);
    this.wobbleZ = THREE.MathUtils.randFloatSpread(maxTilt);
  }


  _pickNewState() {
    if (this.state === 'idle') {
      if (Math.random() < 0.7) {
        this.state = 'dash';
        this.stateDuration = 0.25 + Math.random() * 0.15;
        this.targetOffset = this.randomOffset(this.dashRadius);
      } else {
        this.state = 'idle';
        this.stateDuration = 1.0 + Math.random() * 1.0;
        this.targetOffset = this.randomOffset(this.idleRadius);
      }
    } else {
      this.state = 'idle';
      this.stateDuration = 1.0 + Math.random() * 1.0;
      this.targetOffset = this.randomOffset(this.idleRadius);
    }
    this.stateTimer = 0;
  }

  _updateMovement(dt) {
    const cam = this.camera;

    cam.getWorldPosition(this._tmpCameraPos);
    cam.getWorldDirection(this._tmpCameraDir);
    this._tmpCameraDir.normalize();

    // init una volta
    if (!this.initialized) {
      this.center.copy(this._tmpCameraPos);
      this.forwardDir.copy(this._tmpCameraDir);

      const initialPos = this._tmpCameraPos
        .clone()
        .add(this._tmpCameraDir.clone().multiplyScalar(this.baseDistance));

      this.mesh.position.copy(initialPos);
      this.initialized = true;
    }

    // stato
    this.stateTimer += dt;
    if (this.stateTimer > this.stateDuration) {
      this._pickNewState();
    }

    const lerpSpeed =
      this.state === 'idle' ? this.idleLerpSpeed : this.dashLerpSpeed;
    const lerpFactor = 1 - Math.exp(-lerpSpeed * dt);
    this.currentOffset.lerp(this.targetOffset, lerpFactor);

    // frame locale drone
    const up = this._tmpUp;
    const forward = this.forwardDir.clone().normalize();
    const right = this._tmpRight.copy(forward).cross(up).normalize();

    const targetPos = new THREE.Vector3()
      .copy(this.center)
      .add(forward.clone().multiplyScalar(this.baseDistance))
      .add(right.clone().multiplyScalar(this.currentOffset.x))
      .add(up.clone().multiplyScalar(this.currentOffset.y));

    this.mesh.position.lerp(targetPos, lerpFactor);
    this.mesh.lookAt(this._tmpCameraPos);

    // drift lento del centro verso il giocatore
    const centerLerp = 1 - Math.exp(-0.5 * dt);
    this.center.lerp(this._tmpCameraPos, centerLerp);

    // recenter se fuori angolo
    this._tmpToDrone
      .copy(this.mesh.position)
      .sub(this._tmpCameraPos)
      .normalize();
    const dot = this._tmpCameraDir.dot(this._tmpToDrone);
    const angleRad = Math.acos(THREE.MathUtils.clamp(dot, -1, 1));
    const angleDeg = THREE.MathUtils.radToDeg(angleRad);

    if (angleDeg > this.RECENTER_ANGLE_DEG) {
      this.center.copy(this._tmpCameraPos);
      this.forwardDir.copy(this._tmpCameraDir);
      this.state = 'dash';
      this.stateDuration = 0.25 + Math.random() * 0.2;
      this.stateTimer = 0;
      this.targetOffset = this.randomOffset(this.dashRadius);
    }
    // aggiorna la distanza attuale dal giocatore
    this.currentDistanceToPlayer = this.mesh.position.distanceTo(
      this._tmpCameraPos
    );
  }

  _scheduleNextShot() {
    // distanza attuale dal giocatore (fallback sulla baseDistance)
    const d = this.currentDistanceToPlayer || this.baseDistance;

    // mappiamo la distanza in [near, far]
    const near = 1.3; // molto vicino
    const far  = 4.0; // abbastanza lontano

    const t = THREE.MathUtils.clamp(
      (d - near) / (far - near),
      0.0,
      1.0
    );

    // t=0 (molto vicino)  -> minShootInterval
    // t=1 (molto lontano) -> maxShootInterval
    const baseInterval = THREE.MathUtils.lerp(
      this.minShootInterval,
      this.maxShootInterval,
      t
    );

    // jitter random (±30%)
    const jitterFactor = THREE.MathUtils.randFloat(0.7, 1.3);

    this.shootInterval = baseInterval * jitterFactor;
    this.shootTimer = 0;
  }

  _spawnBolt() {
    const core = new THREE.Mesh(this.boltCoreGeo, this.boltCoreMat.clone());
    this.mesh.getWorldPosition(this._tmpDronePos);

    // mira alla testa del giocatore
    this.camera.getWorldPosition(this._tmpCameraPos);
    const target = this._tmpCameraPos.clone().add(
      new THREE.Vector3(
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.3
      )
    );

    // direzione normalizzata
    const dir = target.clone().sub(this._tmpDronePos).normalize();

    // centro del lampo: leggermente davanti al drone
    const halfLen = this.boltLength * 0.5;
    const startPos = this._tmpDronePos.clone().add(dir.clone().multiplyScalar(halfLen));
    core.position.copy(startPos);

    // orienta il cilindro lungo la direzione del colpo
    const yAxis = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(yAxis, dir);
    core.quaternion.copy(quat);

    // velocità random nel range [minBoltSpeed, maxBoltSpeed]
    const speed = THREE.MathUtils.randFloat(
      this.minBoltSpeed,
      this.maxBoltSpeed
    );
    const velocity = dir.multiplyScalar(speed);

	  //
	// alone glow come plane additivo allineato al bolt
	const glow = new THREE.Mesh(this.boltGlowGeo, this.boltGlowMat.clone());
	glow.position.set(0, 0, 0); // al centro del core
	core.add(glow);

    this.scene.add(core);
    this.bolts.push({
      mesh: core,
      velocity,
      reflected: false,
      glow,
      age: 0,
    });

    this._playShotSound(core);
  }


  _closestPointsOnSegments(p1, q1, p2, q2, outP1, outP2) {
    // segmenti:
    // S1(s) = p1 + s * (q1 - p1), s in [0, 1]
    // S2(t) = p2 + t * (q2 - p2), t in [0, 1]

    const u = this._tmpSegU.copy(q1).sub(p1);   // direzione S1
    const v = this._tmpSegV.copy(q2).sub(p2);   // direzione S2
    const w = this._tmpSegW.copy(p1).sub(p2);   // p1 - p2

    const a = u.dot(u); // |u|^2
    const b = u.dot(v);
    const c = v.dot(v); // |v|^2
    const d = u.dot(w);
    const e = v.dot(w);

    const EPS = 1e-6;
    let sN, sD = a * c - b * b; // denominatore per s
    let tN, tD = sD;            // denominatore per t

    // segmenti quasi paralleli
    if (sD < EPS) {
      sN = 0.0;   // forza s = 0
      sD = 1.0;   // evita divisione per zero
      tN = e;
      tD = c;
    } else {
      // s non vincolato
      sN = (b * e - c * d);
      tN = (a * e - b * d);

      // clamp s a [0,1]
      if (sN < 0.0) {
        sN = 0.0;
        tN = e;
        tD = c;
      } else if (sN > sD) {
        sN = sD;
        tN = e + b;
        tD = c;
      }
    }

    // clamp t a [0,1] a seconda di s
    if (tN < 0.0) {
      tN = 0.0;
      if (-d < 0.0) {
        sN = 0.0;
      } else if (-d > a) {
        sN = sD;
      } else {
        sN = -d;
        sD = a;
      }
    } else if (tN > tD) {
      tN = tD;
      if ((-d + b) < 0.0) {
        sN = 0.0;
      } else if ((-d + b) > a) {
        sN = sD;
      } else {
        sN = (-d + b);
        sD = a;
      }
    }

    const sc = (Math.abs(sN) < EPS ? 0.0 : sN / sD);
    const tc = (Math.abs(tN) < EPS ? 0.0 : tN / tD);

    // punti più vicini sui due segmenti
    outP1.copy(p1).addScaledVector(u, sc);
    outP2.copy(p2).addScaledVector(v, tc);
  }

  _updateBolts(dt, saber) {
    // posizione della camera (giocatore)
    this.camera.getWorldPosition(this._tmpCameraPos);

    // linea della lama
    const saberPos = saber.getBladeWorldPosition();
    const saberDir = saber.getBladeWorldDirection();

    const halfLen = SABER_LENGTH * 0.5;
    this._tmpBladeStart
      .copy(saberPos)
      .addScaledVector(saberDir, -halfLen);
    this._tmpBladeEnd
      .copy(saberPos)
      .addScaledVector(saberDir, halfLen);

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i];

      // --- traiettoria continua del bolt nel frame ---
      // posizione all'inizio del frame
      const boltStart = this._tmpBoltStart.copy(bolt.mesh.position);

      // spostamento in questo frame
      this._tmpVelDelta.copy(bolt.velocity).multiplyScalar(dt);
      bolt.mesh.position.add(this._tmpVelDelta);

      // posizione a fine frame
      const boltEnd = bolt.mesh.position;

      // età del colpo
      bolt.age += dt;

      // troppo lontano -> rimuovi
      if (bolt.mesh.position.length() > 50) {
        this.scene.remove(bolt.mesh);
        this.bolts.splice(i, 1);
        continue;
      }

      // colpisce il giocatore (per ora controllo puntuale a fine frame)
      if (
        bolt.mesh.position.distanceTo(this._tmpCameraPos) < 0.15 &&
        !bolt.reflected
      ) {
	this._playHitSound(this.camera);
        if (this.onPlayerHit) this.onPlayerHit();
        this.scene.remove(bolt.mesh);
        this.bolts.splice(i, 1);
        continue;
      }

      // --- collisione continuo bolt-lama (segmento-segmento) ---
      if (!bolt.reflected) {
        // punto minimo tra il segmento del bolt e il segmento della lama
        this._closestPointsOnSegments(
          boltStart,
          boltEnd,
          this._tmpBladeStart,
          this._tmpBladeEnd,
          this._tmpClosestOnBoltPath,
          this._tmpClosestOnBlade
        );

        const distToBlade = this._tmpClosestOnBoltPath.distanceTo(
          this._tmpClosestOnBlade
        );

        if (distToBlade < SABER_EFFECTIVE_RADIUS) {
          // porta il bolt esattamente sul punto di impatto
          bolt.mesh.position.copy(this._tmpClosestOnBoltPath);

          // --- riflessione come prima, ma usando il punto di impatto ---
          this._tmpBoltDir.copy(bolt.velocity).normalize();

          this._tmpFromSaberToBolt
            .copy(this._tmpClosestOnBoltPath)
            .sub(this._tmpClosestOnBlade)
            .normalize();

          const n = this._tmpFromSaberToBolt;
          const dot = this._tmpBoltDir.dot(n);

          // R = I - 2 * dot(I, n) * n
          const reflectDir = this._tmpBoltDir
            .clone()
            .addScaledVector(n, -2 * dot)
            .normalize();

          // mantieni la velocità attuale del colpo e aumentala un po'
          const currentSpeed = bolt.velocity.length();
          bolt.velocity.copy(
            reflectDir.multiplyScalar(currentSpeed * 1.1)
          );
          bolt.reflected = true;

          // core diventa verde
          bolt.mesh.material.color.setHex(this.reflectedColor);
          bolt.mesh.material.emissive.setHex(this.reflectedColor);

          // anche l’alone diventa verde se esiste
          if (bolt.glow) {
            bolt.glow.material.color.setHex(this.reflectedColor);
          }

	  this._playDeflectSound(bolt.mesh);
          if (this.onBoltDeflected) this.onBoltDeflected();
        }
      }

      // --- orienta il bolt lungo la direzione di movimento finale ---
      if (bolt.velocity.lengthSq() > 1e-6) {
        const dir = this._tmpBoltDir.copy(bolt.velocity).normalize();
        this._tmpQuat.setFromUnitVectors(this._tmpYAxis, dir);
        bolt.mesh.quaternion.copy(this._tmpQuat);
      }
    }
  }


  _playShotSound(parentObject3D) {
    if (!this.audioListener || !this.audioCtx) return;

    const ctx = this.audioCtx;

    // Oscillatore tipo "laser"
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';

    // Pitch sweep: tono alto -> basso
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(
      180,
      ctx.currentTime + 0.18
    );

    // Envelope di volume molto corto
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);

    // Audio posizionale Three.js
    const audio = new THREE.PositionalAudio(this.audioListener);
    audio.setRefDistance(2.0);
    audio.setRolloffFactor(1.5);

    // Collegamento nodo → PositionalAudio
    osc.connect(gain);
    audio.setNodeSource(gain);

    // Attacchiamo il suono all'oggetto nello spazio
    parentObject3D.add(audio);

    // Partenza e stop
    const now = ctx.currentTime;
    osc.start(now);
    osc.stop(now + 0.2);

    // Pulizia (rimuovi il nodo dalla scena quando finisce)
    osc.onended = () => {
      if (audio.parent) {
        audio.parent.remove(audio);
      }
    };
  }

  _playDeflectSound(parentObject3D) {
    if (!this.audioListener || !this.audioCtx) return;

    const ctx = this.audioCtx;

    const osc = ctx.createOscillator();
    osc.type = 'square';

    // Sweep breve verso l'alto (ping)
    osc.frequency.setValueAtTime(500, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(
      1500,
      ctx.currentTime + 0.08
    );

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);

    const audio = new THREE.PositionalAudio(this.audioListener);
    audio.setRefDistance(1.5);
    audio.setRolloffFactor(2.0);

    osc.connect(gain);
    audio.setNodeSource(gain);

    parentObject3D.add(audio);

    const now = ctx.currentTime;
    osc.start(now);
    osc.stop(now + 0.13);

    osc.onended = () => {
      if (audio.parent) {
        audio.parent.remove(audio);
      }
    };
  }

  _playHitSound(parentObject3D) {
    if (!this.audioListener || !this.audioCtx) return;

    const ctx = this.audioCtx;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';

    // Piccolo "thud": frequenza medio-bassa
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(
      80,
      ctx.currentTime + 0.18
    );

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.6, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);

    const audio = new THREE.PositionalAudio(this.audioListener);
    audio.setRefDistance(1.0);
    audio.setRolloffFactor(1.5);

    osc.connect(gain);
    audio.setNodeSource(gain);

    parentObject3D.add(audio);

    const now = ctx.currentTime;
    osc.start(now);
    osc.stop(now + 0.22);

    osc.onended = () => {
      if (audio.parent) {
        audio.parent.remove(audio);
      }
    };
  }


  update(dt, saber) {
    // 1) aggiorna animazione del modello, se c’è
    if (this.mixer && dt > 0) {
      this.mixer.update(dt);
    }

    // 2) se il modello non è ancora pronto, puoi comunque aggiornare il movimento base,
    //    ma se vuoi puoi anche early-return dopo aver mosso il "centro"
    this._updateMovement(dt);
    // --- rotazione random del modello GLB ---
    if (this.modelRoot && dt > 0) {
      // aggiorna timer e, se scaduto, scegli un nuovo stato di spin
      this.spinTimer += dt;
      if (this.spinTimer > this.spinInterval) {
        this._pickNewSpin();
      }

      // integra rotazione attorno a Y
      this.spinAngleY += this.spinSpeedY * dt;

      // applica rotazione + wobble al modello (NON al group esterno!)
      this.modelRoot.rotation.set(this.wobbleX, this.spinAngleY, this.wobbleZ);
    }


    // 3) aggiornare colpi/collisioni solo se è pronto (per evitare glitch all’inizio)
    if (!this.ready) return;

    this.shootTimer += dt;
    if (this.shootTimer > this.shootInterval) {
      this._spawnBolt();
      this._scheduleNextShot();
    }

    this._updateBolts(dt, saber);
  }

}
