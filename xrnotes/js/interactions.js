import { setNoteHighlight } from './utils.js';

const PRIMARY_BUTTON_CANDIDATES = [4, 0, 1];

function getActionButtonIndex(controller) {
  const handedness = controller.userData.handedness;
  const gamepad = controller.userData.gamepad;
  if (!gamepad?.buttons?.length) return null;
  const stored = localStorage.getItem(`xrnotes-primary-${handedness || 'any'}`);
  const storedIdx = Number(stored);
  if (!Number.isNaN(storedIdx) && gamepad.buttons[storedIdx]) return storedIdx;
  for (const idx of PRIMARY_BUTTON_CANDIDATES) {
    if (gamepad.buttons[idx]) return idx;
  }
  return 0;
}

export function createInteractions({
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
}) {
  let connectFirst = null;

  function setSelection(mesh) {
    if (connectFirst && connectFirst !== mesh) {
      notesManager.connectNotes(connectFirst, mesh);
      connectFirst = null;
      return;
    }
    connectFirst = mesh;
    setStatus?.(`${mesh.userData.label} selected. Choose another to connect.`);
  }

  function updateNoteHover(controller) {
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    const intersects = raycaster.intersectObjects(Array.from(notesManager.notes.values()));
    const previous = controller.userData.hoveredNote;
    const next = intersects[0]?.object ?? null;
    if (previous && previous !== next) {
      setNoteHighlight(previous, false);
    }
    if (next && next !== previous) {
      setNoteHighlight(next, true);
    }
    controller.userData.hoveredNote = next;
    return controller.userData.hoveredNote;
  }

  function handleSelect(controller) {
    if (recorder.isRecording()) {
      recorder.stopRecording();
      return;
    }
    const hoveredNote = controller.userData.hoveredNote;
    const hoveredPanel = controller.userData.hoveredPanel;
    if (hoveredPanel) {
      notesManager.recallNote(hoveredPanel.userData.noteId, camera, tempVec);
      return;
    }
    if (hoveredNote && !hoveredNote.userData?.isPanelButton) {
      setSelection(hoveredNote);
      notesManager.playNote(hoveredNote, audioContext);
      return;
    }
    const placed = notesManager.placeNoteAtReticle();
    if (placed) {
      setSelection(placed);
    }
  }

  function handleSelectStart(controller) {
    const hoveredNote = controller.userData.hoveredNote;
    if (hoveredNote && !hoveredNote.userData?.isPanelButton) {
      recorder.startRecordingFor(hoveredNote);
    }
  }

  function handleSelectEnd() {
    if (recorder.isRecording()) recorder.stopRecording();
  }

  function updateControllers(timestamp) {
    for (const controller of controllers) {
      updateNoteHover(controller);
      const btn = panelManager.panelRaycast(controller, raycaster);
      if (btn !== controller.userData.hoveredPanel) {
        panelManager.setButtonHighlight(controller.userData.hoveredPanel, false);
        panelManager.setButtonHighlight(btn, true);
        controller.userData.hoveredPanel = btn;
      }

      const gamepad = controller.userData.gamepad;
      const actionIndex = getActionButtonIndex(controller);
      const actionPressed = actionIndex !== null && gamepad?.buttons?.[actionIndex]?.pressed;
      if (recorder.isRecording() && gamepad?.buttons?.[1]?.pressed) {
        recorder.cancel();
      }
      if (actionPressed && !controller.userData.actionPressed) {
        notesManager.placeNoteAtController(controller);
      }
      controller.userData.actionPressed = !!actionPressed;
    }
    recorder.update(timestamp);
  }

  return {
    handleSelect,
    handleSelectStart,
    handleSelectEnd,
    updateControllers
  };
}
