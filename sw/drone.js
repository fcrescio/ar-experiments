// drone.js
import { THREE } from './scene.js';
import { DEBUG } from './config.js';
import { SABER_EFFECTIVE_RADIUS } from './saber.js';

export class Drone {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;

    // --- mesh del drone ---
    const geo = new THREE.SphereGeometry(0.15, 24, 24);
    const mat = new THREE.MeshPhongMaterial({
      color: 0x00ffcc,
      emissive: 0x008877,
      shininess: 80,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    scene.add(this.mesh);

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
    this.boltGeo = new THREE.SphereGeometry(0.03, 8, 8);
    this.boltMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
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
  }

  randomOffset(radius) {
    const angle = Math.random() * Math.PI * 2;
    const r = radius * Math.sqrt(Math.random());
    return new THREE.Vector2(Math.cos(angle) * r, Math.sin(angle) * r);
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
    const bolt = new THREE.Mesh(this.boltGeo, this.boltMat.clone());
    this.mesh.getWorldPosition(this._tmpDronePos);
    bolt.position.copy(this._tmpDronePos);

    this.camera.getWorldPosition(this._tmpCameraPos);

    const target = this._tmpCameraPos.clone().add(
      new THREE.Vector3(
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.3
      )
    );

    const dir = target.clone().sub(this._tmpDronePos).normalize();
    const velocity = dir.multiplyScalar(this.boltSpeed);

    this.scene.add(bolt);
    this.bolts.push({ mesh: bolt, velocity, reflected: false });
  }

  _updateBolts(dt, saber) {
    this.camera.getWorldPosition(this._tmpCameraPos);
    const saberPos = saber.getBladeWorldPosition();
    const saberDir = saber.getBladeWorldDirection();

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i];
      bolt.mesh.position.addScaledVector(bolt.velocity, dt);

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

      // collisione con la lama
      const d = bolt.mesh.position.distanceTo(saberPos);
      if (d < SABER_EFFECTIVE_RADIUS && !bolt.reflected) {
        this._tmpBoltDir.copy(bolt.velocity).normalize();
        const dot = this._tmpBoltDir.dot(saberDir);
        const reflectDir = this._tmpBoltDir
          .clone()
          .sub(saberDir.clone().multiplyScalar(2 * dot))
          .normalize();

        bolt.velocity.copy(reflectDir.multiplyScalar(this.boltSpeed * 1.1));
        bolt.reflected = true;
        bolt.mesh.material.color.setHex(this.reflectedColor);

        if (this.onBoltDeflected) this.onBoltDeflected();
      }
    }
  }

  update(dt, saber) {
    this._updateMovement(dt);

    this.shootTimer += dt;
    if (this.shootTimer > this.shootInterval) {
      this.shootTimer = 0;
      this._spawnBolt();
    }

    this._updateBolts(dt, saber);
  }
}
