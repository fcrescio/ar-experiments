// scene.js
import * as THREE from 'three';
import { USE_XR, USE_PASSTHROUGH } from './config.js';

// Riesporto THREE così gli altri moduli possono importarlo da qui
export { THREE };

export function createRenderer() {
  // In AR (passthrough) serve il canale alpha, altrimenti nero.
  const useAlpha = USE_XR && USE_PASSTHROUGH;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: useAlpha,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  if (useAlpha) {
    // Clear trasparente per mostrare il passthrough del visore
    renderer.setClearColor(0x000000, 0);
  } else {
    renderer.setClearColor(0x000000, 1);
  }

  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();

  // In AR il "background" è il mondo reale, quindi niente colore.
  if (!(USE_XR && USE_PASSTHROUGH)) {
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.08);
  }

  // Luci
  const hemi = new THREE.HemisphereLight(0xffffff, 0x080820, 0.7);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 10, 7);
  scene.add(dir);

  // In AR potresti voler evitare il pavimento per non "coprire" il mondo reale.
  // Qui lo mettiamo solo se NON siamo in passthrough.
  if (!(USE_XR && USE_PASSTHROUGH)) {
    const floorGeo = new THREE.CircleGeometry(10, 32);
    const floorMat = new THREE.MeshPhongMaterial({
      color: 0x111111,
      side: THREE.DoubleSide,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    scene.add(floor);
  }

  return scene;
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  // Posizione base "umana"
  camera.position.set(0, 1.6, 3);
  return camera;
}
