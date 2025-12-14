import { setNoteHighlight } from './utils.js';

const PRIMARY_BUTTON_CANDIDATES = [4, 1, 3, 2, 5, 0];

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
  audioContext,
  showToast,
  onPlacementAvailabilityChanged
}) {
  let connectFirst = null;
  let lastSelectedNote = null;
  let placementEnabled = true;

  function setSelection(mesh) {
    if (connectFirst && connectFirst !== mesh) {
      notesManager.connectNotes(connectFirst, mesh);
      connectFirst = null;
      lastSelectedNote = mesh;
      return;
    }
    connectFirst = mesh;
    lastSelectedNote = mesh;
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
    let nextPlacementEnabled = false;
    let sawGamepad = false;
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
      const usingTrigger = actionIndex === 0;
      if (gamepad) sawGamepad = true;
      if (!usingTrigger && actionIndex !== null) nextPlacementEnabled = true;
      const hoveredNote = controller.userData.hoveredNote;
      if (recorder.isRecording() && gamepad?.buttons?.[1]?.pressed) {
        recorder.cancel();
      }
      controller.userData.actionState = controller.userData.actionState || {
        pressed: false,
        handled: false,
        startedAt: 0
      };
      const state = controller.userData.actionState;

      if (actionPressed && !state.pressed) {
        state.pressed = true;
        state.handled = false;
        state.startedAt = timestamp;
      }

      if (actionPressed && state.pressed && !state.handled) {
        const elapsed = timestamp - state.startedAt;
        const recordingTarget = hoveredNote || lastSelectedNote;
        if (recordingTarget && elapsed > 350) {
          recorder.startRecordingFor(recordingTarget);
          state.handled = true;
        }
      }

      if (!actionPressed && state.pressed) {
        const duration = timestamp - state.startedAt;
        if (!state.handled && duration < 350 && !usingTrigger && !hoveredNote) {
          const placed = notesManager.placeNoteAtController(controller);
          if (placed) setSelection(placed);
        }
        state.pressed = false;
        state.handled = false;
        state.startedAt = 0;
      }

      controller.userData.actionState = state;
    }
    if (sawGamepad && placementEnabled !== nextPlacementEnabled) {
      placementEnabled = nextPlacementEnabled;
      onPlacementAvailabilityChanged?.(placementEnabled);
      if (!placementEnabled) {
        showToast?.('Controller placement disabled on trigger', 'warn');
      }
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
