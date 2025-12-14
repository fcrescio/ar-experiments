import * as THREE from 'three';

function makePanelEntry(note) {
  const width = 0.24;
  const height = 0.05;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(20,20,20,0.9)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#7dd3fc';
  ctx.font = 'bold 36px system-ui';
  ctx.fillText(note.userData.label, 16, 48);
  ctx.fillStyle = '#fff';
  ctx.font = '28px system-ui';
  ctx.fillText('Recall', 16, 100);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const geometry = new THREE.PlaneGeometry(width, height);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = { noteId: note.userData.id, isPanelButton: true };
  return mesh;
}

export function createPanelManager(renderer, tempMatrix) {
  let leftHandPanel = null;
  const panelButtons = new Map();

  function refreshPanel(notes) {
    if (!leftHandPanel) return;
    panelButtons.forEach((mesh) => leftHandPanel.remove(mesh));
    panelButtons.clear();
    let y = 0.08;
    for (const note of notes.values()) {
      const btn = makePanelEntry(note);
      btn.position.set(0, y, 0);
      leftHandPanel.add(btn);
      panelButtons.set(note.userData.id, btn);
      y -= 0.07;
    }
  }

  function updatePanelAttachment(controllers, notes) {
    const left = controllers.find((c) => c.userData.handedness === 'left');
    if (!left || leftHandPanel) return;
    const grip = renderer.xr.getControllerGrip(left.userData.index);
    leftHandPanel = new THREE.Group();
    const background = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.32),
      new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0.6, transparent: true })
    );
    background.position.set(0, 0.03, -0.04);
    leftHandPanel.add(background);
    leftHandPanel.position.set(0.05, 0.12, -0.15);
    grip.add(leftHandPanel);
    refreshPanel(notes);
  }

  function panelRaycast(controller, raycaster) {
    if (!leftHandPanel) return null;
    const objects = Array.from(panelButtons.values());
    if (!objects.length) return null;
    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 0, -1);
    origin.setFromMatrixPosition(controller.matrixWorld);
    direction.applyMatrix4(tempMatrix.identity().extractRotation(controller.matrixWorld));
    raycaster.set(origin, direction);
    const hits = raycaster.intersectObjects(objects, true);
    return hits[0]?.object ?? null;
  }

  return {
    panelButtons,
    refreshPanel,
    updatePanelAttachment,
    panelRaycast,
    get leftHandPanel() {
      return leftHandPanel;
    }
  };
}
