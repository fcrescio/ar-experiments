// game.js
import { DEBUG } from './config.js';
import { Saber } from './saber.js';
import { Drone } from './drone.js';
import { ScorePanel3D } from './hud3d.js';

export function setupGame(scene, camera, renderer, isXR, audioListener) {
  // crea spada
  const saber = new Saber(scene, camera, renderer, isXR, 'right', audioListener);

  // crea drone
  const drone = new Drone(scene, camera);

  // crea pannello punteggio
  const scorePanel = new ScorePanel3D(scene);

  // collega callback punteggio
  drone.onPlayerHit = () => {
    scorePanel.addHitTaken();
    if (DEBUG) console.log('Player hit (score++)');
  };

  drone.onBoltDeflected = () => {
    scorePanel.addHitDeflected();
    if (DEBUG) console.log('Bolt deflected (score++)');
  };

  // HUD debug vecchio puoi anche toglierlo, o tenerlo qui se ti serve ancora

  function update(dt) {
    saber.update(dt);
    drone.update(dt, saber);
    // nient’altro, tutto il resto è dentro i moduli
  }

  return { update };
}
