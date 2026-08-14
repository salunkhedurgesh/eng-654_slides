import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createZUpWorld, resizeRendererToContainer } from './threeUtils.js';
import { parseStlGeometry } from './frameDHPlayground.js?v=20260814-3';

const DEG = Math.PI / 180;
const TARGET_Q = [30 * DEG, -45 * DEG, 60 * DEG];
const ALT_Q = [61.13874521415761 * DEG, -34.101298839110584 * DEG, -19.4501394127546 * DEG];
const TARGET_P = new THREE.Vector3(1.12243744, 3.59141523, 3.12132034);
const AXES = [
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1)
];
const AXIS_POINTS = [
  new THREE.Vector3(0, 0, .5),
  new THREE.Vector3(1, 0, 1),
  new THREE.Vector3(3, 1.25, 1)
];
const HOME_TOOL = new THREE.Vector3(4.5, 1.25, 1.25);
const HOME_LINKS = [
  new THREE.Matrix4(),
  new THREE.Matrix4().makeTranslation(0, 0, .5),
  new THREE.Matrix4().makeTranslation(1, 0, 1),
  new THREE.Matrix4().makeTranslation(3, 1.25, 1)
];
const VISUAL_ORIGINS = [
  new THREE.Matrix4(),
  new THREE.Matrix4(),
  rpyMatrix(0, .25, 0, 0, 0, -1.5707),
  new THREE.Matrix4().makeTranslation(0, 0, .25)
];
const MESH_SPECS = [
  { file: 'base_link.stl', prefix: 0, color: 0x333638 },
  { file: 'link_1.stl', prefix: 1, color: 0x0d7d80 },
  { file: 'link_2.stl', prefix: 2, color: 0xb8b8b8 },
  { file: 'link_3.stl', prefix: 3, color: 0x0d7d80 }
];

let geometryPromise;

export function initCustom3RIkDemos() {
  const hosts = [...document.querySelectorAll('[data-custom3r-ik]')];
  if (!hosts.length) return;
  const instances = new WeakMap();
  function ensure(host) {
    const existing = instances.get(host);
    if (existing?.timer) {
      clearTimeout(existing.timer);
      existing.timer = null;
    }
    if (!existing) {
      const instance = createDemo(host);
      instances.set(host, { instance, timer: null });
    }
  }
  function scheduleDispose(host) {
    const existing = instances.get(host);
    if (existing && !existing.timer) {
      existing.timer = setTimeout(() => {
        existing.instance.dispose();
        instances.delete(host);
      }, 2200);
    }
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) ensure(entry.target);
      else scheduleDispose(entry.target);
    });
  }, { threshold: .04, rootMargin: '80px' });
  hosts.forEach((host) => observer.observe(host));

  // Horizontal deck navigation uses a large CSS transform. Some Chromium
  // versions briefly report zero intersection during the initial hash jump,
  // so also activate the slide named by the deck hash explicitly.
  let lastHash = '';
  const syncHashSlide = () => {
    if (location.hash === lastHash) return;
    lastHash = location.hash;
    const match = location.hash.match(/#slide-(\d+)/);
    const index = match ? Math.max(0, Number(match[1]) - 1) : 0;
    const slide = document.querySelectorAll('#deck > .slide')[index];
    slide?.querySelectorAll('[data-custom3r-ik]').forEach(ensure);
  };
  syncHashSlide();
  setTimeout(() => { lastHash = ''; syncHashSlide(); }, 350);
  setInterval(syncHashSlide, 300);
}

function createDemo(container) {
  const mode = container.dataset.mode || 'robot';
  container.classList.add('ik3r-demo');
  container.innerHTML = '<div class="ik3r-canvas"></div><p class="ik3r-note"></p><div class="ik3r-controls"></div>';
  const stage = container.querySelector('.ik3r-canvas');
  const note = container.querySelector('.ik3r-note');
  const controlHost = container.querySelector('.ik3r-controls');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfcfcfc);
  const camera = new THREE.PerspectiveCamera(38, 1, .01, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.8);
  key.position.set(5, 8, 7);
  scene.add(key);
  const world = createZUpWorld(scene);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .08;
  controls.target.set(2, 1.1, -.65);
  camera.position.set(7, 5.5, 6);
  controls.update();
  const cleaners = [];
  let alive = true;
  let update = () => {};

  const kit = {
    container, mode, scene, world, camera, renderer, controls, note, controlHost, cleaners,
    setCamera(position, target = [2, 1, -.65]) {
      camera.position.fromArray(position);
      controls.target.fromArray(target);
      controls.update();
    }
  };

  addGrid(world);
  Promise.resolve(buildMode(kit)).then((modeUpdate) => {
    if (!alive) return;
    if (typeof modeUpdate === 'function') update = modeUpdate;
  }).catch((error) => {
    note.textContent = 'Three.js scene could not load: ' + error.message;
    note.classList.add('is-error');
    console.error('custom_3R IK visualization failed:', error);
  });

  const resize = () => resizeRendererToContainer(renderer, camera, stage);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  resize();
  let last = performance.now();
  function animate(time) {
    if (!alive) return;
    const dt = Math.min((time - last) / 1000, .05);
    last = time;
    update(time / 1000, dt);
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  return {
    dispose() {
      alive = false;
      resizeObserver.disconnect();
      cleaners.forEach((fn) => fn());
      scene.traverse(disposeObject);
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      container.innerHTML = '';
    }
  };
}

async function buildMode(kit) {
  switch (kit.mode) {
    case 'dimensions': return buildDimensions(kit);
    case 'dh-motion': return buildDhMotion(kit);
    case 'top': return buildTopView(kit);
    case 'u-vector': return buildUVector(kit);
    case 'uv': return buildUvRotation(kit);
    case 'height': return buildHeightInvariant(kit);
    case 'radial': return buildRadialInvariant(kit);
    case 'roots': return buildRoots(kit);
    case 'back2': return buildBackprop(kit, 2);
    case 'back1': return buildBackprop(kit, 1);
    case 'degeneracy': return buildDegeneracy(kit);
    case 'orbit': return buildOrbit(kit);
    case 'circle-distance': return buildCircleDistance(kit);
    case 'pk1': return buildPk1(kit);
    case 'pk3': return buildPk3(kit);
    case 'intersecting': return buildIntersecting(kit);
    case 'pipeline': return buildPipeline(kit);
    default: return buildDhMotion(kit);
  }
}

async function buildDimensions(kit) {
  kit.setCamera([9, 6.7, 8]);
  const robot = await createRobot(kit.world, [0, 0, 0]);
  addJointAxes(kit.world, [0, 0, 0], true);
  const dims = [
    [[0, 0, 0], [0, 0, 1], 'd₁ = 0.5 + 0.5 = 1.0 m', 0xff0000],
    [[0, 0, 1], [1, 0, 1], 'a₁ = 1.0 m', 0x111111],
    [[1, 0, 1], [1, 1.25, 1], 'd₂ = 1.25 m', 0x3f6ea8],
    [[1, 1.25, 1], [3, 1.25, 1], 'a₂ = 2.0 m', 0x111111],
    [[3, 1.25, 1.25], [4.5, 1.25, 1.25], 'a₃ = 1.5 m', 0xff0000]
  ];
  dims.forEach(([a, b, text, color]) => addDimension(kit.world, v(a), v(b), text, color));
  addDimension(kit.world, v([3, 1.25, 1]), v([3, 1.25, 1.25]), 'd₃ = 0.25 m', 0x888888, .75);
  kit.note.textContent = 'custom_3R home geometry · drag to orbit · dimensions connect consecutive D–H axes';
  return () => robot.update([0, 0, 0]);
}

async function buildDhMotion(kit) {
  kit.setCamera([7, 5.4, 6.2]);
  const robot = await createRobot(kit.world, [0, 0, 0]);
  const target = TARGET_Q.slice();
  const q = [0, 0, 0];
  addTarget(kit.world, TARGET_P, 'p_d');
  kit.note.textContent = 'custom_3R · D–H forward motion to q = (30°, −45°, 60°)';
  return (time, dt) => {
    const phase = .5 - .5 * Math.cos(Math.min(1, (time % 8) / 3) * Math.PI);
    q.forEach((_, i) => { q[i] += (target[i] * phase - q[i]) * Math.min(1, 5 * dt); });
    robot.update(q);
  };
}

async function buildTopView(kit) {
  kit.setCamera([2.1, 14, -.8], [2.1, 1.1, -.8]);
  kit.controls.enableRotate = true;
  const robot = await createRobot(kit.world, TARGET_Q);
  addTarget(kit.world, TARGET_P, 'p_d');
  addRing(kit.world, new THREE.Vector3(0, 0, 1), 3.762735, 0x3f6ea8, 1.3);
  addDimension(kit.world, v([0, 0, 1]), v([0, 0, 3.12132034]), 'z̄ = zₑ − d₁ = 2.1213 m', 0xff0000);
  addDimension(kit.world, v([0, 0, 0]), v([0, 0, 1]), 'subtract d₁ = 1.0 m', 0x111111);
  kit.note.textContent = 'top view is the default · R = x² + y² = 14.1581 m² · drag to tilt';
  return () => robot.update(TARGET_Q);
}

async function buildUVector(kit) {
  kit.setCamera([7.3, 5.2, 5.8]);
  const robot = await createRobot(kit.world, TARGET_Q);
  const origin = new THREE.Vector3(1, 0, 1);
  // Frame 1 has x₁ = x_W, y₁ = -z_W, z₁ = y_W at q₁ = 0.
  const u = new THREE.Vector3(2.75, 2.549038, .25);
  addVector(kit.world, origin, u, 0xff0000, 'u(60°) = [2.750, −0.250, 2.549]ᵀ');
  addVector(kit.world, origin, new THREE.Vector3(.65, 0, 0), 0xe74c3c, 'x₁');
  addVector(kit.world, origin, new THREE.Vector3(0, 0, -.65), 0x35a853, 'y₁');
  addVector(kit.world, origin, new THREE.Vector3(0, .65, 0), 0x2775ff, 'z₁');
  kit.note.textContent = 'u is expressed before the θ₂ rotation · q₃ slider is frozen at 60°';
  return () => robot.update(TARGET_Q);
}

async function buildUvRotation(kit) {
  kit.setCamera([6.8, 5.8, 6.5]);
  const robot = await createRobot(kit.world, TARGET_Q);
  const center = new THREE.Vector3(1, 0, 1);
  addRingInPlane(kit.world, center, 2.76134, new THREE.Vector3(0, 1, 0), 0x3f6ea8);
  addVector(kit.world, center, new THREE.Vector3(2.75, 0, .25), 0x777777, '[uₓ,uᵧ]');
  addVector(kit.world, center, new THREE.Vector3(1.767767, 0, 2.12132), 0xff0000, '[U,V]');
  kit.note.textContent = 'θ₂ rotates one planar vector into the other · both lengths = 2.7613 m';
  return () => robot.update(TARGET_Q);
}

async function buildHeightInvariant(kit) {
  kit.setCamera([7.1, 4.7, 6.2]);
  const robot = await createRobot(kit.world, TARGET_Q);
  addTarget(kit.world, TARGET_P, 'z_e = 3.1213');
  addDimension(kit.world, v([0, 0, 1]), v([0, 0, 3.12132034]), 'z̄ = 2.1213 m', 0xff0000);
  const plane = new THREE.GridHelper(8, 16, 0xaaaaaa, 0xdddddd);
  plane.rotation.x = Math.PI / 2;
  plane.position.z = 1;
  kit.world.add(plane);
  kit.note.textContent = 'subtracting d₁ moves the reference plane from world z = 0 to D–H z = 0';
  return () => robot.update(TARGET_Q);
}

async function buildRadialInvariant(kit) {
  kit.setCamera([2.1, 14, -.8], [2.1, 1.1, -.8]);
  const robot = await createRobot(kit.world, TARGET_Q);
  addTarget(kit.world, TARGET_P, 'p_d');
  addRing(kit.world, new THREE.Vector3(0, 0, 3.12132034), Math.sqrt(14.15812917), 0xff0000, 1.5);
  addVector(kit.world, new THREE.Vector3(0, 0, 3.12132034), new THREE.Vector3(TARGET_P.x, TARGET_P.y, 0), 0x3f6ea8, '√R = 3.7627 m');
  kit.note.textContent = 'θ₁ changes azimuth only · the red radial circle is invariant';
  return () => robot.update(TARGET_Q);
}

async function buildRoots(kit) {
  kit.setCamera([7.2, 5.4, 6.6]);
  const a = await createRobot(kit.world, TARGET_Q, { opacity: .8, colors: [0x333638, 0x0d7d80, 0xb8b8b8, 0x0d7d80] });
  const b = await createRobot(kit.world, ALT_Q, { opacity: .42, colors: [0x333638, 0xff5555, 0xffbbbb, 0xff5555] });
  addTarget(kit.world, TARGET_P, 'same p_d');
  kit.note.textContent = 'two real quartic roots · teal (30°, −45°, 60°) · red (61.139°, −34.101°, −19.450°)';
  return (time) => {
    a.group.visible = Math.sin(time * .8) > -.8;
    b.group.visible = Math.sin(time * .8) < .8;
  };
}

async function buildBackprop(kit, joint) {
  kit.setCamera(joint === 2 ? [6.8, 5.5, 6.3] : [2.1, 14, -.8], [2.1, 1.1, -.8]);
  const robot = await createRobot(kit.world, TARGET_Q);
  addTarget(kit.world, TARGET_P, 'p_d');
  if (joint === 2) {
    addVector(kit.world, v([1, 0, 1]), v([2.75, 0, .25]), 0x777777, 'atan2(u_y,u_x) = −5.194°');
    addVector(kit.world, v([1, 0, 1]), v([1.767767, 0, 2.12132]), 0xff0000, 'atan2(V,U) = −50.194°');
    kit.note.textContent = 'θ₂ = −50.194° − (−5.194°) = −45.000°';
  } else {
    addVector(kit.world, v([0, 0, 1]), v([2.767767, 2.549038, 0]), 0x777777, 'pre-rotation azimuth = 42.644°');
    addVector(kit.world, v([0, 0, 1]), v([TARGET_P.x, TARGET_P.y, 0]), 0xff0000, 'target azimuth = 72.644°');
    kit.note.textContent = 'θ₁ = 72.644° − 42.644° = 30.000°';
  }
  return () => robot.update(TARGET_Q);
}

function buildDegeneracy(kit) {
  kit.setCamera([6.8, 5.3, 6.2]);
  const root = new THREE.Group();
  kit.world.add(root);
  const axis1 = makeAxis(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1), 3.6, 0x111111);
  const axis2 = makeAxis(new THREE.Vector3(1, 0, 1), new THREE.Vector3(0, 1, 0), 4.2, 0xff0000);
  root.add(axis1, axis2);
  const dimension = addDimension(root, v([0, 0, 1]), v([1, 0, 1]), 'a₁ → 0', 0x3f6ea8);
  kit.note.textContent = 'animate the common-normal distance: generic custom_3R → intersecting-axis case';
  return (time) => {
    const a = .5 + .5 * Math.cos(time * .65);
    axis2.position.x = -1 + a;
    dimension.scale.x = Math.max(a, .001);
    dimension.visible = a > .03;
  };
}

function buildOrbit(kit) {
  kit.setCamera([5.8, 4.8, 5.6], [0, 1, 0]);
  const axis = makeAxis(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 4, 0x111111);
  kit.world.add(axis);
  addRing(kit.world, new THREE.Vector3(0, 0, 1), 2, 0x3f6ea8, 2);
  const point = sphere(.12, 0xff0000);
  kit.world.add(point);
  addLabel(kit.world, new THREE.Vector3(0, 0, 1), 'center p∥');
  kit.note.textContent = 'one revolute coordinate traces one orbit circle';
  return (time) => point.position.set(2 * Math.cos(time), 2 * Math.sin(time), 1);
}

function buildCircleDistance(kit) {
  kit.setCamera([5.8, 5.6, 6.3], [0, 1, 0]);
  const first = addRing(kit.world, new THREE.Vector3(-.7, 0, 1), 1.7, 0x111111, 2);
  const second = addRing(kit.world, new THREE.Vector3(1.6, 0, 1), 1.35, 0xff0000, 2);
  kit.note.textContent = 'center distance d changes: separate → tangent → two intersections → contained';
  return (time) => {
    const d = 2.25 + 1.7 * Math.sin(time * .55);
    second.position.x = -.7 + d;
    first.rotation.z = 0;
  };
}

function buildPk1(kit) {
  kit.setCamera([5.7, 4.8, 5.8], [0, 1, 0]);
  kit.world.add(makeAxis(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 4, 0x111111));
  addRing(kit.world, new THREE.Vector3(0, 0, 1), 2, 0xaaaaaa, 2);
  const p = sphere(.12, 0x3f6ea8), q = sphere(.12, 0xff0000), moving = sphere(.1, 0xd79b00);
  p.position.set(2, 0, 1);
  q.position.set(0, 2, 1);
  kit.world.add(p, q, moving);
  addLabel(kit.world, p.position.clone(), 'p');
  addLabel(kit.world, new THREE.Vector3(0, 2, 1), 'q');
  kit.note.textContent = 'PK1 · rotate p onto q · the signed orbit angle is θ';
  return (time) => {
    const theta = (Math.sin(time * .75) * .5 + .5) * Math.PI / 2;
    moving.position.set(2 * Math.cos(theta), 2 * Math.sin(theta), 1);
  };
}

function buildPk3(kit) {
  kit.setCamera([6.2, 5.2, 6.5], [0, 1, 0]);
  addRing(kit.world, new THREE.Vector3(0, 0, 1), 2.1, 0x111111, 2);
  addRing(kit.world, new THREE.Vector3(1.9, 0, 1), 1.55, 0xff0000, 2);
  const p1 = sphere(.12, 0x3f6ea8), p2 = sphere(.12, 0x3f6ea8);
  const x = (2.1 ** 2 - 1.55 ** 2 + 1.9 ** 2) / (2 * 1.9);
  const y = Math.sqrt(2.1 ** 2 - x ** 2);
  p1.position.set(x, y, 1); p2.position.set(x, -y, 1);
  kit.world.add(p1, p2);
  kit.note.textContent = 'PK3 · orbit circle ∩ distance circle · the two blue points are θ = γ ± φ';
  return (time) => {
    const pulse = 1 + .18 * Math.sin(time * 3);
    p1.scale.setScalar(pulse); p2.scale.setScalar(2 - pulse);
  };
}

function buildIntersecting(kit) {
  kit.setCamera([6.5, 5.3, 6.3], [1, 1, -.4]);
  const c = new THREE.Vector3(0, 0, 1);
  kit.world.add(makeAxis(c, new THREE.Vector3(0, 0, 1), 4, 0x111111));
  kit.world.add(makeAxis(c, new THREE.Vector3(0, 1, 0), 4, 0xff0000));
  kit.world.add(sphere(.13, 0x3f6ea8));
  kit.world.children.at(-1).position.copy(c);
  addLabel(kit.world, c, 'c · fixed by joints 1 and 2');
  addLabel(kit.world, c.clone().add(new THREE.Vector3(.55, .15, .15)), 'a₁ = 0', 0x3f6ea8);
  kit.note.textContent = 'intersecting axes share c · distances from c eliminate θ₁ and θ₂';
  return () => {};
}

async function buildPipeline(kit) {
  kit.setCamera([7.2, 5.4, 6.6]);
  const robot = await createRobot(kit.world, [0, 0, 0]);
  addTarget(kit.world, TARGET_P, 'p_d');
  const q = [0, 0, 0];
  kit.note.textContent = 'numerical solve replay · θ₃ = 60° → θ₂ = −45° → θ₁ = 30°';
  return (time, dt) => {
    const phase = time % 9;
    const desired = [0, 0, 0];
    if (phase > 1) desired[2] = TARGET_Q[2] * Math.min(1, phase - 1);
    if (phase > 3.3) desired[1] = TARGET_Q[1] * Math.min(1, phase - 3.3);
    if (phase > 5.6) desired[0] = TARGET_Q[0] * Math.min(1, phase - 5.6);
    q.forEach((_, i) => { q[i] += (desired[i] - q[i]) * Math.min(1, 7 * dt); });
    robot.update(q);
  };
}

async function createRobot(world, q = [0, 0, 0], options = {}) {
  const geometries = await loadGeometries();
  const group = new THREE.Group();
  world.add(group);
  const visuals = [];
  MESH_SPECS.forEach((spec, i) => {
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    const color = options.colors?.[i] ?? spec.color;
    const opacity = options.opacity ?? 1;
    const mesh = new THREE.Mesh(geometries[i].clone(), new THREE.MeshStandardMaterial({
      color, roughness: .62, metalness: .06, transparent: opacity < 1,
      opacity, depthWrite: opacity > .85
    }));
    holder.add(mesh);
    group.add(holder);
    visuals.push({ holder, prefix: spec.prefix, home: HOME_LINKS[i].clone().multiply(VISUAL_ORIGINS[i]) });
  });
  function update(values) {
    visuals.forEach((item) => {
      item.holder.matrix.multiplyMatrices(prefixMatrix(values, item.prefix), item.home);
      item.holder.matrixWorldNeedsUpdate = true;
    });
  }
  update(q);
  return { group, update };
}

function loadGeometries() {
  if (!geometryPromise) {
    const root = new URL('../../assets/models/custom_3R/', import.meta.url);
    geometryPromise = Promise.all(MESH_SPECS.map(async (spec) => {
      const response = await fetch(new URL(spec.file, root));
      if (!response.ok) throw new Error('Could not load ' + spec.file);
      return parseStlGeometry(await response.arrayBuffer());
    }));
  }
  return geometryPromise;
}

function prefixMatrix(q, count) {
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < count; i += 1) matrix.multiply(expRevolute(AXES[i], AXIS_POINTS[i], q[i]));
  return matrix;
}

function expRevolute(axis, point, angle) {
  const matrix = new THREE.Matrix4().makeRotationAxis(axis, angle);
  const rotated = point.clone().applyMatrix4(matrix);
  matrix.setPosition(point.clone().sub(rotated));
  return matrix;
}

function addJointAxes(world, q, labels = false) {
  const axes = [
    { p: AXIS_POINTS[0], w: AXES[0], prefix: 0, text: 'z₀ · joint 1' },
    { p: AXIS_POINTS[1], w: AXES[1], prefix: 1, text: 'z₁ · joint 2' },
    { p: AXIS_POINTS[2], w: AXES[2], prefix: 2, text: 'z₂ · joint 3' }
  ];
  axes.forEach((axis) => {
    const m = prefixMatrix(q, axis.prefix);
    const p = axis.p.clone().applyMatrix4(m);
    const w = axis.w.clone().transformDirection(m);
    world.add(makeAxis(p, w, 4.2, 0x222222));
    if (labels) addLabel(world, p.clone().add(w.clone().multiplyScalar(1.7)), axis.text);
  });
}

function makeAxis(point, direction, length, color) {
  const start = point.clone().addScaledVector(direction, -length / 2);
  const end = point.clone().addScaledVector(direction, length / 2);
  return tube(start, end, .025, color, .72);
}

function addGrid(world) {
  const grid = new THREE.GridHelper(8, 16, 0xcccccc, 0xe8e8e8);
  grid.rotation.x = Math.PI / 2;
  world.add(grid);
}

function addTarget(world, point, text) {
  const marker = sphere(.14, 0xff0000);
  marker.position.copy(point);
  world.add(marker);
  addLabel(world, point.clone().add(new THREE.Vector3(.1, .1, .32)), text);
}

function addDimension(world, start, end, text, color = 0x111111, opacity = 1) {
  const group = new THREE.Group();
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length < 1e-4) return group;
  const normal = new THREE.Vector3(0, 0, 1);
  if (Math.abs(direction.clone().normalize().dot(normal)) > .9) normal.set(0, 1, 0);
  const cap = normal.clone().cross(direction).normalize().multiplyScalar(.12);
  group.add(tube(start, end, .018, color, opacity));
  group.add(tube(start.clone().sub(cap), start.clone().add(cap), .014, color, opacity));
  group.add(tube(end.clone().sub(cap), end.clone().add(cap), .014, color, opacity));
  addLabel(group, start.clone().lerp(end, .5).add(cap.clone().multiplyScalar(1.3)), text, color);
  world.add(group);
  return group;
}

function addVector(world, origin, vector, color, text) {
  const end = origin.clone().add(vector);
  const group = new THREE.Group();
  group.add(tube(origin, end, .035, color));
  const cone = new THREE.Mesh(new THREE.ConeGeometry(.11, .28, 20), new THREE.MeshStandardMaterial({ color }));
  cone.position.copy(end);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.clone().normalize());
  group.add(cone);
  addLabel(group, end.clone().add(new THREE.Vector3(.08, .08, .18)), text, color);
  world.add(group);
  return group;
}

function addAxisTriad(world, origin, scale) {
  addVector(world, origin, new THREE.Vector3(scale, 0, 0), 0xe74c3c, 'x');
  addVector(world, origin, new THREE.Vector3(0, scale, 0), 0x35a853, 'y');
  addVector(world, origin, new THREE.Vector3(0, 0, scale), 0x2775ff, 'z');
}

function addRing(world, center, radius, color, width = 1) {
  return addRingInPlane(world, center, radius, new THREE.Vector3(0, 0, 1), color, width);
}

function addRingInPlane(world, center, radius, normal, color, width = 1) {
  const curve = new THREE.EllipseCurve(0, 0, radius, radius, 0, Math.PI * 2);
  const points = curve.getPoints(128).map((p) => new THREE.Vector3(p.x, p.y, 0));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const ring = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, linewidth: width }));
  ring.position.copy(center);
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
  world.add(ring);
  return ring;
}

function tube(start, end, radius, color, opacity = 1) {
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), 16),
    new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity })
  );
  mesh.position.copy(start).add(end).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function sphere(radius, color) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 16),
    new THREE.MeshStandardMaterial({ color, roughness: .5 })
  );
}

function addLabel(parent, position, text, color = 0x111111) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = '700 28px Arial';
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width + 28);
  canvas.width = Math.max(128, width);
  canvas.height = 54;
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 14, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.position.copy(position);
  sprite.scale.set(canvas.width / 115, canvas.height / 115, 1);
  sprite.renderOrder = 20;
  parent.add(sprite);
  return sprite;
}

function rpyMatrix(x, y, z, roll, pitch, yaw) {
  const matrix = new THREE.Matrix4().makeTranslation(x, y, z);
  const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(roll, pitch, yaw, 'XYZ'));
  return matrix.multiply(rotation);
}

function v(values) { return new THREE.Vector3(...values); }

function disposeObject(object) {
  object.geometry?.dispose?.();
  const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
  materials.forEach((material) => {
    material.map?.dispose?.();
    material.dispose?.();
  });
}
