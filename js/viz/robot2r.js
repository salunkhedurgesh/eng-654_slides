export function initRobot2R() {
  document.querySelectorAll('[data-robot2r]').forEach(container => {
    createRobot2R(container);
  });
}

function createRobot2R(container) {
  const q1Initial = Number(container.dataset.q1 ?? 45);
  const q2Initial = Number(container.dataset.q2 ?? 60);
  const showTrace = container.dataset.trace !== 'false';

  container.classList.add('robot2r-interactive');
  container.innerHTML = `
    <svg class="robot-svg" viewBox="-300 -250 600 500" aria-label="2R planar robot animation">
      <defs>
        <marker id="arrow-red-${uniqueId(container)}" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
          <path d="M0,0 L0,6 L9,3 z" fill="#ff0000"></path>
        </marker>
        <marker id="arrow-green-${uniqueId(container)}" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
          <path d="M0,0 L0,6 L9,3 z" fill="#82B366"></path>
        </marker>
      </defs>

      <line x1="-240" y1="0" x2="240" y2="0" class="world-axis"></line>
      <line x1="0" y1="-205" x2="0" y2="205" class="world-axis"></line>

      <line x1="0" y1="0" x2="80" y2="0" class="axis-x" marker-end="url(#arrow-red-${uniqueId(container)})"></line>
      <line x1="0" y1="0" x2="0" y2="-80" class="axis-y" marker-end="url(#arrow-green-${uniqueId(container)})"></line>
      <text x="88" y="7" class="frame-label">x₀</text>
      <text x="8" y="-88" class="frame-label">y₀</text>

      <polyline class="ee-path"></polyline>
      <line class="robot-link link1"></line>
      <line class="robot-link link2"></line>
      <circle class="robot-joint joint1" r="15"></circle>
      <circle class="robot-joint joint2" r="15"></circle>
      <circle class="robot-ee ee" r="11"></circle>
      <text class="joint-value q1-value"></text>
      <text class="joint-value q2-value"></text>
    </svg>

    <div class="robot-controls">
      <div class="slider-row">
        <label>q₁</label>
        <input class="q1-slider" type="range" min="-180" max="180" value="${q1Initial}" step="1">
        <span class="q1-display">${q1Initial}°</span>
      </div>
      <div class="slider-row">
        <label>q₂</label>
        <input class="q2-slider" type="range" min="-180" max="180" value="${q2Initial}" step="1">
        <span class="q2-display">${q2Initial}°</span>
      </div>
      <div class="control-buttons">
        <button type="button" class="control-button reset-robot">Reset</button>
        <button type="button" class="control-button clear-path">Clear path</button>
      </div>
    </div>
  `;

  const svg = container.querySelector('svg');
  const link1 = svg.querySelector('.link1');
  const link2 = svg.querySelector('.link2');
  const joint1 = svg.querySelector('.joint1');
  const joint2 = svg.querySelector('.joint2');
  const ee = svg.querySelector('.ee');
  const eePath = svg.querySelector('.ee-path');
  const q1Value = svg.querySelector('.q1-value');
  const q2Value = svg.querySelector('.q2-value');

  const q1Slider = container.querySelector('.q1-slider');
  const q2Slider = container.querySelector('.q2-slider');
  const q1Display = container.querySelector('.q1-display');
  const q2Display = container.querySelector('.q2-display');
  const clearPathButton = container.querySelector('.clear-path');
  const resetButton = container.querySelector('.reset-robot');

  const L1 = Number(container.dataset.l1 ?? 160);
  const L2 = Number(container.dataset.l2 ?? 130);
  const pathPoints = [];

  function svgY(y) { return -y; } // 2D teaching plane is y-up; SVG y is down.
  function degToRad(degrees) { return degrees * Math.PI / 180; }

  function forwardKinematics(q1, q2) {
    const x0 = 0;
    const y0 = 0;
    const x1 = L1 * Math.cos(q1);
    const y1 = L1 * Math.sin(q1);
    const x2 = x1 + L2 * Math.cos(q1 + q2);
    const y2 = y1 + L2 * Math.sin(q1 + q2);
    return { x0, y0, x1, y1, x2, y2 };
  }

  function drawRobot(q1, q2) {
    const p = forwardKinematics(q1, q2);

    link1.setAttribute('x1', p.x0);
    link1.setAttribute('y1', svgY(p.y0));
    link1.setAttribute('x2', p.x1);
    link1.setAttribute('y2', svgY(p.y1));

    link2.setAttribute('x1', p.x1);
    link2.setAttribute('y1', svgY(p.y1));
    link2.setAttribute('x2', p.x2);
    link2.setAttribute('y2', svgY(p.y2));

    joint1.setAttribute('cx', p.x0);
    joint1.setAttribute('cy', svgY(p.y0));
    joint2.setAttribute('cx', p.x1);
    joint2.setAttribute('cy', svgY(p.y1));
    ee.setAttribute('cx', p.x2);
    ee.setAttribute('cy', svgY(p.y2));

    q1Value.setAttribute('x', p.x0 + 25);
    q1Value.setAttribute('y', svgY(p.y0) + 35);
    q1Value.textContent = `q₁ = ${(q1 * 180 / Math.PI).toFixed(0)}°`;

    q2Value.setAttribute('x', p.x1 + 20);
    q2Value.setAttribute('y', svgY(p.y1) - 20);
    q2Value.textContent = `q₂ = ${(q2 * 180 / Math.PI).toFixed(0)}°`;

    if (showTrace) {
      pathPoints.push(`${p.x2},${svgY(p.y2)}`);
      if (pathPoints.length > 250) pathPoints.shift();
      eePath.setAttribute('points', pathPoints.join(' '));
    }
  }

  function updateRobotFromSliders() {
    const q1Deg = Number(q1Slider.value);
    const q2Deg = Number(q2Slider.value);
    drawRobot(degToRad(q1Deg), degToRad(q2Deg));
    q1Display.textContent = `${q1Deg}°`;
    q2Display.textContent = `${q2Deg}°`;
  }

  q1Slider.addEventListener('input', updateRobotFromSliders);
  q2Slider.addEventListener('input', updateRobotFromSliders);

  clearPathButton.addEventListener('click', () => {
    pathPoints.length = 0;
    eePath.setAttribute('points', '');
  });

  resetButton.addEventListener('click', () => {
    q1Slider.value = q1Initial;
    q2Slider.value = q2Initial;
    updateRobotFromSliders();
  });

  updateRobotFromSliders();
}

function uniqueId(el) {
  if (!el.dataset.uid) el.dataset.uid = Math.random().toString(36).slice(2, 8);
  return el.dataset.uid;
}
