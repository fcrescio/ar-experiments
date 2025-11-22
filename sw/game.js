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

  // POSIZIONAMENTO RELATIVO DI LAMA E IMPUGNATURA
  // - hilt centrato nell'origine del controller (mano)
  //   -> estende ±0.1 lungo Y
  hilt.position.set(0, 0, 0);

  // - blade: base subito sopra l'impugnatura
  //   hilt metà altezza = 0.1
  //   blade metà altezza = 0.5
  //   centro lama = 0.1 + 0.5 = 0.6
  blade.position.set(0, 0.6, 0);
  // NIENTE rotazioni strane: la lama rimane verticale

  // Aggancio al controller o alla camera, a seconda di XR/flat
  let controller = null;
  if (isXR) {
    controller = renderer.xr.getController(0);
    scene.add(controller);
    controller.add(saberHolder);
  } else {
    // in flat mode: la spada "in mano" davanti alla camera
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
    // per il debug usiamo il centro della lama
    blade.getWorldPosition(tmpSaberWorldPos);

    const lines = [
      `dt: ${dt.toFixed(3)} s`,
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
    // centro lama come riferimento
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

      // collisione con la lama (sfera attorno al centro lama)
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
    // posizione della camera (testa) per tenere il drone alla giusta altezza
    camera.getWorldPosition(tmpCameraWorldPos);

    // orbita del drone attorno al giocatore alla stessa altezza della testa
    droneAngle += droneAngularSpeed * dt;
    const centerX = tmpCameraWorldPos.x;
    const centerZ = tmpCameraWorldPos.z;
    const headY = tmpCameraWorldPos.y; // altezza testa giocatore

    const px = centerX + Math.cos(droneAngle) * droneOrbitRadius;
    const pz = centerZ + Math.sin(droneAngle) * droneOrbitRadius;

    drone.position.set(px, headY, pz);
    drone.lookAt(centerX, headY, centerZ);

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
