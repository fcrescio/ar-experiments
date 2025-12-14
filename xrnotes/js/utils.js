import * as THREE from 'three';

const COLOR_POOL = [0x7dd3fc, 0xa78bfa, 0xf472b6, 0xf97316, 0xf97316, 0x22c55e, 0x38bdf8];

export const pickColor = () => COLOR_POOL[Math.floor(Math.random() * COLOR_POOL.length)];

export function setNoteHighlight(mesh, active) {
  if (mesh?.material?.emissive) {
    mesh.material.emissive.setHex(active ? 0x222222 : 0x000000);
  }
}

export function createTempTools() {
  return {
    raycaster: new THREE.Raycaster(),
    tempMatrix: new THREE.Matrix4(),
    tempVec: new THREE.Vector3()
  };
}
