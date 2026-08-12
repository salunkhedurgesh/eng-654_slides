import * as THREE from
  "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
/* import {
  OrbitControls
} from
"https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js"; */
import { OrbitControls } from
  "three/addons/controls/OrbitControls.js";

const container = document.getElementById("three-demo");

if (!container) {
  throw new Error(
    "Three.js container #three-demo not found."
  );
}

const scene =  new THREE.Scene();

const camera =
  new THREE.PerspectiveCamera(
    45,
    container.clientWidth /
      container.clientHeight,
    0.01,
    100
  );
/* 
45       field of view

width /
height   aspect ratio

0.01     near clipping plane

100      far clipping plane
*/

camera.position.set(
  3,
  2,
  3
);
/* 
This means the camera sits at (3, 2, 3)
*/

camera.lookAt(
  0,
  0,
  0
);
/* Tell it to look at the origin: */

const renderer =
  new THREE.WebGLRenderer({
    antialias: true,
    alpha: true
  });

renderer.setPixelRatio(
  Math.min(
    window.devicePixelRatio,
    2
  )
);
/*This keeps the rendering sharp without unnecessarily rendering huge pixel counts on high-DPI displays  */

/* attaching the renderer's canvas to your HTML */
container.appendChild(
  renderer.domElement
);

function resizeRenderer() {

  const width =
    container.clientWidth;

  const height =
    container.clientHeight;


  renderer.setSize(
    width,
    height,
    false
  );


  camera.aspect =
    width / height;

  camera.updateProjectionMatrix();
}

resizeRenderer();
/* 
The above part is very important in a presentation.

Your 3D viewer must adapt to:

projector
laptop
fullscreen
browser resize
40/60 slide layout
*/

const axes =
  new THREE.AxesHelper(1.5);

const robotWorld = new THREE.Group();

robotWorld.rotation.x = -Math.PI / 2;

scene.add(robotWorld);

robotWorld.add(axes);

const jointGeometry =
  new THREE.CylinderGeometry(
    0.15,
    0.15,
    0.35,
    32
  );
/* 
top radius       0.15
bottom radius    0.15
height           0.35
32 segments
*/

const jointMaterial =
  new THREE.MeshStandardMaterial({
    color: 0x111111
  });

const joint =
  new THREE.Mesh(
    jointGeometry,
    jointMaterial
  );

  joint.rotation.x = Math.PI/2;
robotWorld.add(joint);

const linkGeometry =
  new THREE.BoxGeometry(
    1.6,
    0.18,
    0.18
  );

const linkMaterial =
  new THREE.MeshStandardMaterial({
    color: 0xff0000
  });

const link =
  new THREE.Mesh(
    linkGeometry,
    linkMaterial
  );

link.position.x = 0.8;

const revoluteJoint =  new THREE.Group();

robotWorld.add(
  revoluteJoint
);
revoluteJoint.add(
  link
);

revoluteJoint.add(
  joint
);

/* joint.rotation.x =  Math.PI / 2; */

const ambientLight =
  new THREE.AmbientLight(
    0xffffff,
    1.5
  );

scene.add(
  ambientLight
);

const directionalLight =
  new THREE.DirectionalLight(
    0xffffff,
    2
  );

directionalLight.position.set(
  3,
  4,
  5
);

scene.add(
  directionalLight
);

renderer.render(
  scene,
  camera
);

function animate(time) {

  const t =
    time / 1000;

  const q =
    0.8 * Math.sin(t);


  revoluteJoint.rotation.z =
    q;


  renderer.render(
    scene,
    camera
  );


  requestAnimationFrame(
    animate
  );
}
requestAnimationFrame(animate);

window.addEventListener(
  "resize",
  resizeRenderer
);

const resizeObserver =
  new ResizeObserver(() => {

    resizeRenderer();

  });

resizeObserver.observe(
  container
);

const controls =
  new OrbitControls(
    camera,
    renderer.domElement
  );

controls.enableDamping = true;

controls.update();
