// drone.js
import { THREE } from './scene.js';
import { DEBUG } from './config.js';
import { SABER_LENGTH, SABER_EFFECTIVE_RADIUS } from './saber.js';

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class Drone {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;

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
    this.dashLerpSpeed = 8.0;

    this.baseDistance = 1.6;
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
    this.boltSpeed = 4.0;

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
    this.shootTimer = 0;
    this.shootInterval = 1.6;

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

    // velocità
    const velocity = dir.multiplyScalar(this.boltSpeed);
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
  }


  _updateBolts(dt, saber) {
    this.camera.getWorldPosition(this._tmpCameraPos);
    const saberPos = saber.getBladeWorldPosition();
    const saberDir = saber.getBladeWorldDirection();

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i];
      bolt.mesh.position.addScaledVector(bolt.velocity, dt);
	    
      // età del colpo, per eventuali effetti
      bolt.age += dt;

      if (bolt.mesh.position.length() > 50) {
        this.scene.remove(bolt.mesh);
        this.bolts.splice(i, 1);
        continue;
      }

      // colpisce il giocatore
      if (
        bolt.mesh.position.distanceTo(this._tmpCameraPos) < 0.15 &&
        !bolt.reflected
      ) {
        if (this.onPlayerHit) this.onPlayerHit();
        this.scene.remove(bolt.mesh);
        this.bolts.splice(i, 1);
        continue;
      }
	// collisione con la lama (cilindro attorno al segmento della lama)
	const boltPos = bolt.mesh.position;

	// centro e direzione della lama
	const bladeCenter = saberPos;        // già calcolato prima: saber.getBladeWorldPosition()
	const bladeDir = saberDir;           // già calcolato prima: saber.getBladeWorldDirection()

	// calcola estremi del segmento della lama
	const halfLen = SABER_LENGTH * 0.5;
	this._tmpBladeStart
	  .copy(bladeCenter)
	  .addScaledVector(bladeDir, -halfLen);
	this._tmpBladeEnd
	  .copy(bladeCenter)
	  .addScaledVector(bladeDir, halfLen);

	// vettore segmento
	this._tmpBladeSegment
	  .copy(this._tmpBladeEnd)
	  .sub(this._tmpBladeStart);

	// proietta il bolt sul segmento
	this._tmpToBolt
	  .copy(boltPos)
	  .sub(this._tmpBladeStart);

	const segLenSq = this._tmpBladeSegment.lengthSq();
	let t = 0;
	if (segLenSq > 0) {
	  t = this._tmpToBolt.dot(this._tmpBladeSegment) / segLenSq;
	  t = THREE.MathUtils.clamp(t, 0, 1);
	}

	// punto più vicino sulla lama
	this._tmpClosestOnBlade
	  .copy(this._tmpBladeStart)
	  .addScaledVector(this._tmpBladeSegment, t);

	// distanza bolt ↔ lama
	const distToBlade = boltPos.distanceTo(this._tmpClosestOnBlade);

	if (distToBlade < SABER_EFFECTIVE_RADIUS && !bolt.reflected) {
	  // === riflessione migliorata (miglioria 1) ===

	  // direzione attuale del colpo
	  this._tmpBoltDir.copy(bolt.velocity).normalize();

	  // normale locale dello "scudo": dal punto di contatto verso il bolt
	  this._tmpFromSaberToBolt
	    .copy(boltPos)
	    .sub(this._tmpClosestOnBlade)
	    .normalize();

	  const n = this._tmpFromSaberToBolt;
	  const dot = this._tmpBoltDir.dot(n);

	  // R = I - 2 * dot(I, n) * n
	  const reflectDir = this._tmpBoltDir
	    .clone()
	    .addScaledVector(n, -2 * dot)
	    .normalize();

	  // velocità un filo più alta dopo la deviazione
	  bolt.velocity.copy(reflectDir.multiplyScalar(this.boltSpeed * 1.1));
	  bolt.reflected = true;

	  // core diventa verde
	  bolt.mesh.material.color.setHex(this.reflectedColor);
	  bolt.mesh.material.emissive.setHex(this.reflectedColor);

	  // anche l’alone diventa verde se esiste
	  if (bolt.glow) {
	    bolt.glow.material.color.setHex(this.reflectedColor);
	  }

	  if (this.onBoltDeflected) this.onBoltDeflected();
	}

    }
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
      this.shootTimer = 0;
      this._spawnBolt();
    }

    this._updateBolts(dt, saber);
  }

}
