// hud3d.js
import { THREE } from './scene.js';

export class ScorePanel3D {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;

    this.hitsTaken = 0;
    this.hitsDeflected = 0;

    this.followDistance = 1.2;
    this.minDistance = 0.9;
    this.maxDistance = 1.6;
    this.verticalOffset = 0.25;
    this.smoothing = 0.15;

    this._camWorldPos = new THREE.Vector3();
    this._camForward = new THREE.Vector3();
    this._desiredPos = new THREE.Vector3();
    this._offset = new THREE.Vector3(0, this.verticalOffset, 0);

    // canvas per il testo
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 256;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(0.8, 0.4);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
    });

    this.mesh = new THREE.Mesh(geo, mat);

    scene.add(this.mesh);

    this._redraw();
    this.update();
  }

  _redraw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // sfondo semi-trasparente
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#7cf9ff';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText('TRAINING STATS', 40, 60);

    ctx.fillStyle = '#ffffff';
    ctx.font = '30px monospace';
    ctx.fillText(`Colpi subiti:   ${this.hitsTaken}`, 40, 130);
    ctx.fillText(`Colpi deviati:  ${this.hitsDeflected}`, 40, 180);

    this.texture.needsUpdate = true;
  }

  addHitTaken() {
    this.hitsTaken++;
    this._redraw();
  }

  addHitDeflected() {
    this.hitsDeflected++;
    this._redraw();
  }

  update() {
    if (!this.camera) return;

    const clampedDist = THREE.MathUtils.clamp(
      this.followDistance,
      this.minDistance,
      this.maxDistance
    );

    this.camera.getWorldPosition(this._camWorldPos);
    this.camera.getWorldDirection(this._camForward);

    this._desiredPos
      .copy(this._camWorldPos)
      .addScaledVector(this._camForward, clampedDist)
      .add(this._offset);

    this.mesh.position.lerp(this._desiredPos, this.smoothing);
    this.mesh.quaternion.slerp(this.camera.quaternion, this.smoothing);
  }
}
