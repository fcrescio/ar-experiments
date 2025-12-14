import * as THREE from 'three';
import { pickColor } from './utils.js';

export function createNotesManager(scene, reticle, tempVec, setStatus, onChange, onRemove) {
  const notes = new Map();
  const lines = new Set();
  let noteCounter = 1;

  function createNoteMesh(position) {
    const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2);
    const label = `Note ${noteCounter++}`;
    const geometry = new THREE.SphereGeometry(0.055, 32, 32);
    const material = new THREE.MeshStandardMaterial({ color: pickColor(), roughness: 0.4, metalness: 0.05 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.userData = { id, label, audioBuffer: null };
    scene.add(mesh);
    notes.set(id, mesh);
    onChange?.();
    setStatus?.(`${label} placed.`);
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
      }
    }
    onRemove?.(mesh);
    onChange?.();
  }

  function connectNotes(a, b) {
    const points = [a.position.clone(), b.position.clone()];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
    const line = new THREE.Line(geometry, material);
    line.userData.ids = [a.userData.id, b.userData.id];
    scene.add(line);
    lines.add(line);
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
  }

  function updateLines() {
    for (const line of lines) {
      updateLineGeometry(line);
    }
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
    updateLines
  };
}
