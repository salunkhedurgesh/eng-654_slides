import * as THREE from 'three';

export function createZUpWorld(scene) {
  const robotWorld = new THREE.Group();
  // Robotics convention: z-axis up. Three.js is y-up, so rotate root by Rx(-pi/2).
  robotWorld.rotation.x = -Math.PI / 2;
  scene.add(robotWorld);
  return robotWorld;
}

export function resizeRendererToContainer(renderer, camera, container) {
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
