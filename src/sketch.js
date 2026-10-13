// START HERE.
//
// This is where your sketch lives, controls included (addControls() at the
// bottom). Nothing in this project is off limits.
//
// Two things to know:
//   setup()  runs once, at the start.
//   draw()   runs about 60 times a second, forever. Animation lives here.
//
// The idea of this template: the text is cut into small square parts, like
// tiles. Each part is a physical object for matter.js, a physics library, and
// neighbouring parts are pinned together at their corners. So the letters
// fall, land, bend and wobble as if they were built from pieces. Grab a
// letter with the mouse and throw it around.
//
// matter.js does the physics, p5 does the drawing. Every frame we ask
// matter.js where each part is and how far it has turned, and draw that
// part of the letter there.
// https://brm.io/matter-js/docs/
//
// Note: this is p5 version 2. If you find a tutorial that uses `preload()`,
// it is written for p5 version 1 and will not work here. See the README.

import p5 from 'p5';
import Matter from 'matter-js';
import { createGUI } from './lib/gui.js';
import { applyFont, defaultFont } from './lib/font/index.js';
import { startingText, backgroundColor, foregroundColor } from './config.js';

const { Engine, Bodies, Composite, Constraint, Mouse, MouseConstraint } = Matter;

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
  partSize: 30,
  stiffness: 0.6,
  gravity: 1,
  showParts: false,
};

// Where the text starts before it falls, as a share of the window height.
const startHeightShare = 0.3;

// A square only becomes a part if at least this share of it is covered by
// the letter. Lower keeps thin details, higher drops nearly empty squares.
const minimumInk = 0.05;

// To find out how much of a square is covered, we look at every few pixels.
const inkSampleStep = 2;

// A pixel counts as covered when its alpha is above this (0 to 255).
const inkAlphaThreshold = 128;

// The physical part is a little smaller than the square it draws, so
// neighbours do not rub against each other and jitter.
const bodyShare = 0.9;

// Drawing each part a hair larger hides the thin seams between them.
const seamOverlap = 0.5;

// How thick the invisible floor and walls are. Thick, so fast parts cannot
// shoot through them.
const wallThickness = 200;

// How much a joint calms its own bouncing. 0 springs forever, 1 is very calm.
const jointDamping = 0.1;

// How firmly the mouse holds what it grabbed.
const mouseStiffness = 0.2;

// Colors for the showParts view, which shows what the physics sees.
const partOutlineColor = { r: 120, g: 120, b: 120 };
const jointColor = { r: 60, g: 220, b: 120 };
const jointSize = 4;

let currentFont = null;

// The physics world. It holds every part, joint and wall.
let engine = null;

// Each part remembers its body (the physics object) and where its square
// sat in the text before anything moved, so it knows which piece to show.
let parts = [];
let joints = [];
let walls = [];

// The invisible hand that holds a part while you drag it.
let mouseConstraint = null;

// A hidden image the text is drawn onto, to see which squares it covers.
let inkImage = null;

// What the parts were built from. When any of it changes, we rebuild.
let builtFrom = '';

async function changeFont(url) {
  currentFont = await applyFont(url);
  //forgetting what we built from makes draw() cut the parts again
  builtFrom = '';
}

// Where the middle of the text sits before it falls.
function textStart() {
  return { x: width / 2, y: height * startHeightShare };
}

// Draws the text onto the hidden image and returns a function that tells
// how much of a square, given by its top left corner, is covered by ink.
function measureInk() {
  const start = textStart();
  inkImage.clear();
  inkImage.textAlign(CENTER, CENTER);
  inkImage.textFont(currentFont);
  inkImage.textSize(uiParams.textSize);
  inkImage.fill(255);
  inkImage.noStroke();
  inkImage.text(uiParams.text, start.x, start.y);
  inkImage.loadPixels();

  return (left, top) => {
    let covered = 0;
    let checked = 0;
    for (let y = top; y < top + uiParams.partSize; y += inkSampleStep) {
      for (let x = left; x < left + uiParams.partSize; x += inkSampleStep) {
        //each pixel takes 4 numbers (red, green, blue, alpha); alpha is the 4th
        const alpha = inkImage.pixels[(y * inkImage.width + x) * 4 + 3];
        if (alpha > inkAlphaThreshold) covered++;
        checked++;
      }
    }
    return covered / checked;
  };
}

// Cuts the text into parts and pins neighbours together. Runs at the start,
// and again whenever the text, font, size or part size changes.
function buildParts() {
  //start from an empty world: old parts, joints and walls all go
  Composite.clear(engine.world, false);
  Composite.add(engine.world, walls);

  const size = uiParams.partSize;
  const inkAt = measureInk();
  const columns = floor(width / size);
  const rows = floor(height / size);

  //a grid the size of the window, with a part, or null where there is no ink
  const grid = [];
  parts = [];
  for (let row = 0; row < rows; row++) {
    grid.push([]);
    for (let column = 0; column < columns; column++) {
      const left = column * size;
      const top = row * size;
      if (inkAt(left, top) < minimumInk) {
        grid[row].push(null);
        continue;
      }
      const homeX = left + size / 2;
      const homeY = top + size / 2;
      const body = Bodies.rectangle(homeX, homeY, size * bodyShare, size * bodyShare);
      const part = { body, homeX, homeY };
      grid[row].push(part);
      parts.push(part);
    }
  }

  //two pins along the edge two parts share, one at each end of it. Two pins,
  //not one, so the parts bend like a soft hinge instead of swinging freely.
  joints = [];
  const half = size / 2;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const part = grid[row][column];
      if (!part) continue;

      const right = column + 1 < columns ? grid[row][column + 1] : null;
      if (right) {
        pinTogether(part, right, { x: half, y: -half }, { x: -half, y: -half });
        pinTogether(part, right, { x: half, y: half }, { x: -half, y: half });
      }

      const below = row + 1 < rows ? grid[row + 1][column] : null;
      if (below) {
        pinTogether(part, below, { x: -half, y: half }, { x: -half, y: -half });
        pinTogether(part, below, { x: half, y: half }, { x: half, y: -half });
      }
    }
  }

  Composite.add(
    engine.world,
    parts.map((part) => part.body),
  );
  Composite.add(engine.world, joints);
  Composite.add(engine.world, mouseConstraint);

  builtFrom = currentBuildKey();
}

// A joint that holds a spot on one part to a spot on another. The spots are
// measured from each part's middle, and turn along with the part.
function pinTogether(partA, partB, spotOnA, spotOnB) {
  joints.push(
    Constraint.create({
      bodyA: partA.body,
      bodyB: partB.body,
      pointA: spotOnA,
      pointB: spotOnB,
      length: 0,
      stiffness: uiParams.stiffness,
      damping: jointDamping,
    }),
  );
}

// Floor and side walls, just outside the window, so the parts stay in view.
function buildWalls() {
  const floorPart = Bodies.rectangle(width / 2, height + wallThickness / 2, width + wallThickness * 2, wallThickness, {
    isStatic: true,
  });
  const leftWall = Bodies.rectangle(-wallThickness / 2, height / 2, wallThickness, height * 2, { isStatic: true });
  const rightWall = Bodies.rectangle(width + wallThickness / 2, height / 2, wallThickness, height * 2, {
    isStatic: true,
  });
  walls = [floorPart, leftWall, rightWall];
}

// Everything that, when changed, means the parts have to be cut again.
// (A new font clears builtFrom itself, once the font has loaded.)
function currentBuildKey() {
  return [uiParams.text, uiParams.textSize, uiParams.partSize, width, height].join('|');
}

// Draws one part: move to where the body is, turn as far as it has turned,
// then show only its own square of the text, as if through a small window.
function drawPart(part) {
  const size = uiParams.partSize;
  const start = textStart();

  push();
  translate(part.body.position.x, part.body.position.y);
  rotate(part.body.angle);

  beginClip();
  rect(-size / 2 - seamOverlap, -size / 2 - seamOverlap, size + seamOverlap * 2, size + seamOverlap * 2);
  endClip();

  //the whole text, shifted so that this part's square lands on the window
  text(uiParams.text, start.x - part.homeX, start.y - part.homeY);
  pop();
}

// What the physics sees: the parts' outlines and the pins holding them.
function drawPhysicsView() {
  noFill();
  stroke(partOutlineColor.r, partOutlineColor.g, partOutlineColor.b);
  strokeWeight(1);
  for (const part of parts) {
    beginShape();
    for (const corner of part.body.vertices) vertex(corner.x, corner.y);
    endShape(CLOSE);
  }

  noStroke();
  fill(jointColor.r, jointColor.g, jointColor.b);
  for (const joint of joints) {
    const spot = Constraint.pointAWorld(joint);
    circle(spot.x, spot.y, jointSize);
  }
}

window.setup = async function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  textAlign(CENTER, CENTER);

  engine = Engine.create();

  //lets you grab parts with the mouse. matter.js reads this attribute to
  //match its mouse to p5's on high resolution (retina) screens.
  canvas.elt.setAttribute('data-pixel-ratio', pixelDensity());
  const mouse = Mouse.create(canvas.elt);
  mouseConstraint = MouseConstraint.create(engine, {
    mouse,
    constraint: { stiffness: mouseStiffness },
  });

  //a single pixel per pixel, so the ink check reads the image predictably
  inkImage = createGraphics(width, height);
  inkImage.pixelDensity(1);

  //loading a font takes a moment, so we wait for it before drawing
  await changeFont(uiParams.font);
  buildWalls();
  buildParts();
};

window.draw = function draw() {
  background(uiParams.backgroundColor.r, uiParams.backgroundColor.g, uiParams.backgroundColor.b);
  if (!currentFont) return;

  //a new text, font or size gets cut into parts again, and falls again
  if (currentBuildKey() !== builtFrom) buildParts();

  engine.gravity.y = uiParams.gravity;
  Engine.update(engine);

  fill(uiParams.foregroundColor.r, uiParams.foregroundColor.g, uiParams.foregroundColor.b);
  noStroke();
  textSize(uiParams.textSize);
  for (const part of parts) drawPart(part);

  if (uiParams.showParts) drawPhysicsView();
};

window.windowResized = function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  inkImage.resizeCanvas(width, height);
  buildWalls();
  buildParts();
};

// This template's controls, added below the shared ones from src/lib/gui.js.
function addControls(gui) {
  gui.add(uiParams, 'partSize', 10, 80, 1).name('part size');
  gui.add(uiParams, 'stiffness', 0.05, 1, 0.01).onChange((value) => {
    for (const joint of joints) joint.stiffness = value;
  });
  gui.add(uiParams, 'gravity', -1, 2, 0.01);
  gui.add(uiParams, 'showParts').name('show parts');

  //a function on an object is how lil-gui makes a button
  gui.add({ dropAgain: buildParts }, 'dropAgain').name('drop again');
}

// Builds the control panel, then starts p5. p5 looks for the setup() and
// draw() you defined above and runs them.
createGUI({ params: uiParams, onFontChange: changeFont, addControls });
new p5();
