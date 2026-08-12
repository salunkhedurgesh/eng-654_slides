const link1 = document.getElementById("link1");
const link2 = document.getElementById("link2");

const joint1 = document.getElementById("joint1");
const joint2 = document.getElementById("joint2");

const ee = document.getElementById("ee");

const L1 = 160;
const L2 = 130;

const eePath =
  document.getElementById("ee-path");


const pathPoints = [];

const q1Value =
  document.getElementById("q1-value");

const q2Value =
  document.getElementById("q2-value");

const q1Slider =
  document.getElementById("q1-slider");

const q2Slider =
  document.getElementById("q2-slider");


const q1Display =
  document.getElementById("q1-display");

const q2Display =
  document.getElementById("q2-display");

const clearPathButton =
  document.getElementById("clear-path");

const resetButton =
  document.getElementById("reset-robot");

/* 

Definition of functions

*/  

function forwardKinematics(q1, q2) {

  const x0 = 0;
  const y0 = 0;

  const x1 =
    L1 * Math.cos(q1);

  const y1 =
    L1 * Math.sin(q1);


  const x2 =
    x1 +
    L2 * Math.cos(q1 + q2);

  const y2 =
    y1 +
    L2 * Math.sin(q1 + q2);


  return {
    x0,
    y0,
    x1,
    y1,
    x2,
    y2
  };
}

function svgY(y) {
  return -y;
}

function drawRobot(q1, q2) {

  const p =
    forwardKinematics(q1, q2);


  /* Link 1 */

  link1.setAttribute("x1", p.x0);
  link1.setAttribute("y1", svgY(p.y0));

  link1.setAttribute("x2", p.x1);
  link1.setAttribute("y2", svgY(p.y1));


  /* Link 2 */

  link2.setAttribute("x1", p.x1);
  link2.setAttribute("y1", svgY(p.y1));

  link2.setAttribute("x2", p.x2);
  link2.setAttribute("y2", svgY(p.y2));


  /* Joint 1 */

  joint1.setAttribute("cx", p.x0);
  joint1.setAttribute("cy", svgY(p.y0));


  /* Joint 2 */

  joint2.setAttribute("cx", p.x1);
  joint2.setAttribute("cy", svgY(p.y1));


  /* End-effector */

  ee.setAttribute("cx", p.x2);
  ee.setAttribute("cy", svgY(p.y2));

  pathPoints.push(
  `${p.x2},${svgY(p.y2)}`
    );

    if (pathPoints.length > 250) {
        pathPoints.shift();
    }

    eePath.setAttribute(
    "points",
    pathPoints.join(" ")
    );

    q1Value.setAttribute(
    "x",
    p.x0 + 25
    );

    q1Value.setAttribute(
    "y",
    svgY(p.y0) + 35
    );

    q1Value.textContent =
    `q₁ = ${(q1 * 180 / Math.PI).toFixed(1)}°`;

    q2Value.setAttribute(
    "x",
    p.x1 + 20
    );

    q2Value.setAttribute(
    "y",
    svgY(p.y1) - 20
    );

    q2Value.textContent =
    `q₂ = ${(q2 * 180 / Math.PI).toFixed(1)}°`;

}


function degToRad(degrees) {

  return degrees * Math.PI / 180;

}

function animate(time) {

  const t =
    time / 1000;


  const q1 =
    0.6 * Math.sin(t);


  const q2 =
    1.0 * Math.sin(1.4 * t);


  drawRobot(q1, q2);


  requestAnimationFrame(animate);
}

function updateRobotFromSliders() {

  const q1Deg = Number(q1Slider.value);

  const q2Deg = Number(q2Slider.value);


  const q1 = degToRad(q1Deg);

  const q2 = degToRad(q2Deg);


  drawRobot(q1, q2);


  q1Display.textContent = `${q1Deg}°`;

  q2Display.textContent = `${q2Deg}°`;
}

clearPathButton.addEventListener(
  "click",
  () => {

    pathPoints.length = 0;

    eePath.setAttribute(
      "points",
      ""
    );

  }
);

resetButton.addEventListener(
  "click",
  () => {

    q1Slider.value = 45;
    q2Slider.value = 60;

    updateRobotFromSliders();

  }
);

/* 

Final Execution

*/


drawRobot(
    degToRad(90),
    degToRad(60)
);

q1Slider.addEventListener(
  "input",
  updateRobotFromSliders
);


q2Slider.addEventListener(
  "input",
  updateRobotFromSliders
);

updateRobotFromSliders();

// requestAnimationFrame(animate);