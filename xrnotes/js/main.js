import { setupScene } from './scene.js';
import { initSessionLabel } from './session.js';
import { createNotesManager } from './notes.js';
import { createRecorder } from './recording.js';
import { createPanelManager } from './panel.js';
import { createInteractions } from './interactions.js';
import { createTempTools } from './utils.js';
import { createStorage } from './storage.js';
import { createHud } from './hud.js';
import { createControlHints } from './hints.js';

const sessionId = initSessionLabel('session');
console.log(`[XRNotes] Session ${sessionId}`);

const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const { scene, camera, renderer, reticle } = setupScene();
const { raycaster, tempMatrix, tempVec } = createTempTools();
const panelManager = createPanelManager(renderer, tempMatrix);
const storage = createStorage(audioContext, setStatus);
const hud = createHud(camera);
const hints = createControlHints(renderer);
hints.setPlacementAvailable(true);

const statusEl = document.getElementById('status');
const recordingEl = document.getElementById('recording');

function showToast(message, tone = 'info') {
  hud.showToast(message, tone);
}

function setStatus(message, tone = 'info') {
  console.log('[XRNotes]', message);
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.dataset.tone = tone;
  }
  hud.setStatus(message, tone);
  if (tone !== 'info') showToast(message, tone);
}

function updateRecordingUI({ active, label, elapsed } = {}) {
  if (recordingEl) {
    if (!active) {
      recordingEl.classList.remove('active');
      recordingEl.textContent = 'Recording stopped';
    } else {
      const time = elapsed ? ` • ${elapsed.toFixed(1)}s` : '';
      recordingEl.textContent = `Recording ${label || ''}${time}`;
      recordingEl.classList.add('active');
    }
  }
  hud.setRecording({ active, label, elapsed });
}

function setRecordingVisual(note, active) {
  if (!note?.material?.emissive) return;
  note.userData.isRecordingGlow = active;
  note.material.emissive.setHex(active ? 0x330000 : 0x000000);
  note.material.emissiveIntensity = 1;
}

const recorder = createRecorder(audioContext, setStatus, {
  onRecordingFinished: () => persistState(),
  updateRecordingUI,
  onRecordingStopped: () => updateRecordingUI({ active: false }),
  setRecordingVisual,
  notify: showToast
});

function persistState() {
  notesManager.notes.forEach((mesh) => storage.persistNote(mesh));
  notesManager.lines.forEach((line) => storage.persistLine(line.userData.ids));
  storage.saveMeta(notesManager.nextLabelNumber);
  panelManager.refreshPanel(notesManager.notes);
}

const notesManager = createNotesManager(scene, reticle, tempVec, {
  setStatus,
  initialCounter: 1,
  onRemove: (mesh) => {
    recorder.stopIfTarget(mesh);
    storage.removeNote(mesh.userData.id);
  },
  onChange: (event) => {
    if (event?.type === 'disconnect') {
      storage.removeLine(event.ids);
    }
    if (event?.type === 'connect') {
      storage.persistLine(event.ids);
    }
    if (['add', 'remove', 'move'].includes(event?.type)) {
      storage.persistNote(event.note);
    }
    if (event?.noteCounter) storage.saveMeta(event.noteCounter);
    if (event?.type !== 'sync') panelManager.refreshPanel(notesManager.notes);
  }
});

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
  audioContext,
  showToast,
  onPlacementAvailabilityChanged: (enabled) => hints.setPlacementAvailable(enabled)
});

function setupControllers() {
  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i);
    controller.userData.index = i;
    controller.userData.hoveredNote = null;
    controller.userData.hoveredPanel = null;
    controller.userData.actionPressed = false;
    controller.addEventListener('select', () => interactions.handleSelect(controller));
    controller.addEventListener('selectstart', () => interactions.handleSelectStart(controller));
    controller.addEventListener('selectend', interactions.handleSelectEnd);
    controller.addEventListener('connected', (event) => {
      controller.userData.handedness = event.data.handedness;
      controller.userData.gamepad = event.data.gamepad;
      panelManager.updatePanelAttachment(controllers, notesManager.notes);
      hints.attach(controllers);
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
let hitTestRetryAt = 0;
let hitTestEndListenerAttached = false;

async function requestHitTest(session) {
  try {
    const viewerRefSpace = await session.requestReferenceSpace('viewer');
    hitTestSource = await session.requestHitTestSource({ space: viewerRefSpace });
    hitTestSourceRequested = true;
    setStatus('Hit-test ready');
  } catch (err) {
    console.error('[XRNotes] Hit-test setup failed', err);
    hitTestSourceRequested = false;
    hitTestSource = null;
    hitTestRetryAt = performance.now() + 2000;
    setStatus('Unable to acquire hit-test. Check camera permissions and try again.', 'error');
  }
}

function updateReticle(frame) {
  const referenceSpace = renderer.xr.getReferenceSpace();
  const session = renderer.xr.getSession();
  if (!hitTestSourceRequested && performance.now() >= hitTestRetryAt) {
    requestHitTest(session);
    if (!hitTestEndListenerAttached) {
      session.addEventListener('end', () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
        hitTestRetryAt = 0;
        hitTestEndListenerAttached = false;
      });
      hitTestEndListenerAttached = true;
    }
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

async function hydrateFromStorage() {
  await storage.init();
  const saved = await storage.loadState();
  if (typeof saved.noteCounter === 'number') {
    notesManager.setNoteCounter(saved.noteCounter);
  }
  notesManager.loadFromData(saved.notes, saved.lines);
  panelManager.refreshPanel(notesManager.notes);
}

function render(timestamp, frame) {
  if (frame) {
    updateReticle(frame);
  }

  interactions.updateControllers(timestamp);
  notesManager.updateLines();
  hud.update(timestamp);

  notesManager.notes.forEach((note) => {
    if (note.userData.isRecordingGlow && note.material?.emissive) {
      const pulse = 0.4 + 0.2 * Math.sin(timestamp / 150);
      note.material.emissiveIntensity = pulse;
    }
  });

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(render);
hydrateFromStorage();
