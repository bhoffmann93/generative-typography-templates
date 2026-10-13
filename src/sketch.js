// START HERE.
//
// This is where your sketch lives, controls included (addControls() at the
// bottom). Nothing in this project is off limits.
//
// Two things to know:
//   setup()  runs once, at the start.
//   draw()   runs about 60 times a second, forever. Animation lives here.
//
// The idea of this template: the text is drawn onto a flat image, and that
// image is stretched over a grid of points, like a printed rubber sheet.
// Drag the points and the letters bend with them.
//
// You shape two poses, A and B. With animate on, the sketch moves back and
// forth between them.
//
// Note: this is p5 version 2. If you find a tutorial that uses `preload()`,
// it is written for p5 version 1 and will not work here. See the README.

import p5 from 'p5';
import { createGUI } from './lib/gui.js';
import { Easings, easingNames } from './lib/easings.js';
import { cubicPulse } from './lib/math.js';
import { applyFont, defaultFont } from './lib/font/index.js';
import { startingText, backgroundColor, foregroundColor } from './config.js';

// The values the control panel changes. Add your own here, then add a line
// in addControls() at the bottom of this file to give it a slider or a checkbox.
//
// The colors start at whatever you set in src/config.js, and are { r, g, b }
// objects, each channel a number from 0 to 255.
const uiParams = {
  text: startingText,
  font: defaultFont,
  textSize: 300,
  foregroundColor,
  backgroundColor,
  columns: 4,
  rows: 3,
  editPose: 'A',
  falloff: 0,
  showMesh: true,
  animate: false,
  loopSeconds: 2,
  easing: 'backInOut',
};

// How big the sheet is, as a share of the window.
const sheetWidthShare = 0.8;
const sheetHeightShare = 0.6;

// How close, in pixels, the mouse has to be to grab a point.
const grabRadius = 20;
const handleSize = 10;

let currentFont = null;

// The flat image the text is drawn onto. It becomes the sheet's texture.
let textImage = null;

// Every point of the grid has a resting spot and, for each pose, an offset:
// how far it has been dragged away from that spot. Offsets start at zero,
// so a fresh pose is the flat, undistorted text.
let restPositions = [];
const poses = { A: [], B: [] };

// While dragging: which point, where the mouse started, and the offsets as
// they were before the drag, so the drag can be measured from the start.
let grabbedIndex = null;
let grabStartMouse = null;
let offsetsBeforeGrab = null;

// The panel's animate checkbox, so we can untick it when you start dragging.
let animateControl = null;

async function changeFont(url) {
  currentFont = await applyFont(url);
}

// Lays out a fresh grid. Called at the start, and whenever the window size
// or the number of columns or rows changes. Poses go back to flat.
function buildGrid() {
  const sheetWidth = width * sheetWidthShare;
  const sheetHeight = height * sheetHeightShare;

  restPositions = [];
  for (let row = 0; row <= uiParams.rows; row++) {
    for (let column = 0; column <= uiParams.columns; column++) {
      //u and v say where on the image this point sits, from 0 to 1
      const u = column / uiParams.columns;
      const v = row / uiParams.rows;
      restPositions.push({
        x: lerp(-sheetWidth / 2, sheetWidth / 2, u),
        y: lerp(-sheetHeight / 2, sheetHeight / 2, v),
        u,
        v,
      });
    }
  }

  poses.A = restPositions.map(() => ({ x: 0, y: 0 }));
  poses.B = restPositions.map(() => ({ x: 0, y: 0 }));

  textImage = createGraphics(sheetWidth, sheetHeight);
}

// Where every point is right now: its resting spot plus an offset that is
// part way between pose A and pose B. `amount` 0 is pose A, 1 is pose B.
function currentPositions(amount) {
  return restPositions.map((rest, index) => ({
    x: rest.x + lerp(poses.A[index].x, poses.B[index].x, amount),
    y: rest.y + lerp(poses.A[index].y, poses.B[index].y, amount),
    u: rest.u,
    v: rest.v,
  }));
}

// Redraws the text onto the flat image. Doing it every frame means changes
// to the text, font, size or color show up straight away.
function drawTextImage() {
  textImage.clear();
  textImage.textAlign(CENTER, CENTER);
  textImage.textFont(currentFont);
  textImage.textSize(uiParams.textSize);
  textImage.fill(uiParams.foregroundColor.r, uiParams.foregroundColor.g, uiParams.foregroundColor.b);
  textImage.noStroke();
  textImage.text(uiParams.text, textImage.width / 2, textImage.height / 2);
}

// The grid is stored row by row, so the point at a column and row is found
// by counting whole rows first, then the columns.
function pointAt(positions, column, row) {
  return positions[row * (uiParams.columns + 1) + column];
}

// Each square of the grid is drawn as two triangles, and every corner says
// which spot of the image it shows (its u and v). That is what makes the
// image stretch when a corner moves.
function drawSheet(positions) {
  noStroke();
  texture(textImage);
  beginShape(TRIANGLES);
  for (let row = 0; row < uiParams.rows; row++) {
    for (let column = 0; column < uiParams.columns; column++) {
      const topLeft = pointAt(positions, column, row);
      const topRight = pointAt(positions, column + 1, row);
      const bottomLeft = pointAt(positions, column, row + 1);
      const bottomRight = pointAt(positions, column + 1, row + 1);

      for (const corner of [topLeft, topRight, bottomRight, topLeft, bottomRight, bottomLeft]) {
        vertex(corner.x, corner.y, 0, corner.u, corner.v);
      }
    }
  }
  endShape();
}

// The grid lines and the round handles you drag.
function drawMesh(positions) {
  //a tiny step towards the camera keeps the lines from flickering into the sheet
  push();
  translate(0, 0, 1);

  stroke(uiParams.foregroundColor.r, uiParams.foregroundColor.g, uiParams.foregroundColor.b, 120);
  strokeWeight(1);
  noFill();
  for (let row = 0; row <= uiParams.rows; row++) {
    for (let column = 0; column <= uiParams.columns; column++) {
      const point = pointAt(positions, column, row);
      if (column < uiParams.columns) {
        const right = pointAt(positions, column + 1, row);
        line(point.x, point.y, right.x, right.y);
      }
      if (row < uiParams.rows) {
        const below = pointAt(positions, column, row + 1);
        line(point.x, point.y, below.x, below.y);
      }
    }
  }

  noStroke();
  positions.forEach((point, index) => {
    if (index === grabbedIndex) {
      fill(255, 80, 60);
    } else {
      fill(uiParams.foregroundColor.r, uiParams.foregroundColor.g, uiParams.foregroundColor.b);
    }
    circle(point.x, point.y, handleSize);
  });

  pop();
}

// Seen straight on, p5's 3D camera puts the middle of the window at 0, 0,
// and one unit is one pixel. So the mouse position, measured from the
// middle, can be compared to the points directly.
function mouseFromCenter() {
  return { x: mouseX - width / 2, y: mouseY - height / 2 };
}

function grabPoint() {
  //dragging edits one pose, so the sheet stops moving and shows that pose
  if (uiParams.animate) {
    uiParams.animate = false;
    animateControl.updateDisplay();
  }

  const mouse = mouseFromCenter();
  const positions = currentPositions(uiParams.editPose === 'B' ? 1 : 0);

  let closestDistance = grabRadius;
  grabbedIndex = null;
  positions.forEach((point, index) => {
    const distance = dist(mouse.x, mouse.y, point.x, point.y);
    if (distance < closestDistance) {
      closestDistance = distance;
      grabbedIndex = index;
    }
  });

  if (grabbedIndex !== null) {
    grabStartMouse = mouse;
    offsetsBeforeGrab = poses[uiParams.editPose].map((offset) => ({ ...offset }));
  }
}

window.mouseDragged = function mouseDragged() {
  if (grabbedIndex === null) return;

  const mouse = mouseFromCenter();
  const moveX = mouse.x - grabStartMouse.x;
  const moveY = mouse.y - grabStartMouse.y;
  const grabbedRest = restPositions[grabbedIndex];

  //with falloff above 0, nearby points come along too, less the further
  //away they are, like pulling on cloth
  poses[uiParams.editPose].forEach((offset, index) => {
    const rest = restPositions[index];
    const distance = dist(rest.x, rest.y, grabbedRest.x, grabbedRest.y);
    const pull = index === grabbedIndex ? 1 : cubicPulse(0, uiParams.falloff, distance);
    offset.x = offsetsBeforeGrab[index].x + moveX * pull;
    offset.y = offsetsBeforeGrab[index].y + moveY * pull;
  });
};

window.mouseReleased = function mouseReleased() {
  grabbedIndex = null;
};

window.setup = async function setup() {
  const canvas = createCanvas(windowWidth, windowHeight, WEBGL);
  //u and v run from 0 to 1, instead of counting the image's pixels
  textureMode(NORMAL);

  //listening on the canvas, not the whole page, so clicks in the panel
  //do not grab points
  canvas.mousePressed(grabPoint);

  //loading a font takes a moment, so we wait for it before drawing
  await changeFont(uiParams.font);
  buildGrid();
};

window.draw = function draw() {
  background(uiParams.backgroundColor.r, uiParams.backgroundColor.g, uiParams.backgroundColor.b);
  if (!textImage) return;

  //0 shows pose A, 1 shows pose B
  let amount = uiParams.editPose === 'B' ? 1 : 0;

  if (uiParams.animate) {
    const timeInSeconds = millis() / 1000;
    //counts 0 to 1 over loopSeconds, then starts again at 0
    const loopTime = (timeInSeconds / uiParams.loopSeconds) % 1;
    //0 to 1 and back to 0
    const backAndForthTime = 1 - abs(loopTime * 2 - 1);
    amount = Easings[uiParams.easing](backAndForthTime);
  }

  const positions = currentPositions(amount);
  drawTextImage();
  drawSheet(positions);
  if (uiParams.showMesh) drawMesh(positions);
};

window.windowResized = function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  buildGrid();
};

// This template's controls, added below the shared ones from src/lib/gui.js.
function addControls(gui) {
  gui.add(uiParams, 'columns', 1, 20, 1).onFinishChange(buildGrid);
  gui.add(uiParams, 'rows', 1, 20, 1).onFinishChange(buildGrid);
  gui.add(uiParams, 'editPose', ['A', 'B']).name('edit pose');
  gui.add(uiParams, 'falloff', 0, 500, 1);
  gui.add(uiParams, 'showMesh').name('show mesh');
  animateControl = gui.add(uiParams, 'animate');
  gui.add(uiParams, 'loopSeconds', 0.5, 10, 0.1).name('loop seconds');
  gui.add(uiParams, 'easing', easingNames);

  //a function on an object is how lil-gui makes a button
  const actions = {
    copyAToB: () => {
      poses.B = poses.A.map((offset) => ({ ...offset }));
    },
    resetPose: () => {
      poses[uiParams.editPose] = restPositions.map(() => ({ x: 0, y: 0 }));
    },
  };
  gui.add(actions, 'copyAToB').name('copy A to B');
  gui.add(actions, 'resetPose').name('reset edited pose');
}

// Builds the control panel, then starts p5. p5 looks for the setup() and
// draw() you defined above and runs them.
createGUI({ params: uiParams, onFontChange: changeFont, addControls });
new p5();
