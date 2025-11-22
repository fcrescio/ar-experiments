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

  let droneAngle = 0;
  const droneOrbitRadius = 1.8;
  const droneHeight = 1.6;
  const droneAngularSpeed = 0.7;

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

  const saberGeo = new THREE.CylinderGeometry(
    saberThickness,
    saberThickness,
    saberLength,
    8
  );
  const saberMat = new THREE.MeshBasicMaterial({
    color: 0x66ccff,
    transparent: true,
    opacity: 0.9,
  });
  const saber = new THREE.Mesh(saberGeo, saberMat);
  saber.rotation.z = Math.PI / 2;

  const saberHolder = new THREE.Group();
  saberHolder.add(saber);

  // impugnatura
  const hiltGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.2, 8);
  const hiltMat = new THREE.MeshPhongMaterial({ color: 0x444444 });
  const hilt = new THREE.Mesh(hiltGeo, hiltMat);
  hilt.position.y = -0.5;
  saberHolder.add(hilt);

  // Se siamo in XR: attacco la spada al controller 0.
  // Se siamo in flat: la attacco alla camera (davanti a noi).
  let controller = null;
  if (isXR) {
    controller = renderer.xr.getController(0);
    scene.add(controller);
    controller.add(saberHolder);
  } else {
    camera.add(saberHolder);
    scene.add(camera); // per sicurezza
    saberHolder.position.set(0.3, -0.2, -0.5); // leggermente in basso a destra
  }

  // --- VETTORI TEMPORANEI ---
  const tmpCameraWorldPos = new THREE.Vector3();
  const tmpSaberWorldPos = new THREE.Vector3();
  const tmpSaberDir = new THREE.Vector3();
  const tmpDroneWorldPos = new THREE.Vector3();
  const tmpBoltDir = new THREE.Vector3();

  // --- PICCOLO HUD DI DEBUG (facoltativo) ---
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
    saber.getWorldPosition(tmpSaberWorldPos);

    const lines = [
      `dt: ${dt.toFixed(3)} s`,
      `bolts: ${bolts.length}`,
      `cam:   (${tmpCameraWorldPos.x.toFixed(2)}, ${tmpCameraWorldPos.y.toFixed(
        2
      )}, ${tmpCameraWorldPos.z.toFixed(2)})`,
      `drone: (${tmpDroneWorldPos.x.toFixed(2)}, ${tmpDroneWorldPos.y.toFixed(
        2
      )}, ${tmpDroneWorldPos.z.toFixed(2)})`,
      `saber: (${tmpSaberWorldPos.x.toFixed(2)}, ${tmpSaberWorldPos.y.toFixed(
        2
      )}, ${tmpSaberWorldPos.z.toFixed(2)})`,
    ];
    debugPanel.textContent = lines.join('\n');
  }

  function spawnBolt() {
    const bolt = new THREE.Mesh(boltGeo, boltMat.clone());
    drone.getWorldPosition(tmpDroneWorldPos);
    bolt.position.copy(tmpDroneWorldPos);

    // mira grossolanamente alla testa del giocatore
    const target = new THREE.Vector3(0, 1.6, 0).add(
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
    saber.getWorldPosition(tmpSaberWorldPos);

    // direzione della spada (asse Y locale del cilindro)
    tmpSaberDir.set(0, 1, 0);
    tmpSaberDir.applyQuaternion(saber.getWorldQuaternion());
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

      // collisione con la spada
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
    // aggiorna orbita drone
    droneAngle += droneAngularSpeed * dt;
    const px = Math.cos(droneAngle) * droneOrbitRadius;
    const pz = Math.sin(droneAngle) * droneOrbitRadius;
    drone.position.set(px, droneHeight, pz);
    drone.lookAt(0, droneHeight, 0);

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
