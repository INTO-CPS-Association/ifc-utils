/**
 * Tests for the view cube, the parallel view and the shadow toggle.
 *
 * The cube is drawn with a renderer, which needs WebGL, so a stand-in records
 * the calls. Picking runs a ray against the cube's own scene, which three.js
 * does in Node.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { BoxGeometry, Group, Mesh, PerspectiveCamera, Vector3 } from 'three';
import {
  CUBE_MARGIN_PX, CUBE_SIZE_PX, FAR_PLANE, PARALLEL_FOV, PERSPECTIVE_FOV, SHORTCUTS, SceneView,
  backOff, createViewCube, cubeViewport, directionAt, frameFrom, setParallel,
} from '../dist/esm/viewer/index.js';

const key = (letter) => SHORTCUTS.find((shortcut) => shortcut.key === letter);

/** A renderer that records what the cube asks of it, for a view `width` by `height`. */
function fakeRenderer(width, height) {
  const calls = [];
  return {
    calls,
    autoClear: true,
    getSize: (into) => into.set(width, height),
    setScissorTest: (on) => calls.push(['scissor', on]),
    setViewport: (...args) => calls.push(['viewport', ...args]),
    setScissor: () => undefined,
    clearDepth: () => calls.push(['clearDepth']),
    render: () => calls.push(['render']),
  };
}

function lookingFrom(x, y, z) {
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(x, y, z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

describe('cubeViewport', () => {
  test('sits in the bottom right corner, in page and in WebGL coordinates', () => {
    const { left, top, side, x, y } = cubeViewport(800, 600);
    assert.equal(side, CUBE_SIZE_PX);
    assert.equal(left, 800 - CUBE_MARGIN_PX - CUBE_SIZE_PX);
    assert.equal(top, 600 - CUBE_MARGIN_PX - CUBE_SIZE_PX);
    assert.deepEqual([x, y], [left, CUBE_MARGIN_PX]);
  });

  test('shrinks inside a small view and vanishes in a tiny one', () => {
    assert.equal(cubeViewport(100, 100).side, 100 - 2 * CUBE_MARGIN_PX);
    assert.equal(cubeViewport(10, 10).side, 0);
  });
});

describe('directionAt', () => {
  test('the middle of a face looks from that face', () => {
    assert.deepEqual(directionAt({ x: 0, y: 0.5, z: 0 }).toArray(), [0, 1, 0]);
    assert.deepEqual(directionAt({ x: 0.1, y: -0.1, z: 0.5 }).toArray(), [0, 0, 1]);
  });

  test('an edge looks from between two faces, a corner from between three', () => {
    assert.deepEqual(directionAt({ x: 0, y: 0.5, z: 0.45 }).toArray(), [0, 1, 1]);
    assert.deepEqual(directionAt({ x: -0.45, y: 0.5, z: 0.45 }).toArray(), [-1, 1, 1]);
  });
});

describe('createViewCube', () => {
  test('draws into its corner and leaves the renderer as it found it', () => {
    const cube = createViewCube();
    const renderer = fakeRenderer(800, 600);
    cube.draw(renderer, lookingFrom(0, 0, 10));
    const { x, y, side } = cubeViewport(800, 600);
    assert.deepEqual(renderer.calls[1], ['viewport', x, y, side, side]);
    assert.ok(renderer.calls.some(([name]) => name === 'render'));
    assert.deepEqual(renderer.calls.at(-1), ['viewport', 0, 0, 800, 600]);
    assert.equal(renderer.autoClear, true);
    cube.dispose();
  });

  test('a click on the middle of the cube looks from the side facing the viewer', () => {
    const cube = createViewCube();
    cube.draw(fakeRenderer(800, 600), lookingFrom(0, 0, 10));
    const { left, top, side } = cubeViewport(800, 600);
    const from = cube.pick(left + side / 2, top + side / 2, 800, 600);
    assert.deepEqual(from.toArray(), [0, 0, 1]);
    cube.dispose();
  });

  test('a view from above shows the top in the middle', () => {
    const cube = createViewCube();
    cube.draw(fakeRenderer(800, 600), lookingFrom(0, 10, 0.0001));
    const { left, top, side } = cubeViewport(800, 600);
    assert.deepEqual(cube.pick(left + side / 2, top + side / 2, 800, 600).toArray(), [0, 1, 0]);
    cube.dispose();
  });

  test('a click away from the cube is not its business', () => {
    const cube = createViewCube();
    cube.draw(fakeRenderer(800, 600), lookingFrom(0, 0, 10));
    assert.equal(cube.pick(10, 10, 800, 600), null);
    const { left, top } = cubeViewport(800, 600);
    // Inside the square but off the cube itself, in its corner.
    assert.equal(cube.pick(left + 1, top + 1, 800, 600), null);
    cube.dispose();
  });
});

describe('frameFrom', () => {
  function model(size = 10) {
    const group = new Group();
    group.add(new Mesh(new BoxGeometry(size, size, size)));
    group.updateMatrixWorld(true);
    return group;
  }

  test('looks at the model from the direction asked for', () => {
    const camera = new PerspectiveCamera(45, 1, 0.1, 100);
    const controls = { target: new Vector3(), update: () => undefined };
    frameFrom(camera, controls, model(), new Vector3(1, 1, 1));
    const from = camera.position.clone().sub(controls.target).normalize();
    assert.ok(from.distanceTo(new Vector3(1, 1, 1).normalize()) < 1e-9);
  });

  test('never cuts a large site off with the far plane, even through the narrow lens', () => {
    const camera = new PerspectiveCamera(PARALLEL_FOV, 1, 0.1, 100);
    const controls = { target: new Vector3(), update: () => undefined };
    frameFrom(camera, controls, model(400), new Vector3(1, 1, 1));
    const distance = camera.position.distanceTo(controls.target);
    assert.ok(distance > FAR_PLANE);
    assert.ok(camera.far > distance + 300);
  });
});

describe('the parallel view', () => {
  test('backs off by as much as the lens narrows', () => {
    assert.equal(backOff(45, 45), 1);
    assert.ok(Math.abs(backOff(45, 1.5) - Math.tan(Math.PI / 8) / Math.tan(0.75 * Math.PI / 180)) < 1e-12);
  });

  test('keeps the same thing in shot and comes back to where it was', () => {
    const camera = new PerspectiveCamera(PERSPECTIVE_FOV, 1, 0.1, 100);
    camera.position.set(3, 4, 12);
    const controls = { target: new Vector3(1, 1, 1), update: () => undefined };
    const before = camera.position.clone();
    setParallel(camera, controls, true);
    assert.equal(camera.fov, PARALLEL_FOV);
    const factor = backOff(PERSPECTIVE_FOV, PARALLEL_FOV);
    assert.ok(Math.abs(camera.position.distanceTo(controls.target)
      - before.distanceTo(controls.target) * factor) < 1e-6);
    assert.ok(Math.abs(camera.far - 100 * factor) < 1e-6);
    setParallel(camera, controls, true);
    assert.equal(camera.fov, PARALLEL_FOV);
    setParallel(camera, controls, false);
    assert.equal(camera.fov, PERSPECTIVE_FOV);
    assert.ok(camera.position.distanceTo(before) < 1e-6);
  });
});

describe('the o and l keys', () => {
  test('switch the parallel view and the shadows, and reset puts both back', () => {
    const group = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1));
    mesh.userData.globalId = 'g1';
    group.add(mesh);
    const view = new SceneView(group);
    assert.deepEqual([key('o').on(view), key('l').on(view)], [false, true]);
    key('o').run({ view, refresh: () => undefined });
    key('l').run({ view, refresh: () => undefined });
    assert.deepEqual([view.state.parallel, view.state.shadows], [true, false]);
    view.reset();
    assert.deepEqual([view.state.parallel, view.state.shadows], [false, true]);
  });

  test('the shadows button says the shadows are paused while a cut is on', () => {
    const group = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1));
    mesh.userData.globalId = 'g1';
    group.add(mesh);
    group.updateMatrixWorld(true);
    const view = new SceneView(group);
    assert.equal(key('l').badge(view), undefined);
    view.state.vertical = 'x';
    assert.equal(key('l').badge(view), 'Paused By The Cut');
    view.state.shadows = false;
    assert.equal(key('l').badge(view), undefined);
  });
});
