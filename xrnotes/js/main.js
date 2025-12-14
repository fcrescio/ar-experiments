import { setupScene } from './scene.js';
import { initSessionLabel } from './session.js';
import { createNotesManager } from './notes.js';
import { createRecorder } from './recording.js';
import { createPanelManager } from './panel.js';
import { createInteractions } from './interactions.js';
import { createTempTools } from './utils.js';

const sessionId = initSessionLabel('session');
console.log(`[XRNotes] Session ${sessionId}`);

function setStatus(message) {
  console.log('[XRNotes]', message);
}

const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const { scene, camera, renderer, reticle } = setupScene();
const { raycaster, tempMatrix, tempVec } = createTempTools();
const panelManager = createPanelManager(renderer, tempMatrix);
const recorder = createRecorder(audioContext, setStatus);

const notesManager = createNotesManager(
  scene,
  reticle,
  tempVec,
  setStatus,
  () => panelManager.refreshPanel(notesManager.notes),
  (mesh) => recorder.stopIfTarget(mesh)
);

const controllers = [];
const interactions = createInteractions({
  controllers,
  reticle,
  raycaster,
  tempMatrix,
  tempVec,
  notesManager,
  recorder,
  panelManager,
  camera,
  setStatus,
  audioContext
});

function setupControllers() {
  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i);
    controller.userData.index = i;
    controller.userData.hovered = null;
    controller.userData.buttonAPressed = false;
    controller.addEventListener('select', () => interactions.handleSelect(controller));
    controller.addEventListener('selectstart', () => interactions.handleSelectStart(controller));
    controller.addEventListener('selectend', interactions.handleSelectEnd);
    controller.addEventListener('connected', (event) => {
      controller.userData.handedness = event.data.handedness;
      controller.userData.gamepad = event.data.gamepad;
      panelManager.updatePanelAttachment(controllers, notesManager.notes);
    });
    controller.addEventListener('disconnected', () => {
      controller.userData.gamepad = null;
    });
    scene.add(controller);
    controllers.push(controller);
  }
}

setupControllers();

let hitTestSource = null;
let hitTestSourceRequested = false;

function updateReticle(frame) {
  const referenceSpace = renderer.xr.getReferenceSpace();
  const session = renderer.xr.getSession();
  if (!hitTestSourceRequested) {
    session.requestReferenceSpace('viewer').then((referenceSpace) => {
      session.requestHitTestSource({ space: referenceSpace }).then((source) => {
        hitTestSource = source;
      });
    });
    session.addEventListener('end', () => {
      hitTestSourceRequested = false;
      hitTestSource = null;
    });
    hitTestSourceRequested = true;
  }

  if (hitTestSource) {
    const hitTestResults = frame.getHitTestResults(hitTestSource);
    if (hitTestResults.length) {
      const hit = hitTestResults[0];
      const pose = hit.getPose(referenceSpace);
      reticle.visible = true;
      reticle.matrix.fromArray(pose.transform.matrix);
    } else {
      reticle.visible = false;
    }
  }
}

function render(timestamp, frame) {
  if (frame) {
    updateReticle(frame);
  }

  interactions.updateControllers();
  notesManager.updateLines();

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(render);
