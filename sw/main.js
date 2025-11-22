// main.js
import { createRenderer, createScene, createCamera, THREE } from './scene.js';
import { setupXROrFlat } from './xr.js';
import { setupGame } from './game.js';

const renderer = createRenderer();
document.body.appendChild(renderer.domElement);

const scene = createScene();
const camera = createCamera();

const listener = new THREE.AudioListener();
camera.add(listener);

// Scene resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// XR o flat (OrbitControls)
const xrState = setupXROrFlat(renderer, camera);

// Logica di gioco (drone, colpi, spada)
const game = setupGame(scene, camera, renderer, xrState.isXR, listener);

// Loop di animazione – funziona sia con XR che senza
let lastTime = 0;

renderer.setAnimationLoop((time) => {
  const t = time / 1000;
  const dt = lastTime ? t - lastTime : 0;
  lastTime = t;

  xrState.update(dt); // aggiorna OrbitControls se in flat
  game.update(dt);    // logica di gioco

  renderer.render(scene, camera);
});
