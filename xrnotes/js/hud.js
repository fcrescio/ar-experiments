import * as THREE from 'three';

function createCanvas(label, options = {}) {
  const width = options.width || 512;
  const height = options.height || 128;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = options.bg || 'rgba(10,10,10,0.85)';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = options.color || '#fff';
  ctx.font = options.font || '36px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, width / 2, height / 2);
  return { canvas, ctx };
}

function createLabelPlane(text, { width = 0.28, height = 0.08 } = {}) {
  const { canvas } = createCanvas(text);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const geometry = new THREE.PlaneGeometry(width, height);
  const mesh = new THREE.Mesh(geometry, material);
  return { mesh, texture, canvas };
}

function drawMultiline(texture, text, { color = '#fff', tone } = {}) {
  const canvas = texture.image;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(10,10,10,0.85)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = tone === 'error' ? '#ef4444' : tone === 'warn' ? '#f97316' : color;
  ctx.font = 'bold 34px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = text.split('\n');
  const step = 42;
  const startY = canvas.height / 2 - ((lines.length - 1) * step) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, canvas.width / 2, startY + i * step);
  });
  texture.needsUpdate = true;
}

export function createHud(camera) {
  const hudGroup = new THREE.Group();
  hudGroup.position.set(0, -0.05, -0.6);
  hudGroup.renderOrder = 2;

  const statusLabel = createLabelPlane('Ready');
  statusLabel.mesh.position.set(0.14, 0.07, 0);
  hudGroup.add(statusLabel.mesh);

  const recordingLabel = createLabelPlane('Recording stopped', { width: 0.28, height: 0.07 });
  recordingLabel.mesh.position.set(-0.14, 0.07, 0);
  hudGroup.add(recordingLabel.mesh);

  const toastTexture = new THREE.CanvasTexture(createCanvas('', { height: 96 }).canvas);
  const toastMaterial = new THREE.SpriteMaterial({ map: toastTexture, transparent: true, opacity: 0 });
  const toast = new THREE.Sprite(toastMaterial);
  toast.scale.set(0.6, 0.15, 1);
  toast.position.set(0, -0.12, 0);
  hudGroup.add(toast);

  camera.add(hudGroup);

  let toastUntil = 0;

  function setStatus(text, tone = 'info') {
    drawMultiline(statusLabel.texture, text, { tone });
  }

  function setRecording({ active, label, elapsed }) {
    const suffix = elapsed ? ` • ${elapsed.toFixed(1)}s` : '';
    const prefix = active ? 'Recording' : 'Idle';
    drawMultiline(recordingLabel.texture, `${prefix}${label ? ` ${label}` : ''}${suffix}`, {
      color: active ? '#fca5a5' : '#cbd5e1'
    });
  }

  function showToast(message, tone = 'info', timeout = 2200) {
    drawMultiline(toastTexture, message, { tone });
    toastMaterial.opacity = 0.95;
    toastUntil = performance.now() + timeout;
  }

  function update(now) {
    if (toastUntil && now > toastUntil) {
      const remaining = Math.max(0, (toastUntil - now) / 600);
      toastMaterial.opacity = remaining;
      if (remaining <= 0) {
        toastUntil = 0;
        toastMaterial.opacity = 0;
      }
    }
  }

  return {
    setStatus,
    setRecording,
    showToast,
    update
  };
}
