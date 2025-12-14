import { setNoteHighlight } from './utils.js';

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

  function updateHover(controller) {
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    const intersects = raycaster.intersectObjects(Array.from(notesManager.notes.values()));
    const previous = controller.userData.hovered;
    const next = intersects[0]?.object ?? null;
    if (previous && previous !== next) {
      setNoteHighlight(previous, false);
    }
    if (next && next !== previous) {
      setNoteHighlight(next, true);
    }
    controller.userData.hovered = next?.userData?.isPanelButton ? null : next;
    return controller.userData.hovered;
  }

  function handleSelect(controller) {
    const hovered = controller.userData.hovered;
    if (recorder.isRecording()) return;
    if (hovered?.userData?.isPanelButton) {
      notesManager.recallNote(hovered.userData.noteId, camera, tempVec);
      return;
    }
    if (hovered) {
      setSelection(hovered);
      notesManager.playNote(hovered, audioContext);
      return;
    }
    const placed = notesManager.placeNoteAtReticle();
    if (placed) {
      setSelection(placed);
    }
  }

  function handleSelectStart(controller) {
    const hovered = controller.userData.hovered;
    if (hovered && !hovered.userData?.isPanelButton) {
      recorder.startRecordingFor(hovered);
    }
  }

  function handleSelectEnd() {
    if (recorder.isRecording()) recorder.stopRecording();
  }

  function updateControllers() {
    for (const controller of controllers) {
      updateHover(controller);
      const btn = panelManager.panelRaycast(controller, raycaster);
      if (btn && controller.userData.hovered !== btn) {
        controller.userData.hovered = btn;
      }

      const gamepad = controller.userData.gamepad;
      const aPressed = gamepad?.buttons?.[4]?.pressed;
      if (aPressed && !controller.userData.buttonAPressed) {
        notesManager.placeNoteAtController(controller);
      }
      controller.userData.buttonAPressed = !!aPressed;
    }
  }

  return {
    handleSelect,
    handleSelectStart,
    handleSelectEnd,
    updateControllers
  };
}
