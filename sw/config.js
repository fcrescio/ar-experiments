// config.js

// Abilita / disabilita la modalità WebXR.
// Se false: il gioco gira in 3D classico (OrbitControls, mouse).
export const USE_XR = true;

// Solo se USE_XR è true:
// - se true: usa immersive-AR (passthrough) tramite ARButton (se supportato)
// - se false: usa immersive-VR classico (sfondo nero)
export const USE_PASSTHROUGH = true;

// Debug visuale/log. In produzione puoi metterlo a false.
export const DEBUG = true;
