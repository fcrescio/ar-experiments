import * as THREE from 'three';
import { pickColor } from './utils.js';

export function createNotesManager(scene, reticle, tempVec, { setStatus, onChange, onRemove, initialCounter = 1 } = {}) {
  const notes = new Map();
  const lines = new Set();
  let noteCounter = initialCounter;

  function createNoteMesh(position, existingData = {}) {
    const id = existingData.id ?? (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2));
    const label = existingData.label ?? `Note ${noteCounter++}`;
    const color = existingData.color ?? pickColor();
    const geometry = new THREE.SphereGeometry(0.055, 32, 32);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.05 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.userData = {
      id,
      label,
      audioBuffer: existingData.audioBuffer ?? null,
      audioBlob: existingData.audioBlob ?? null
    };
    scene.add(mesh);
    notes.set(id, mesh);
    onChange?.({ type: 'add', note: mesh, noteCounter });
    if (!existingData.silent) setStatus?.(`${label} placed.`);
    return mesh;
  }

  function placeNoteAtReticle() {
    if (!reticle.visible) return null;
    tempVec.setFromMatrixPosition(reticle.matrix);
    return createNoteMesh(tempVec);
  }

  function placeNoteAtController(controller) {
    controller.getWorldPosition(tempVec);
    return createNoteMesh(tempVec);
  }

  function playNote(mesh, audioContext) {
    const buffer = mesh.userData.audioBuffer;
    if (!buffer) return;
    const src = audioContext.createBufferSource();
    src.buffer = buffer;
    src.connect(audioContext.destination);
    src.start();
  }

  function removeNote(mesh) {
    const id = mesh.userData.id;
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    notes.delete(id);
    for (const line of Array.from(lines)) {
      if (line.userData.ids.includes(id)) {
        scene.remove(line);
        line.geometry.dispose();
        line.material.dispose();
        lines.delete(line);
        onChange?.({ type: 'disconnect', ids: line.userData.ids });
      }
    }
    onRemove?.(mesh);
    onChange?.({ type: 'remove', note: mesh });
  }

  function connectNotes(a, b) {
    const points = [a.position.clone(), b.position.clone()];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
    const line = new THREE.Line(geometry, material);
    line.userData.ids = [a.userData.id, b.userData.id];
    scene.add(line);
    lines.add(line);
    onChange?.({ type: 'connect', ids: line.userData.ids, line });
  }

  function updateLineGeometry(line) {
    const [idA, idB] = line.userData.ids;
    const a = notes.get(idA);
    const b = notes.get(idB);
    if (!a || !b) return;
    const positions = new Float32Array([
      a.position.x, a.position.y, a.position.z,
      b.position.x, b.position.y, b.position.z
    ]);
    line.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    line.geometry.computeBoundingSphere();
  }

  function recallNote(id, camera, forwardVec) {
    const mesh = notes.get(id);
    if (!mesh) return;
    camera.getWorldDirection(forwardVec);
    forwardVec.normalize().multiplyScalar(0.6);
    const targetPos = new THREE.Vector3();
    targetPos.copy(camera.position).add(forwardVec);
    mesh.position.copy(targetPos);
    for (const line of lines) {
      if (line.userData.ids.includes(id)) updateLineGeometry(line);
    }
    setStatus?.(`${mesh.userData.label} moved in front of you.`);
    onChange?.({ type: 'move', note: mesh });
  }

  function updateLines() {
    for (const line of lines) {
      updateLineGeometry(line);
    }
  }

  function loadFromData(noteData = [], lineData = []) {
    const seenLabels = [];
    for (const saved of noteData) {
      const position = new THREE.Vector3(...(saved.position ?? [0, 0, 0]));
      createNoteMesh(position, { ...saved, silent: true });
      const labelNumber = Number(saved.label?.split(' ')[1]);
      if (!Number.isNaN(labelNumber)) seenLabels.push(labelNumber);
    }
    for (const entry of lineData) {
      const [idA, idB] = entry.ids || [];
      const a = notes.get(idA);
      const b = notes.get(idB);
      if (a && b) connectNotes(a, b);
    }
    const maxLabel = Math.max(initialCounter, ...(seenLabels.length ? seenLabels : [initialCounter]));
    noteCounter = Math.max(noteCounter, maxLabel + 1);
    onChange?.({ type: 'sync' });
  }

  function setNoteCounter(next) {
    noteCounter = Math.max(next, noteCounter);
  }

  return {
    notes,
    lines,
    placeNoteAtReticle,
    placeNoteAtController,
    playNote,
    removeNote,
    connectNotes,
    updateLineGeometry,
    recallNote,
    updateLines,
    loadFromData,
    setNoteCounter,
    get nextLabelNumber() {
      return noteCounter;
    }
  };
}
