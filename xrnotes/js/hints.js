import * as THREE from 'three';

function buildTexture(lines) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 420;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(10,10,10,0.8)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.fillStyle = '#7dd3fc';
  ctx.font = 'bold 42px system-ui';
  ctx.fillText('Controls', 36, 60);

  ctx.fillStyle = '#fff';
  ctx.font = '28px system-ui';
  lines.forEach((line, i) => {
    ctx.fillText(line, 36, 120 + i * 46);
  });
  return new THREE.CanvasTexture(canvas);
}

export function createControlHints(renderer) {
  let rightPanel = null;
  let currentLines = [];

  function renderPanel() {
    if (!rightPanel) return;
    const texture = buildTexture(currentLines);
    rightPanel.material.map?.dispose();
    rightPanel.material.map = texture;
    rightPanel.material.needsUpdate = true;
  }

  function setLines(lines = []) {
    currentLines = lines;
    renderPanel();
  }

  function attach(controllers) {
    const right = controllers.find((c) => c.userData.handedness === 'right');
    if (!right || rightPanel) return;
    const grip = renderer.xr.getControllerGrip(right.userData.index);
    const geometry = new THREE.PlaneGeometry(0.38, 0.25);
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95 });
    rightPanel = new THREE.Mesh(geometry, material);
    rightPanel.position.set(0, 0.08, -0.15);
    grip.add(rightPanel);
    renderPanel();
  }

  function setPlacementAvailable(enabled) {
    const base = [
      'Trigger: place/select at reticle',
      enabled
        ? 'Primary tap: place at controller'
        : 'Primary tap disabled on trigger; use another button',
      'Primary hold on note: start recording',
      'Button 1: cancel recording',
      'Left-hand panel: recall notes'
    ];
    setLines(base);
  }

  return {
    attach,
    setPlacementAvailable
  };
}
