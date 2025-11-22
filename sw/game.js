// game.js
import { THREE } from './scene.js';
import { DEBUG } from './config.js';

export function setupGame(scene, camera, renderer, isXR) {
  // --- DRONE ---
  const droneRadius = 0.15;
  const droneGeo = new THREE.SphereGeometry(droneRadius, 24, 24);
  const droneMat = new THREE.MeshPhongMaterial({
    color: 0x00ffcc,
    emissive: 0x008877,
    shininess: 80,
  });
  const drone = new THREE.Mesh(droneGeo, droneMat);

  const droneGroup = new THREE.Group();
  droneGroup.add(drone);
  scene.add(droneGroup);

  // nuovo sistema di movimento “fluttuante + scatti”
  let droneState = 'idle'; // 'idle' | 'dash'
  let droneStateTimer = 0;
  let droneStateDuration = 2.0;
  // --- Stato "mondo" del drone ---
  const droneCenter = new THREE.Vector3();      // centro dell'area in cui si muove
  const droneForwardDir = new THREE.Vector3();  // direzione "davanti" rispetto al giocatore
  let droneInitialized = false;                // per inizializzazione lazy

  // parametri per il recenter rispetto allo sguardo
  const RECENTER_ANGLE_DEG = 50;  // oltre questa angolazione il drone "torna in faccia"

  const idleLerpSpeed = 1.5; // quanto “morbido” fluttua verso il target
  const dashLerpSpeed = 8.0; // quanto rapido negli scatti

  const baseDistance = 1.6;  // distanza dalla testa
  const idleRadius = 0.25;   // raggio di movimento in idle
  const dashRadius = 0.45;   // raggio di movimento per gli scatti

  // offset 2D (destra/su) rispetto al centro davanti alla faccia
  const currentOffset = new THREE.Vector2(0, 0);
  let targetOffset = new THREE.Vector2(0, 0);

  // --- COLPI ---
  const bolts = [];
  const boltSpeed = 4.0;
  const boltGeo = new THREE.SphereGeometry(0.03, 8, 8);
  const boltMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
  const reflectedColor = 0x00ff44;

  let shootTimer = 0;
  const shootInterval = 1.6;

  // --- SPADA ---
  const saberLength = 1.0;
  const saberThickness = 0.03;
  const SABER_EFFECTIVE_RADIUS = saberLength * 0.5;

  // Lama: cilindro lungo l'asse Y (verticale)
  const bladeGeo = new THREE.CylinderGeometry(
    saberThickness,
    saberThickness,
    saberLength,
    12
  );
  const bladeMat = new THREE.MeshBasicMaterial({
    color: 0x66ccff,
    transparent: true,
    opacity: 0.9,
  });
  const blade = new THREE.Mesh(bladeGeo, bladeMat);

  // Impugnatura: cilindro corto, centrato nella mano
  const hiltGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.2, 12);
  const hiltMat = new THREE.MeshPhongMaterial({ color: 0x444444 });
  const hilt = new THREE.Mesh(hiltGeo, hiltMat);

  const saberHolder = new THREE.Group();
  saberHolder.add(hilt);
  saberHolder.add(blade);

  // posizionamento relativo
  hilt.position.set(0, 0, 0); // mano al centro dell'impugnatura
  blade.position.set(0, 0.6, 0); // base lama appena sopra l’impugnatura

  // Aggancio al controller o alla camera, a seconda di XR/flat
  let controller = null;
  if (isXR) {
    controller = renderer.xr.getController(1); // 1 = mano destra
    scene.add(controller);
    controller.add(saberHolder);
  } else {
    camera.add(saberHolder);
    scene.add(camera);
    saberHolder.position.set(0.25, -0.25, -0.5);
  }

  // --- VETTORI / QUATERNION TEMPORANEI ---
  const tmpCameraWorldPos = new THREE.Vector3();
  const tmpSaberWorldPos = new THREE.Vector3();
  const tmpSaberDir = new THREE.Vector3();
  const tmpDroneWorldPos = new THREE.Vector3();
  const tmpBoltDir = new THREE.Vector3();
  const tmpSaberQuat = new THREE.Quaternion();

  const tmpCameraDir = new THREE.Vector3();
  const tmpRight = new THREE.Vector3();
  const tmpUp = new THREE.Vector3(0, 1, 0);

  // --- HUD DI DEBUG ---
  let debugPanel = null;
  if (DEBUG) {
    debugPanel = document.createElement('pre');
    debugPanel.style.position = 'absolute';
    debugPanel.style.right = '10px';
    debugPanel.style.bottom = '10px';
    debugPanel.style.padding = '6px 8px';
    debugPanel.style.background = 'rgba(0, 0, 0, 0.6)';
    debugPanel.style.color = '#0f0';
    debugPanel.style.fontSize = '11px';
    debugPanel.style.fontFamily = 'monospace';
    debugPanel.style.whiteSpace = 'pre';
    debugPanel.style.zIndex = '20';
    debugPanel.textContent = 'DEBUG ON';
    document.body.appendChild(debugPanel);
  }

  function updateDebug(dt) {
    if (!DEBUG || !debugPanel) return;

    camera.getWorldPosition(tmpCameraWorldPos);
    drone.getWorldPosition(tmpDroneWorldPos);
    blade.getWorldPosition(tmpSaberWorldPos);

    const lines = [
      `dt: ${dt.toFixed(3)} s`,
      `state: ${droneState}`,
      `bolts: ${bolts.length}`,
      `cam:   (${tmpCameraWorldPos.x.toFixed(2)}, ${tmpCameraWorldPos.y.toFixed(
        2
      )}, ${tmpCameraWorldPos.z.toFixed(2)})`,
      `drone: (${tmpDroneWorldPos.x.toFixed(2)}, ${tmpDroneWorldPos.y.toFixed(
        2
      )}, ${tmpDroneWorldPos.z.toFixed(2)})`,
      `blade: (${tmpSaberWorldPos.x.toFixed(2)}, ${tmpSaberWorldPos.y.toFixed(
        2
      )}, ${tmpSaberWorldPos.z.toFixed(2)})`,
    ];
    debugPanel.textContent = lines.join('\n');
  }

  // --- DRONE MOVEMENT HELPER ---

  function randomOffset(radius) {
    // offset casuale ma limitato, sempre davanti (x=destra, y=su)
    const angle = Math.random() * Math.PI * 2;
    const r = radius * Math.sqrt(Math.random());
    return new THREE.Vector2(Math.cos(angle) * r, Math.sin(angle) * r);
  }

  function pickNewDroneState() {
    if (droneState === 'idle') {
      // con una buona probabilità entra in dash
      if (Math.random() < 0.7) {
        droneState = 'dash';
        droneStateDuration = 0.25 + Math.random() * 0.15; // scatto breve
        targetOffset = randomOffset(dashRadius);
      } else {
        // idle → idle con altro target soft
        droneState = 'idle';
        droneStateDuration = 1.0 + Math.random() * 1.0;
        targetOffset = randomOffset(idleRadius);
      }
    } else {
      // dash → torna a idle più soft
      droneState = 'idle';
      droneStateDuration = 1.0 + Math.random() * 1.0;
      targetOffset = randomOffset(idleRadius);
    }
    droneStateTimer = 0;
  }

  // inizializza offset iniziale
  pickNewDroneState();

  function updateDrone(dt) {
    // 1) Leggo posizione e direzione della camera
    camera.getWorldPosition(tmpCameraWorldPos);
    camera.getWorldDirection(tmpCameraDir);
    tmpCameraDir.normalize();

    // 2) Inizializzazione una sola volta: metto il drone davanti alla faccia
    if (!droneInitialized) {
      droneCenter.copy(tmpCameraWorldPos);        // ancora iniziale = testa
      droneForwardDir.copy(tmpCameraDir);         // direzione iniziale di sguardo

      // posizione iniziale: davanti alla faccia
      const initialPos = tmpCameraWorldPos
        .clone()
        .add(tmpCameraDir.clone().multiplyScalar(baseDistance));

      drone.position.copy(initialPos);
      droneInitialized = true;
    }

    // 3) Aggiorno stato (idle/dash) e offset nel suo frame locale
    droneStateTimer += dt;
    if (droneStateTimer > droneStateDuration) {
      pickNewDroneState();
    }

    const lerpSpeed = droneState === 'idle' ? idleLerpSpeed : dashLerpSpeed;
    const lerpFactor = 1 - Math.exp(-lerpSpeed * dt);
    currentOffset.lerp(targetOffset, lerpFactor);

    // 4) Calcolo il frame locale del drone (forward/right/up) SENZA usare la camera ogni frame
    //    - forward = droneForwardDir (rimane relativamente costante)
    //    - right = forward x up
    const up = tmpUp; // (0,1,0) definito sopra
    const forward = droneForwardDir.clone().normalize();
    const right = tmpRight.copy(forward).cross(up).normalize();

    // 5) Costruisco la posizione target nel mondo:
    //    centro = droneCenter
    //    + forward * baseDistance
    //    + right * currentOffset.x
    //    + up * currentOffset.y
    const targetWorldPos = new THREE.Vector3()
      .copy(droneCenter)
      .add(forward.clone().multiplyScalar(baseDistance))
      .add(right.clone().multiplyScalar(currentOffset.x))
      .add(up.clone().multiplyScalar(currentOffset.y));

    drone.position.lerp(targetWorldPos, lerpFactor); // così il movimento è morbido
    drone.lookAt(tmpCameraWorldPos);

    // 6) FACOLTATIVO: fai drift leggero del centro dietro al giocatore (solo traslazione)
    //    così se ti sposti a piedi, il drone non rimane chilometri dietro
    const centerLerp = 1 - Math.exp(-0.5 * dt); // drift lento
    droneCenter.lerp(tmpCameraWorldPos, centerLerp);

    // 7) Controllo "finestra" di sguardo: se lo sguardo è troppo lontano dal drone, recenter
    const toDrone = new THREE.Vector3()
      .copy(drone.position)
      .sub(tmpCameraWorldPos)
      .normalize();

    const dot = tmpCameraDir.dot(toDrone);
    const angleRad = Math.acos(THREE.MathUtils.clamp(dot, -1, 1));
    const angleDeg = THREE.MathUtils.radToDeg(angleRad);

    if (angleDeg > RECENTER_ANGLE_DEG) {
      // Il drone è troppo fuori campo -> aggiorno ancora e direzione
      droneCenter.copy(tmpCameraWorldPos);
      droneForwardDir.copy(tmpCameraDir);

      // movimento tipo "dash" verso il nuovo fronte
      droneState = 'dash';
      droneStateDuration = 0.25 + Math.random() * 0.2;
      droneStateTimer = 0;

      // nuovo target più “ampio” per rendere evidente il salto
      targetOffset = randomOffset(dashRadius);
    }
  }

  // --- COLPI ---

  function spawnBolt() {
    const bolt = new THREE.Mesh(boltGeo, boltMat.clone());
    drone.getWorldPosition(tmpDroneWorldPos);
    bolt.position.copy(tmpDroneWorldPos);

    // mira alla testa del giocatore (camera) con un po' di jitter
    camera.getWorldPosition(tmpCameraWorldPos);
    const target = tmpCameraWorldPos.clone().add(
      new THREE.Vector3(
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.3
      )
    );

    const dir = target.clone().sub(tmpDroneWorldPos).normalize();
    const velocity = dir.multiplyScalar(boltSpeed);

    scene.add(bolt);
    bolts.push({ mesh: bolt, velocity, reflected: false });
  }

  function updateBolts(dt) {
    camera.getWorldPosition(tmpCameraWorldPos);
    blade.getWorldPosition(tmpSaberWorldPos);

    // direzione della spada: asse Y locale della lama
    tmpSaberDir.set(0, 1, 0);
    blade.getWorldQuaternion(tmpSaberQuat);
    tmpSaberDir.applyQuaternion(tmpSaberQuat);
    tmpSaberDir.normalize();

    for (let i = bolts.length - 1; i >= 0; i--) {
      const bolt = bolts[i];
      bolt.mesh.position.addScaledVector(bolt.velocity, dt);

      if (bolt.mesh.position.length() > 50) {
        scene.remove(bolt.mesh);
        bolts.splice(i, 1);
        continue;
      }

      // hit sul giocatore
      if (
        bolt.mesh.position.distanceTo(tmpCameraWorldPos) < 0.15 &&
        !bolt.reflected
      ) {
        if (DEBUG) console.log('Player hit');
        scene.remove(bolt.mesh);
        bolts.splice(i, 1);
        continue;
      }

      // collisione con la lama
      const d = bolt.mesh.position.distanceTo(tmpSaberWorldPos);
      if (d < SABER_EFFECTIVE_RADIUS && !bolt.reflected) {
        tmpBoltDir.copy(bolt.velocity).normalize();
        const dot = tmpBoltDir.dot(tmpSaberDir);
        const reflectDir = tmpBoltDir
          .clone()
          .sub(tmpSaberDir.clone().multiplyScalar(2 * dot))
          .normalize();

        bolt.velocity.copy(reflectDir.multiplyScalar(boltSpeed * 1.1));
        bolt.reflected = true;
        bolt.mesh.material.color.setHex(reflectedColor);
      }
    }
  }

  // --- FUNZIONE UPDATE CHIAMATA DAL MAIN ---
  function update(dt) {
    updateDrone(dt);

    // spara periodicamente
    shootTimer += dt;
    if (shootTimer > shootInterval) {
      shootTimer = 0;
      spawnBolt();
    }

    updateBolts(dt);
    updateDebug(dt);
  }

  return { update };
}
