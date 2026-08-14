import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createZUpWorld, resizeRendererToContainer } from './threeUtils.js';
import { parseStlGeometry } from './frameDHPlayground.js?v=20260814-3';

const DEG = Math.PI / 180;
const MODEL_ROOT = new URL('../../assets/models/custom_3R/', import.meta.url);
const ASSET_REVISION = new URL(import.meta.url).searchParams.get('v') || 'dev';
const modelAssetUrl = (filename) => {
  const url = new URL(filename, MODEL_ROOT);
  url.searchParams.set('v', ASSET_REVISION);
  return url;
};
const URDF_URL = modelAssetUrl('custom_3R_new.urdf');
const TARGET_Q_DEG = [-35, -10, -170];
const IK_SOLUTION_DEG = [
  [-35, -10, -170],
  [-14.6556883192, -6.6055592987, -147.6075456696],
  [178.4024280182, -147.5329051962, -61.1502417161],
  [-69.0983199015, -61.9762166618, 166.6779007736]
];
const IKS_VISIBILITY = [true, false, false, false];

let robotModelPromise;
let robotModel;
let ikExample;

let geometryPromise;
const variantGeometryPromises = new Map();

async function loadRobotModel() {
  if (!robotModelPromise) robotModelPromise = loadRobotModelFromUrdf();
  return robotModelPromise;
}

async function loadRobotModelFromUrdf() {
  const response = await fetch(URDF_URL);
  if (!response.ok) throw new Error('Could not load custom_3R_new.urdf.');
  const documentNode = new DOMParser().parseFromString(await response.text(), 'application/xml');
  if (documentNode.querySelector('parsererror')) throw new Error('custom_3R_new.urdf is not valid XML.');

  const directChild = (element, tagName) => [...element.children]
    .find((child) => child.tagName.toLowerCase() === tagName);
  const vectorAttribute = (element, attribute, fallback = [0, 0, 0]) =>
    (element?.getAttribute(attribute)?.trim().split(/\s+/).map(Number) || fallback);
  const originMatrix = (element) => {
    const origin = directChild(element, 'origin');
    const [x, y, z] = vectorAttribute(origin, 'xyz');
    const [roll, pitch, yaw] = vectorAttribute(origin, 'rpy');
    return rpyMatrix(x, y, z, roll, pitch, yaw);
  };
  const joint = (name) => {
    const element = [...documentNode.querySelectorAll('joint')].find((item) => item.getAttribute('name') === name);
    if (!element) throw new Error(`Missing ${name} in custom_3R_new.urdf.`);
    return {
      element,
      origin: originMatrix(element),
      axis: new THREE.Vector3(...vectorAttribute(directChild(element, 'axis'), 'xyz', [0, 0, 1])).normalize(),
      child: directChild(element, 'child')?.getAttribute('link')
    };
  };
  const visual = (linkName) => {
    const link = [...documentNode.querySelectorAll('link')].find((item) => item.getAttribute('name') === linkName);
    const visualElement = link && directChild(link, 'visual');
    const mesh = visualElement?.querySelector('geometry > mesh');
    if (!link || !visualElement || !mesh) throw new Error(`Missing visual mesh for ${linkName}.`);
    const filename = mesh.getAttribute('filename').split('/').at(-1);
    return { origin: originMatrix(visualElement), file: filename };
  };

  const joints = [joint('joint_1'), joint('joint_2'), joint('joint_3')];
  const toolJoint = joint('tool0_fixed_joint');
  const homeLinks = [new THREE.Matrix4()];
  joints.forEach((item, index) => {
    homeLinks.push((index ? homeLinks[index] : new THREE.Matrix4()).clone().multiply(item.origin));
  });
  const axisPoints = joints.map((item, index) => new THREE.Vector3().setFromMatrixPosition(homeLinks[index + 1]));
  const axes = joints.map((item, index) => item.axis.clone().transformDirection(homeLinks[index + 1]));
  const toolHomeMatrix = homeLinks[3].clone().multiply(toolJoint.origin);
  const homeTool = new THREE.Vector3().setFromMatrixPosition(toolHomeMatrix);
  const linkNames = ['base_link', joints[0].child, joints[1].child, joints[2].child];
  const visuals = linkNames.map(visual);
  const colors = [0x333638, 0x0d7d80, 0xb8b8b8, 0x0d7d80];
  const meshSpecs = visuals.map((item, index) => ({ file: item.file, prefix: index, color: colors[index] }));

  const joint2Origin = new THREE.Vector3().setFromMatrixPosition(joints[1].origin);
  const joint3Origin = new THREE.Vector3().setFromMatrixPosition(joints[2].origin);
  const toolOrigin = new THREE.Vector3().setFromMatrixPosition(toolJoint.origin);
  const model = {
    axes,
    axisPoints,
    homeTool,
    homeLinks,
    visualOrigins: visuals.map((item) => item.origin),
    meshSpecs,
    dh: {
      a1: joint2Origin.x,
      alpha1: -90 * DEG,
      d1: axisPoints[1].z,
      a2: joint3Origin.x,
      alpha2: 90 * DEG,
      d2: joint3Origin.y,
      a3: toolOrigin.x,
      alpha3: 0,
      d3: toolOrigin.z
    }
  };

  const targetQ = TARGET_Q_DEG.map((angle) => angle * DEG);
  const solutions = IK_SOLUTION_DEG.map((q) => q.map((angle) => angle * DEG));
  const eePosition = forwardPosition(model, targetQ);
  const derived = deriveExampleValues(model, targetQ, eePosition);
  solutions.forEach((q, index) => {
    const residual = forwardPosition(model, q).distanceTo(eePosition);
    if (residual > 1e-8) throw new Error(`IK branch ${index + 1} is inconsistent with custom_3R_new.urdf.`);
  });
  robotModel = model;
  ikExample = { targetQ, solutions, eePosition, ...derived };
  bindLectureExample(ikExample, model);
  return model;
}

function forwardPosition(model, q) {
  return model.homeTool.clone().applyMatrix4(prefixMatrixFor(model, q, 3));
}

function prefixMatrixFor(model, q, count) {
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < count; i += 1) matrix.multiply(expRevolute(model.axes[i], model.axisPoints[i], q[i]));
  return matrix;
}

function deriveExampleValues(model, q, eePosition) {
  const { a1, a2, a3, d1, d2, d3 } = model.dh;
  const [, theta2, theta3] = q;
  const ux = a2 + a3 * Math.cos(theta3);
  const uy = -d3;
  const uz = d2 + a3 * Math.sin(theta3);
  const U = Math.cos(theta2) * ux - Math.sin(theta2) * uy;
  const V = Math.sin(theta2) * ux + Math.cos(theta2) * uy;
  const zBar = eePosition.z - d1;
  const zElim = zBar / Math.sin(model.dh.alpha1);
  const R = eePosition.x ** 2 + eePosition.y ** 2;
  const normR = R + zBar ** 2;
  const uNormSquared = ux ** 2 + uy ** 2 + uz ** 2;
  const D = R + zBar ** 2 - a1 ** 2 - uNormSquared;
  const vx = a1 + U;
  return {
    ux, uy, uz, U, V, zBar, zElim, R, normR, uNormSquared, D, vx,
    planarNormSquared: ux ** 2 + uy ** 2,
    angleUV: Math.atan2(V, U) / DEG,
    angleU: Math.atan2(uy, ux) / DEG,
    targetAzimuth: Math.atan2(eePosition.y, eePosition.x) / DEG,
    preAzimuth: Math.atan2(uz, vx) / DEG
  };
}

function bindLectureExample(example, model) {
  window.custom3RExample = { model, ...example };
  document.querySelectorAll('[data-custom3r-ee]').forEach((element) => {
    const digits = Number(element.dataset.digits || 4);
    element.textContent = example.eePosition.toArray().map((value) => value.toFixed(digits)).join(', ');
  });
  const [x, y, z] = example.eePosition.toArray().map((value) => fixed(value, 4));
  const [q1, q2, q3] = TARGET_Q_DEG;
  const bindings = {
    problem: `\\[\\mathbf q=(${q1}^\\circ,${q2}^\\circ,${q3}^\\circ)\\Rightarrow\\mathbf p_d=\\begin{bmatrix}${x}\\\\${y}\\\\${z}\\end{bmatrix}\\mathrm m\\]`,
    forward: `\\[\\mathbf p(${q1}^\\circ,${q2}^\\circ,${q3}^\\circ)=\\begin{bmatrix}${x}\\\\${y}\\\\${z}\\end{bmatrix}\\mathrm m\\]`,
    inline: `\\(\\mathbf p_d=(${x},${y},${z})\\,\\mathrm m\\)`
  };
  const boundElements = [...document.querySelectorAll('[data-custom3r-target]')];
  boundElements.forEach((element) => { element.innerHTML = bindings[element.dataset.custom3rTarget] || ''; });
  if (boundElements.length && window.MathJax?.typesetPromise) window.MathJax.typesetPromise(boundElements);
}

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
  if (mode !== 'dimensions') addLabelVisibilityControl(kit);
  Promise.resolve(buildMode(kit)).then((modeUpdate) => {
    if (!alive) return;
    if (typeof modeUpdate === 'function') update = modeUpdate;
    kit.syncLabels?.();
  }).catch((error) => {
    note.textContent = 'Three.js scene could not load: ' + error.message;
    note.classList.add('is-error');
    container.dataset.errorStack = error.stack || error.message;
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
    case 'uv-concept': return buildUvConcept(kit);
    case 'uv': return buildUvRotation(kit);
    case 'height': return buildHeightInvariant(kit);
    case 'radial': return buildRadialInvariant(kit);
    case 'roots': return buildRoots(kit);
    case 'conic': return buildConicInterpretation(kit);
    case 'conic-explorer': return buildConicExplorer(kit);
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
  const { dh, axisPoints, homeTool } = robotModel;
  addJointAxes(kit.world, [0, 0, 0], true);
  const joint2 = axisPoints[1], joint3 = axisPoints[2];
  const d2End = joint2.clone().add(new THREE.Vector3(0, dh.d2, 0));
  const d3End = joint3.clone().add(new THREE.Vector3(0, 0, dh.d3));
  const dims = [
    [v([0, 0, 0]), v([0, 0, dh.d1]), `d₁ = ${fixed(dh.d1, 2)} m`, 0xff0000],
    [v([0, 0, dh.d1]), joint2, `a₁ = ${fixed(dh.a1, 2)} m`, 0x111111],
    [joint2, d2End, `d₂ = ${fixed(dh.d2, 2)} m`, 0x3f6ea8],
    [d2End, joint3, `a₂ = ${fixed(dh.a2, 2)} m`, 0x111111],
    [d3End, homeTool, `a₃ = ${fixed(dh.a3, 2)} m`, 0xff0000]
  ];
  const annotations = dims.map(([a, b, text, color]) =>
    addDimension(kit.world, a, b, text, color));
  annotations.push(addDimension(kit.world, joint3, d3End, `d₃ = ${fixed(dh.d3, 2)} m`, 0x888888, .75));
  addDimensionLabelControls(kit, annotations);
  kit.note.textContent = 'Geometry loaded from custom_3R_new.urdf; each annotation is derived from its joint and tool origins.';
  return () => robot.update([0, 0, 0]);
}

async function buildDhMotion(kit) {
  kit.setCamera([7, 5.4, 6.2]);
  const robot = await createRobot(kit.world, [0, 0, 0]);
  const target = ikExample.targetQ.slice();
  const q = [0, 0, 0];
  addTarget(kit.world, ikExample.eePosition, 'p_d');
  kit.note.textContent = `The global target p_d = (${vectorText(ikExample.eePosition, 3)}) m is computed once from the URDF and q = (${TARGET_Q_DEG.join('°, ')}°).`;
  return (time, dt) => {
    const phase = .5 - .5 * Math.cos(Math.min(1, (time % 8) / 3) * Math.PI);
    q.forEach((_, i) => { q[i] += (target[i] * phase - q[i]) * Math.min(1, 5 * dt); });
    robot.update(q);
  };
}

async function buildTopView(kit) {
  await loadRobotModel();
  kit.setCamera([5.8, 7.2, 5.4], [1.1, .7, 0]);
  kit.controls.enableRotate = true;
  const robot = await createRobot(kit.world, ikExample.targetQ);
  addRobotVisibilityToggle(kit, robot.group, 'STL');
  const { eePosition, R } = ikExample;
  const d1 = robotModel.dh.d1;
  addTarget(kit.world, eePosition, 'p_d');
  const projection = new THREE.Vector3(eePosition.x, eePosition.y, d1);
  addRing(kit.world, new THREE.Vector3(0, 0, d1), Math.sqrt(R), 0x3f6ea8, 1.3);
  kit.world.add(tube(projection, eePosition, .018, 0x777777, .65));
  const projectedMarker = sphere(.09, 0x3f6ea8);
  projectedMarker.position.copy(projection);
  kit.world.add(projectedMarker);
  addLabel(kit.world, projection.clone().add(new THREE.Vector3(.08, .08, .16)), 'π_xy(p_d)');
  kit.note.textContent = `The blue circle has radius ρ = ${fixed(Math.sqrt(R), 4)} m; combining ρ² with z̄² gives the θ₁-invariant R used in the paper.`;
  return () => robot.update(ikExample.targetQ);
}

async function buildUVector(kit) {
  await loadRobotModel();
  kit.setCamera([7.3, 5.2, 5.8]);
  const homeQ = [0, 0, 0];
  const theta3OnlyQ = [0, 0, ikExample.targetQ[2]];
  const homeRobot = await createRobot(kit.world, homeQ, {
    opacity: .25,
    colors: [0x777777, 0x777777, 0x999999, 0x777777]
  });
  const finalRobot = await createRobot(kit.world, ikExample.targetQ, {
    opacity: .25,
    colors: [0x333638, 0x3f6ea8, 0xaec7e8, 0x3f6ea8]
  });
  const theta3Robot = await createRobot(kit.world, theta3OnlyQ, { opacity: .8 });
  addRobotVisibilityToggle(kit, homeRobot.group, 'Home');
  addRobotVisibilityToggle(kit, finalRobot.group, 'Final');
  addRobotVisibilityToggle(kit, theta3Robot.group, 'θ₃');
  const origin = robotModel.axisPoints[1].clone();
  const { a2, a3, d2, d3 } = robotModel.dh;
  const theta = ikExample.targetQ[2];
  const thetaDegrees = TARGET_Q_DEG[2];
  // Frame 1 has x₁ = x_W, y₁ = -z_W, z₁ = y_W at q₁ = 0.
  const u = new THREE.Vector3(a2 + a3 * Math.cos(theta), d2 + a3 * Math.sin(theta), d3);
  addVector(kit.world, origin, u, 0xff0000, `u(${thetaDegrees}°)`);
  addVector(kit.world, origin, new THREE.Vector3(a2 + a3, d2, d3), 0x777777, 'u(0°)');
  addTarget(kit.world, ikExample.eePosition, 'p_d', new THREE.Vector3(-.28, .08, .58));
  addVector(kit.world, origin, new THREE.Vector3(.65, 0, 0), 0xe74c3c, 'x₁');
  addVector(kit.world, origin, new THREE.Vector3(0, 0, -.65), 0x35a853, 'y₁');
  addVector(kit.world, origin, new THREE.Vector3(0, .65, 0), 0x2775ff, 'z₁');
  kit.note.textContent = `The θ₃-only state (${thetaDegrees}°) is shown at 0.8 opacity; home and the final IK state are references at 0.25.`;
  return () => {
    homeRobot.update(homeQ);
    finalRobot.update(ikExample.targetQ);
    theta3Robot.update(theta3OnlyQ);
  };
}

async function buildUvRotation(kit) {
  await loadRobotModel();
  kit.setCamera([6.8, 5.8, 6.5]);
  const robot = await createRobot(kit.world, ikExample.targetQ);
  const center = robotModel.axisPoints[1].clone();
  addRingInPlane(kit.world, center, Math.sqrt(ikExample.planarNormSquared), new THREE.Vector3(0, 1, 0), 0x3f6ea8);
  addVector(kit.world, center, new THREE.Vector3(ikExample.ux, 0, -ikExample.uy), 0x777777, '[F₁,−F₂]');
  addVector(kit.world, center, new THREE.Vector3(ikExample.U, 0, -ikExample.V), 0xff0000, '[E,zₑ]');
  kit.note.textContent = `θ₂ = ${fixed(TARGET_Q_DEG[1], 0)}° rotates [F₁,−F₂] into [E,zₑ]; both lengths remain ${fixed(Math.sqrt(ikExample.planarNormSquared), 4)} m.`;
  return () => robot.update(ikExample.targetQ);
}

async function buildUvConcept(kit) {
  await loadRobotModel();
  kit.setCamera([6.8, 5.8, 6.5]);
  const stlGroup = new THREE.Group();
  kit.world.add(stlGroup);
  const homeRobot = await createRobot(kit.world, [0, 0, 0], {
    opacity: .25,
    colors: [0x777777, 0x777777, 0x999999, 0x777777]
  });
  const rotatedQ = [0, ikExample.targetQ[1], ikExample.targetQ[2]];
  const rotatedRobot = await createRobot(kit.world, rotatedQ, { opacity: .72 });
  stlGroup.add(homeRobot.group, rotatedRobot.group);
  addRobotVisibilityToggle(kit, stlGroup, 'STL');
  addRobotVisibilityToggle(kit, homeRobot.group, 'Home');

  const center = robotModel.axisPoints[1].clone();
  const jointAxis = robotModel.axes[1].clone();
  kit.world.add(makeAxis(center, jointAxis, 4.2, 0x111111));
  addLabel(kit.world, center.clone().addScaledVector(jointAxis, 1.55), 'joint 2 axis');
  addRingInPlane(kit.world, center, Math.sqrt(ikExample.planarNormSquared), jointAxis, 0x3f6ea8);
  addVector(kit.world, center, new THREE.Vector3(ikExample.ux, 0, -ikExample.uy), 0x777777, '[F₁,−F₂]');
  addVector(kit.world, center, new THREE.Vector3(ikExample.U, 0, -ikExample.V), 0xff0000, '[E,zₑ]');
  kit.note.textContent = `Viewed in the home joint-2 frame, θ₂ = ${TARGET_Q_DEG[1]}° is the oriented rotation from [F₁,−F₂] to [E,zₑ].`;
  return () => {
    homeRobot.update([0, 0, 0]);
    rotatedRobot.update(rotatedQ);
  };
}

async function buildHeightInvariant(kit) {
  await loadRobotModel();
  kit.setCamera([7.1, 4.7, 6.2]);
  const robot = await createRobot(kit.world, ikExample.targetQ);
  const d1 = robotModel.dh.d1;
  addTarget(kit.world, ikExample.eePosition, `z_tool = ${fixed(ikExample.eePosition.z, 4)}`);
  addDimension(kit.world, v([0, 0, d1]), v([0, 0, ikExample.eePosition.z]), `z̄ = ${fixed(ikExample.zBar, 4)} m`, 0xff0000);
  const plane = new THREE.GridHelper(8, 16, 0xaaaaaa, 0xdddddd);
  plane.rotation.x = Math.PI / 2;
  plane.position.z = d1;
  kit.world.add(plane);
  kit.note.textContent = 'subtracting d₁ moves the reference plane from world z = 0 to D–H z = 0';
  return () => robot.update(ikExample.targetQ);
}

async function buildRadialInvariant(kit) {
  await loadRobotModel();
  kit.setCamera([4.2, 10.8, 6.4], [.8, .45, 1.15]);
  const robot = await createRobot(kit.world, ikExample.targetQ);
  const center = new THREE.Vector3(0, 0, ikExample.eePosition.z);
  const joint1Point = robotModel.axisPoints[0];
  addTarget(kit.world, ikExample.eePosition, 'p_d');
  addRing(kit.world, center, Math.sqrt(ikExample.R), 0xff0000, 1.5);
  addVector(kit.world, center, new THREE.Vector3(ikExample.eePosition.x, ikExample.eePosition.y, 0), 0x3f6ea8, 'ρ');
  kit.world.add(tube(joint1Point.clone().add(new THREE.Vector3(0, 0, -1)), center.clone().add(new THREE.Vector3(0, 0, 1)), .025, 0x111111, .8));
  addLabel(kit.world, joint1Point.clone().add(new THREE.Vector3(.08, .08, .15)), 'joint 1');
  addLabel(kit.world, center.clone().add(new THREE.Vector3(.08, .08, .15)), '(0,0,z_e)');
  kit.note.textContent = 'The black joint-1 axis is x = y = 0. The circle radius is ρ; the algebraic invariant is R = ρ² + z̄².';
  return () => robot.update(ikExample.targetQ);
}

async function buildRoots(kit) {
  kit.setCamera([7.2, 5.4, 6.6]);
  const palettes = [
    [0x333638, 0x0d7d80, 0xb8b8b8, 0x0d7d80],
    [0x333638, 0x3f6ea8, 0xaec7e8, 0x3f6ea8],
    [0x333638, 0xd79b00, 0xf0d48b, 0xd79b00],
    [0x333638, 0xff5555, 0xffbbbb, 0xff5555]
  ];
  await loadRobotModel();
  const robots = await Promise.all(ikExample.solutions.map((q, i) =>
    createRobot(kit.world, q, { opacity: .58, colors: palettes[i] })));
  robots.forEach((robot, i) => {
    const elbow = robotModel.axisPoints[2].clone().applyMatrix4(prefixMatrixFor(robotModel, ikExample.solutions[i], 2));
    addLabel(robot.group, elbow.add(new THREE.Vector3(.08, .08, .24)), `IKS ${i + 1}`, palettes[i][1]);
    addRobotVisibilityToggle(
      kit,
      robot.group,
      `IKS ${i + 1}`,
      IKS_VISIBILITY[i],
      (visible) => { IKS_VISIBILITY[i] = visible; }
    );
  });
  addTarget(kit.world, ikExample.eePosition, 'same p_d');
  kit.note.textContent = 'Each switch independently preserves an IK branch, so any subset of the four solutions can be compared at the common target.';
  return () => robots.forEach((robot, i) => robot.update(ikExample.solutions[i]));
}

async function buildBackprop(kit, joint) {
  await loadRobotModel();
  kit.setCamera(joint === 2 ? [6.8, 5.5, 6.3] : [2.1, 14, -.8], [2.1, 1.1, -.8]);
  const robot = await createRobot(kit.world, ikExample.targetQ);
  addTarget(kit.world, ikExample.eePosition, 'p_d');
  if (joint === 2) {
    const center = robotModel.axisPoints[1];
    addVector(kit.world, center, v([ikExample.ux, 0, -ikExample.uy]), 0x777777, `atan2(−F₂,F₁) = ${fixed(ikExample.angleU, 3)}°`);
    addVector(kit.world, center, v([ikExample.U, 0, -ikExample.V]), 0xff0000, `atan2(zₑ,E) = ${fixed(ikExample.angleUV, 3)}°`);
    kit.note.textContent = `θ₂ = atan2(zₑ,E) − atan2(−F₂,F₁) = ${fixed(TARGET_Q_DEG[1], 3)}°.`;
  } else {
    const center = v([0, 0, robotModel.dh.d1]);
    addVector(kit.world, center, v([ikExample.vx, ikExample.uz, 0]), 0x777777, `atan2(C,a₁+E) = ${fixed(ikExample.preAzimuth, 3)}°`);
    addVector(kit.world, center, v([ikExample.eePosition.x, ikExample.eePosition.y, 0]), 0xff0000, `target azimuth = ${fixed(ikExample.targetAzimuth, 3)}°`);
    kit.note.textContent = `θ₁ = ${fixed(ikExample.targetAzimuth, 3)}° − ${fixed(ikExample.preAzimuth, 3)}° = ${fixed(TARGET_Q_DEG[0], 3)}°.`;
  }
  return () => robot.update(ikExample.targetQ);
}

async function buildDegeneracy(kit) {
  kit.setCamera([6.8, 5.3, 6.2]);
  const filenames = [
    'custom_3R_new.urdf',
    'custom_3R_new_800.urdf',
    'custom_3R_new_600.urdf',
    'custom_3R_new_400.urdf',
    'custom_3R_new_0.urdf'
  ];
  const variants = await Promise.all(filenames.map((filename) => createUrdfVariantRobot(kit.world, filename)));
  variants.forEach((variant) => setVariantOpacity(variant.group, 0));
  let lastMessage = '';
  const stageDuration = 2.4;
  const fadeDuration = .55;
  return (time) => {
    const position = (time % (stageDuration * variants.length)) / stageDuration;
    const index = Math.floor(position);
    const withinStage = (position - index) * stageDuration;
    const nextIndex = (index + 1) % variants.length;
    const blend = Math.max(0, Math.min(1, (withinStage - (stageDuration - fadeDuration)) / fadeDuration));
    variants.forEach((variant, variantIndex) => {
      const opacity = variantIndex === index ? 1 - blend : variantIndex === nextIndex ? blend : 0;
      setVariantOpacity(variant.group, opacity);
    });
    const current = variants[index];
    const next = variants[nextIndex];
    const message = blend > .02
      ? `${current.filename} (a₁=${fixed(current.a1, 1)} m) → ${next.filename} (a₁=${fixed(next.a1, 1)} m)`
      : `${current.filename} · a₁ = ${fixed(current.a1, 1)} m`;
    if (message !== lastMessage) {
      kit.note.textContent = message;
      lastMessage = message;
    }
  };
}

async function createUrdfVariantRobot(world, filename) {
  const response = await fetch(modelAssetUrl(filename));
  if (!response.ok) throw new Error(`Could not load ${filename}.`);
  const documentNode = new DOMParser().parseFromString(await response.text(), 'application/xml');
  if (documentNode.querySelector('parsererror')) throw new Error(`${filename} is not valid XML.`);
  const child = (element, tagName) => [...element.children]
    .find((item) => item.tagName.toLowerCase() === tagName);
  const vector = (element, attribute, fallback = [0, 0, 0]) =>
    (element?.getAttribute(attribute)?.trim().split(/\s+/).map(Number) || fallback);
  const origin = (element) => {
    const originElement = child(element, 'origin');
    const [x, y, z] = vector(originElement, 'xyz');
    const [roll, pitch, yaw] = vector(originElement, 'rpy');
    return rpyMatrix(x, y, z, roll, pitch, yaw);
  };
  const joint = (name) => {
    const element = [...documentNode.querySelectorAll('joint')].find((item) => item.getAttribute('name') === name);
    if (!element) throw new Error(`Missing ${name} in ${filename}.`);
    return { element, origin: origin(element), child: child(element, 'child')?.getAttribute('link') };
  };
  const visual = (name) => {
    const link = [...documentNode.querySelectorAll('link')].find((item) => item.getAttribute('name') === name);
    const element = link && child(link, 'visual');
    const mesh = element?.querySelector('geometry > mesh');
    if (!mesh) throw new Error(`Missing visual for ${name} in ${filename}.`);
    return { origin: origin(element), file: mesh.getAttribute('filename').split('/').at(-1) };
  };

  const joints = [joint('joint_1'), joint('joint_2'), joint('joint_3')];
  const homeLinks = [new THREE.Matrix4()];
  joints.forEach((item, index) => {
    homeLinks.push((index ? homeLinks[index] : new THREE.Matrix4()).clone().multiply(item.origin));
  });
  const linkNames = ['base_link', ...joints.map((item) => item.child)];
  const visuals = linkNames.map(visual);
  const colors = [0x333638, 0x0d7d80, 0xb8b8b8, 0x0d7d80];
  const group = new THREE.Group();
  world.add(group);
  await Promise.all(visuals.map(async (item, index) => {
    const geometry = await loadVariantGeometry(item.file);
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(homeLinks[index]).multiply(item.origin);
    const material = new THREE.MeshStandardMaterial({
      color: colors[index], roughness: .62, metalness: .06,
      transparent: true, opacity: 1, depthWrite: false
    });
    holder.add(new THREE.Mesh(geometry.clone(), material));
    group.add(holder);
  }));

  const joint2Point = new THREE.Vector3().setFromMatrixPosition(homeLinks[2]);
  const axis1Point = new THREE.Vector3(0, 0, joint2Point.z);
  const a1 = joint2Point.x;
  group.add(makeAxis(axis1Point, new THREE.Vector3(0, 0, 1), 3.8, 0x111111));
  group.add(makeAxis(joint2Point, new THREE.Vector3(0, 1, 0), 4.2, 0xff0000));
  if (Math.abs(a1) > 1e-4) addDimension(group, axis1Point, joint2Point, `a₁ = ${fixed(a1, 1)} m`, 0x3f6ea8);
  else addLabel(group, joint2Point.clone().add(new THREE.Vector3(.16, .12, .18)), 'a₁ = 0 · shared point', 0x3f6ea8);
  return { group, filename, a1 };
}

function loadVariantGeometry(filename) {
  if (!variantGeometryPromises.has(filename)) {
    variantGeometryPromises.set(filename, fetch(modelAssetUrl(filename)).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load ${filename}.`);
      return parseStlGeometry(await response.arrayBuffer());
    }));
  }
  return variantGeometryPromises.get(filename);
}

function setVariantOpacity(group, opacity) {
  group.visible = opacity > .005;
  group.traverse((object) => {
    if (!object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      material.transparent = true;
      material.opacity = opacity;
      material.depthWrite = false;
    });
  });
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
  addTarget(kit.world, ikExample.eePosition, 'p_d');
  const q = [0, 0, 0];
  kit.note.textContent = `One branch is reconstructed in elimination order: θ₃ = ${TARGET_Q_DEG[2]}° → θ₂ = ${TARGET_Q_DEG[1]}° → θ₁ = ${TARGET_Q_DEG[0]}°.`;
  return (time, dt) => {
    const phase = time % 9;
    const desired = [0, 0, 0];
    if (phase > 1) desired[2] = ikExample.targetQ[2] * Math.min(1, phase - 1);
    if (phase > 3.3) desired[1] = ikExample.targetQ[1] * Math.min(1, phase - 3.3);
    if (phase > 5.6) desired[0] = ikExample.targetQ[0] * Math.min(1, phase - 5.6);
    q.forEach((_, i) => { q[i] += (desired[i] - q[i]) * Math.min(1, 7 * dt); });
    robot.update(q);
  };
}

async function buildConicInterpretation(kit) {
  await loadRobotModel();
  kit.setCamera([0, 6.8, 0], [0, 0, 0]);
  kit.controls.enableRotate = false;
  const z = .02;
  addRing(kit.world, new THREE.Vector3(0, 0, z), 1, 0xff0000, 2);
  kit.world.add(tube(v([-1.55, 0, z]), v([1.55, 0, z]), .012, 0x777777));
  kit.world.add(tube(v([0, -1.35, z]), v([0, 1.35, z]), .012, 0x777777));

  const conic = custom3rConic(ikExample.normR, ikExample.zBar);
  addImplicitContour(kit.world, conic, [-1.45, 1.45, -1.25, 1.25], 86, 0x3f6ea8, z + .015);
  ikExample.solutions.forEach((q) => {
    const theta = q[2];
    const marker = sphere(.045, 0x111111);
    marker.position.set(Math.cos(theta), Math.sin(theta), z + .05);
    kit.world.add(marker);
  });
  addLabel(kit.world, v([1.25, .08, z]), 'c₃');
  addLabel(kit.world, v([.08, 1.18, z]), 's₃');
  kit.note.textContent = 'Blue: F(c₃,s₃)=0. Red: c₃²+s₃²=1. Their four intersections are the four real values of θ₃.';
  return () => {};
}

async function buildConicExplorer(kit) {
  await loadRobotModel();
  kit.setCamera([0, 6.8, 0], [0, 0, 0]);
  kit.controls.enableRotate = false;
  const z = .02;
  addRing(kit.world, new THREE.Vector3(0, 0, z), 1, 0xff0000, 2);
  kit.world.add(tube(v([-1.55, 0, z]), v([1.55, 0, z]), .012, 0x777777));
  kit.world.add(tube(v([0, -1.35, z]), v([0, 1.35, z]), .012, 0x777777));
  addLabel(kit.world, v([1.25, .08, z]), 'c₃');
  addLabel(kit.world, v([.08, 1.18, z]), 's₃');

  const state = { R: ikExample.normR, z: ikExample.zBar };
  const markers = new THREE.Group();
  kit.world.add(markers);
  let contour;
  const redraw = () => {
    if (contour) {
      kit.world.remove(contour);
      contour.geometry.dispose();
      contour.material.dispose();
    }
    while (markers.children.length) {
      const child = markers.children[0];
      markers.remove(child);
      disposeObject(child);
    }
    const conic = custom3rConic(state.R, state.z);
    contour = addImplicitContour(kit.world, conic, [-1.45, 1.45, -1.25, 1.25], 86, 0x3f6ea8, z + .015);
    const roots = circleIntersections(conic);
    roots.forEach((theta) => {
      const marker = sphere(.05, 0x111111);
      marker.position.set(Math.cos(theta), Math.sin(theta), z + .05);
      markers.add(marker);
    });
    kit.note.textContent = `R = ρ²+z² = ${fixed(state.R, 2)} m², z = ${fixed(state.z, 2)} m: ${roots.length} circle–conic intersection${roots.length === 1 ? '' : 's'}.`;
  };
  addConicSlider(kit, 'R', .2, 10, .05, state.R, (value) => { state.R = value; redraw(); });
  addConicSlider(kit, 'z', -3, 3, .05, state.z, (value) => { state.z = value; redraw(); });
  redraw();
  return () => {};
}

function custom3rConic(R, z) {
  const { a1, a2, a3, d2, d3, alpha1 } = robotModel.dh;
  const normConstant = a2 ** 2 + a3 ** 2 + d2 ** 2 + d3 ** 2;
  const zElim = z / Math.sin(alpha1);
  return (c, s) => {
    const F1 = a2 + a3 * c;
    const F2 = d3;
    // The circle identity reduces F3 to an affine function of (c3,s3).
    const F3 = a1 ** 2 + normConstant + 2 * a2 * a3 * c + 2 * d2 * a3 * s;
    const E = (R - F3) / (2 * a1);
    return E ** 2 + zElim ** 2 - F1 ** 2 - F2 ** 2;
  };
}

function circleIntersections(fn) {
  const samples = 1440;
  const roots = [];
  let theta0 = -Math.PI;
  let value0 = fn(Math.cos(theta0), Math.sin(theta0));
  for (let i = 1; i <= samples; i += 1) {
    const theta1 = -Math.PI + (2 * Math.PI * i) / samples;
    const value1 = fn(Math.cos(theta1), Math.sin(theta1));
    if (value0 === 0 || value0 * value1 < 0) {
      let lo = theta0, hi = theta1, fLo = value0;
      for (let iteration = 0; iteration < 42; iteration += 1) {
        const mid = (lo + hi) / 2;
        const fMid = fn(Math.cos(mid), Math.sin(mid));
        if (fLo * fMid <= 0) hi = mid;
        else { lo = mid; fLo = fMid; }
      }
      const root = (lo + hi) / 2;
      if (!roots.some((item) => Math.abs(Math.atan2(Math.sin(root - item), Math.cos(root - item))) < 1e-4)) roots.push(root);
    }
    theta0 = theta1;
    value0 = value1;
  }
  return roots;
}

async function createRobot(world, q = [0, 0, 0], options = {}) {
  const model = await loadRobotModel();
  const geometries = await loadGeometries();
  const group = new THREE.Group();
  world.add(group);
  const visuals = [];
  model.meshSpecs.forEach((spec, i) => {
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
    visuals.push({ holder, prefix: spec.prefix, home: model.homeLinks[i].clone().multiply(model.visualOrigins[i]) });
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
    geometryPromise = loadRobotModel().then((model) => Promise.all(model.meshSpecs.map(async (spec) => {
      const response = await fetch(modelAssetUrl(spec.file));
      if (!response.ok) throw new Error('Could not load ' + spec.file);
      return parseStlGeometry(await response.arrayBuffer());
    })));
  }
  return geometryPromise;
}

function prefixMatrix(q, count) {
  return prefixMatrixFor(robotModel, q, count);
}

function expRevolute(axis, point, angle) {
  const matrix = new THREE.Matrix4().makeRotationAxis(axis, angle);
  const rotated = point.clone().applyMatrix4(matrix);
  matrix.setPosition(point.clone().sub(rotated));
  return matrix;
}

function addJointAxes(world, q, labels = false) {
  const axes = [
    { p: robotModel.axisPoints[0], w: robotModel.axes[0], prefix: 0, text: 'z₀ · joint 1' },
    { p: robotModel.axisPoints[1], w: robotModel.axes[1], prefix: 1, text: 'z₁ · joint 2' },
    { p: robotModel.axisPoints[2], w: robotModel.axes[2], prefix: 2, text: 'z₂ · joint 3' }
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

function addTarget(world, point, text, labelOffset = new THREE.Vector3(.1, .1, .32)) {
  const marker = sphere(.14, 0xff0000);
  marker.position.copy(point);
  world.add(marker);
  addLabel(world, point.clone().add(labelOffset), text);
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
  group.userData.dimensionLabel = addLabel(
    group,
    start.clone().lerp(end, .5).add(cap.clone().multiplyScalar(1.3)),
    text,
    color
  );
  group.userData.dimensionKey = text.slice(0, 2);
  world.add(group);
  return group;
}

function addDimensionLabelControls(kit, dimensions) {
  const choices = [
    ['all', 'All'],
    ['none', 'None'],
    ...dimensions.map((group) => [group.userData.dimensionKey, group.userData.dimensionKey])
  ];
  const label = document.createElement('span');
  label.className = 'ik3r-control-label';
  label.textContent = 'Labels';
  const select = document.createElement('select');
  select.className = 'ik3r-label-select';
  select.setAttribute('aria-label', 'Visible dimension labels');
  choices.forEach(([value, text]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  });
  const update = () => {
    setAllLabelsVisible(kit.world, select.value === 'all');
    if (select.value !== 'all' && select.value !== 'none') {
      const selected = dimensions.find((group) => group.userData.dimensionKey === select.value);
      if (selected?.userData.dimensionLabel) selected.userData.dimensionLabel.visible = true;
    }
  };
  select.addEventListener('change', update);
  kit.cleaners.push(() => select.removeEventListener('change', update));
  kit.controlHost.append(label, select);
  kit.syncLabels = update;
}

function addLabelVisibilityControl(kit) {
  const label = document.createElement('label');
  label.className = 'ik3r-label-toggle';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = true;
  checkbox.setAttribute('aria-label', 'Show scene labels');
  const text = document.createElement('span');
  text.textContent = 'Labels';
  label.append(checkbox, text);
  const update = () => setAllLabelsVisible(kit.world, checkbox.checked);
  checkbox.addEventListener('change', update);
  kit.cleaners.push(() => checkbox.removeEventListener('change', update));
  kit.controlHost.append(label);
  kit.syncLabels = update;
}

function addRobotVisibilityToggle(kit, robotGroup, text, checked = true, onChange = () => {}) {
  const label = document.createElement('label');
  label.className = 'ik3r-state-toggle';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = checked;
  checkbox.setAttribute('aria-label', `Show ${text} robot state`);
  const track = document.createElement('span');
  track.className = 'ik3r-switch-track';
  track.setAttribute('aria-hidden', 'true');
  const caption = document.createElement('span');
  caption.textContent = text;
  const update = () => {
    robotGroup.visible = checkbox.checked;
    onChange(checkbox.checked);
  };
  checkbox.addEventListener('change', update);
  kit.cleaners.push(() => checkbox.removeEventListener('change', update));
  label.append(checkbox, track, caption);
  kit.controlHost.append(label);
  update();
}

function addConicSlider(kit, text, min, max, step, initial, onInput) {
  const label = document.createElement('label');
  label.className = 'ik3r-slider-control';
  const caption = document.createElement('span');
  const valueLabel = document.createElement('output');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = initial;
  const update = () => {
    const value = Number(input.value);
    valueLabel.value = fixed(value, 2);
    onInput(value);
  };
  caption.textContent = text;
  valueLabel.value = fixed(initial, 2);
  input.setAttribute('aria-label', text);
  input.addEventListener('input', update);
  kit.cleaners.push(() => input.removeEventListener('input', update));
  label.append(caption, input, valueLabel);
  kit.controlHost.append(label);
}

function setAllLabelsVisible(world, visible) {
  world.traverse((object) => {
    if (object.userData.isIkLabel) object.visible = visible;
  });
}

function addImplicitContour(world, fn, bounds, resolution, color, z = 0) {
  const [xMin, xMax, yMin, yMax] = bounds;
  const dx = (xMax - xMin) / resolution;
  const dy = (yMax - yMin) / resolution;
  const points = [];
  const interpolate = (a, b, fa, fb) => a.clone().lerp(b, Math.abs(fa - fb) < 1e-12 ? .5 : fa / (fa - fb));
  for (let ix = 0; ix < resolution; ix += 1) {
    for (let iy = 0; iy < resolution; iy += 1) {
      const corners = [
        v([xMin + ix * dx, yMin + iy * dy, z]),
        v([xMin + (ix + 1) * dx, yMin + iy * dy, z]),
        v([xMin + (ix + 1) * dx, yMin + (iy + 1) * dy, z]),
        v([xMin + ix * dx, yMin + (iy + 1) * dy, z])
      ];
      const values = corners.map((p) => fn(p.x, p.y));
      const crossings = [];
      [[0, 1], [1, 2], [2, 3], [3, 0]].forEach(([a, b]) => {
        if ((values[a] <= 0 && values[b] > 0) || (values[a] > 0 && values[b] <= 0)) {
          crossings.push(interpolate(corners[a], corners[b], values[a], values[b]));
        }
      });
      if (crossings.length === 2) points.push(crossings[0], crossings[1]);
      if (crossings.length === 4) points.push(crossings[0], crossings[1], crossings[2], crossings[3]);
    }
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
  world.add(lines);
  return lines;
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
  sprite.userData.isIkLabel = true;
  parent.add(sprite);
  return sprite;
}

function rpyMatrix(x, y, z, roll, pitch, yaw) {
  const matrix = new THREE.Matrix4().makeTranslation(x, y, z);
  const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(roll, pitch, yaw, 'XYZ'));
  return matrix.multiply(rotation);
}

function v(values) { return new THREE.Vector3(...values); }
function fixed(value, digits = 4) {
  const clean = Math.abs(value) < .5 * 10 ** -digits ? 0 : value;
  return Number(clean).toFixed(digits);
}
function vectorText(vector, digits = 4) { return vector.toArray().map((value) => fixed(value, digits)).join(', '); }

function disposeObject(object) {
  object.geometry?.dispose?.();
  const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
  materials.forEach((material) => {
    material.map?.dispose?.();
    material.dispose?.();
  });
}
