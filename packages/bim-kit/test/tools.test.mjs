/**
 * Tests for the grid, the measurement and showing one object alone.
 *
 * The grid and the line are scene objects, which three.js builds in Node. The
 * label of a measurement is a page element, so this file runs in jsdom.
 */

import './support/dom.mjs';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3,
} from 'three';
import {
  CLOSE_M, GRID_DROP_M, GRID_MIN_SPAN_M, SHORTCUTS, SceneView, angleAt, createGrid,
  createMeasure, distanceText, gridSpan, measureText, polygonArea,
} from '../dist/esm/viewer/index.js';

function box(globalId, y, size = [8, 3, 4]) {
  const mesh = new Mesh(new BoxGeometry(...size), new MeshStandardMaterial());
  mesh.position.set(0, y + size[1] / 2, 0);
  mesh.userData.globalId = globalId;
  mesh.userData.ifcClass = 'IfcWall';
  return mesh;
}

function model() {
  const group = new Group();
  group.add(box('w1', 1), box('w2', 1));
  group.updateMatrixWorld(true);
  return group;
}

const key = (letter) => SHORTCUTS.find((shortcut) => shortcut.key === letter);

describe('gridSpan', () => {
  test('reaches past the model and ends on a stronger line', () => {
    // 8 m wide with half its size each side is 16 m, rounded up to 20.
    assert.equal(gridSpan({ x: 8, z: 4 }), 20);
    assert.equal(gridSpan({ x: 30, z: 40 }) % 5, 0);
    assert.ok(gridSpan({ x: 30, z: 40 }) >= 80);
  });

  test('is never smaller than the minimum, for one small object', () => {
    assert.equal(gridSpan({ x: 0.1, z: 0.1 }), GRID_MIN_SPAN_M);
  });
});

describe('createGrid', () => {
  test('lays a grid of metres just under the lowest object', () => {
    const scene = new Scene();
    createGrid(scene, model());
    const lines = scene.children.filter((child) => child.name === 'grid');
    assert.equal(lines.length, 2);
    for (const line of lines) assert.ok(Math.abs(line.position.y - (1 - GRID_DROP_M)) < 1e-9);
  });

  test('can be hidden, cannot be clicked and goes away', () => {
    const scene = new Scene();
    const grid = createGrid(scene, model());
    grid.setVisible(false);
    const lines = scene.children.filter((child) => child.name === 'grid');
    assert.ok(lines.every((line) => line.visible === false));
    const hits = [];
    lines[0].raycast(undefined, hits);
    assert.deepEqual(hits, []);
    grid.dispose();
    assert.equal(scene.children.filter((child) => child.name === 'grid').length, 0);
  });

  test('draws nothing for an empty model', () => {
    const scene = new Scene();
    const grid = createGrid(scene, new Group());
    assert.equal(scene.children.length, 0);
    assert.doesNotThrow(() => { grid.setVisible(true); grid.dispose(); });
  });
});

describe('createMeasure', () => {
  function setUp() {
    const scene = new Scene();
    const overlay = document.createElement('div');
    document.body.appendChild(overlay);
    return { scene, overlay, measure: createMeasure(scene, overlay) };
  }

  test('writes the length to the centimetre', () => {
    assert.equal(distanceText(new Vector3(0, 0, 0), new Vector3(3, 4, 0)), '5.00 m');
    assert.equal(distanceText(new Vector3(0, 0, 0), new Vector3(0, 0, 1.234)), '1.23 m');
  });

  test('draws a line and a length once the second point is put down', () => {
    const { scene, overlay, measure } = setUp();
    const line = scene.getObjectByName('measure');
    measure.addPoint(new Vector3(0, 0, 0));
    assert.equal(line.visible, false);
    assert.equal(measure.text, null);
    measure.addPoint(new Vector3(3, 4, 0));
    assert.equal(line.visible, true);
    // Both ends are in the geometry that is drawn, not only in the list.
    const position = line.geometry.getAttribute('position');
    assert.deepEqual([...position.array].slice(0, 6), [0, 0, 0, 3, 4, 0]);
    assert.equal(line.geometry.drawRange.count, 2);
    assert.ok(line.geometry.boundingSphere.radius > 2);
    assert.equal(measure.text, '5.00 m');
    assert.equal(overlay.querySelector('[data-bim-measure]').textContent, '5.00 m');
  });

  test('keeps a copy of each point, so a moving cursor cannot move it', () => {
    const { measure } = setUp();
    const point = new Vector3(1, 0, 0);
    measure.addPoint(point);
    point.set(9, 9, 9);
    assert.deepEqual(measure.points[0].toArray(), [1, 0, 0]);
  });

  test('starts a new measurement on the third point', () => {
    const { scene, measure } = setUp();
    const scene_line = () => scene.getObjectByName('measure').geometry.getAttribute('position');
    measure.addPoint(new Vector3(0, 0, 0));
    measure.addPoint(new Vector3(1, 0, 0));
    measure.addPoint(new Vector3(5, 5, 5));
    assert.equal(measure.points.length, 1);
    assert.equal(measure.text, null);
    measure.addPoint(new Vector3(5, 5, 7));
    const position = scene_line(measure);
    assert.deepEqual([...position.array].slice(0, 6), [5, 5, 5, 5, 5, 7]);
  });

  test('puts the label over the middle of the line, and hides it without one', () => {
    const { overlay, measure } = setUp();
    const camera = new PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const label = overlay.querySelector('[data-bim-measure]');
    measure.place(camera, 200, 200);
    assert.equal(label.style.display, 'none');
    measure.addPoint(new Vector3(-1, 0, 0));
    measure.addPoint(new Vector3(1, 0, 0));
    measure.place(camera, 200, 200);
    assert.equal(label.style.display, 'block');
    // The middle of the line is the centre of the view.
    assert.match(label.style.transform, /^translate\(100px, 100px\)/);
  });

  test('marks the first point at once and both ends once closed', () => {
    const { overlay, measure } = setUp();
    const camera = new PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const dots = () => [...overlay.querySelectorAll('[data-bim-measure-end]')];
    assert.equal(dots().length, 0);
    measure.addPoint(new Vector3(0, 0, 0));
    measure.place(camera, 200, 200);
    assert.deepEqual(dots().map((dot) => dot.style.display), ['block']);
    assert.match(dots()[0].style.transform, /^translate\(100px, 100px\)/);
    measure.addPoint(new Vector3(1, 0, 0));
    measure.place(camera, 200, 200);
    assert.deepEqual(dots().map((dot) => dot.style.display), ['block', 'block']);
    measure.clear();
    assert.deepEqual(dots().map((dot) => dot.style.display), ['none', 'none']);
  });

  test('clears and gives everything back on dispose', () => {
    const { scene, overlay, measure } = setUp();
    measure.addPoint(new Vector3(0, 0, 0));
    measure.addPoint(new Vector3(1, 0, 0));
    measure.clear();
    assert.equal(measure.points.length, 0);
    assert.equal(scene.getObjectByName('measure').visible, false);
    measure.dispose();
    assert.equal(scene.getObjectByName('measure'), undefined);
    assert.equal(overlay.querySelector('[data-bim-measure]'), null);
    assert.equal(overlay.querySelector('[data-bim-measure-end]'), null);
  });

  test('cannot be clicked', () => {
    const { scene } = setUp();
    const hits = [];
    scene.getObjectByName('measure').raycast(undefined, hits);
    assert.deepEqual(hits, []);
  });
});

describe('showing the selection alone', () => {
  function view() {
    return new SceneView(model());
  }

  test('shows only the selected object and everything again on the second press', () => {
    const scene = view();
    scene.state.selected = 'w2';
    key('i').run({ view: scene, refresh: () => undefined });
    assert.equal(key('i').on(scene), true);
    assert.equal(scene.meshes.get('w1').visible, false);
    assert.equal(scene.meshes.get('w2').visible, true);
    key('i').run({ view: scene, refresh: () => undefined });
    assert.equal(scene.meshes.get('w1').visible, true);
  });

  test('does nothing with nothing selected', () => {
    const scene = view();
    key('i').run({ view: scene, refresh: () => undefined });
    assert.equal(scene.state.isolated, null);
    assert.equal(scene.meshes.get('w1').visible, true);
  });

  test('shows the object even on a floor or behind a lid that hides it', () => {
    const scene = view();
    scene.state.selected = 'w1';
    scene.hide('w1');
    scene.toggleIsolation();
    assert.equal(scene.meshes.get('w1').visible, true);
  });
});

describe('the grid and measure toggles', () => {
  test('the grid starts on, the measuring off, and reset puts them back', () => {
    const scene = new SceneView(model());
    assert.equal(key('g').on(scene), true);
    assert.equal(key('d').on(scene), false);
    key('g').run({ view: scene, refresh: () => undefined });
    key('d').run({ view: scene, refresh: () => undefined });
    scene.state.selected = 'w1';
    scene.toggleIsolation();
    assert.deepEqual(
      [scene.state.grid, scene.state.measuring, scene.state.isolated],
      [false, 'length', 'w1'],
    );
    scene.reset();
    assert.deepEqual(
      [scene.state.grid, scene.state.measuring, scene.state.isolated],
      [true, null, null],
    );
  });

  test('every new shortcut has a key of its own', () => {
    const keys = SHORTCUTS.map((shortcut) => shortcut.key);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe('measuring an area and an angle', () => {
  const v = (x, y, z) => new Vector3(x, y, z);

  test('the area of a polygon, whichever way it faces', () => {
    const floor = [v(0, 0, 0), v(4, 0, 0), v(4, 0, 3), v(0, 0, 3)];
    assert.ok(Math.abs(polygonArea(floor) - 12) < 1e-9);
    const wall = [v(0, 0, 0), v(2, 0, 0), v(2, 3, 0), v(0, 3, 0)];
    assert.ok(Math.abs(polygonArea(wall) - 6) < 1e-9);
    assert.equal(polygonArea([v(0, 0, 0), v(1, 0, 0)]), 0);
  });

  test('the angle at a corner, in degrees', () => {
    assert.ok(Math.abs(angleAt(v(1, 0, 0), v(0, 0, 0), v(0, 0, 1)) - 90) < 1e-9);
    assert.ok(Math.abs(angleAt(v(1, 0, 0), v(0, 0, 0), v(1, 0, 1)) - 45) < 1e-9);
    assert.equal(angleAt(v(0, 0, 0), v(0, 0, 0), v(1, 0, 0)), 0);
  });

  test('says nothing until there are enough points', () => {
    assert.equal(measureText('length', [v(0, 0, 0)]), null);
    assert.equal(measureText('angle', [v(0, 0, 0), v(1, 0, 0)]), null);
    assert.equal(measureText('area', [v(0, 0, 0), v(1, 0, 0)]), null);
    assert.equal(measureText('angle', [v(1, 0, 0), v(0, 0, 0), v(0, 0, 1)]), '90.0°');
  });

  function setUp() {
    const scene = new Scene();
    const overlay = document.createElement('div');
    document.body.appendChild(overlay);
    return { scene, overlay, measure: createMeasure(scene, overlay) };
  }

  test('an area grows with each point and closes on a click back at the first', () => {
    const { scene, measure } = setUp();
    measure.setMode('area');
    for (const point of [v(0, 0, 0), v(4, 0, 0), v(4, 0, 3)]) measure.addPoint(point);
    assert.equal(measure.text, '6.00 m²');
    measure.addPoint(v(0, 0, 3));
    assert.equal(measure.text, '12.00 m²');
    assert.equal(measure.complete, false);
    measure.addPoint(v(CLOSE_M / 2, 0, 0));
    assert.equal(measure.complete, true);
    assert.equal(measure.points.length, 4);
    // The outline is drawn closed, back to the first point.
    assert.equal(scene.getObjectByName('measure').geometry.drawRange.count, 5);
    measure.addPoint(v(9, 0, 9));
    assert.equal(measure.points.length, 1);
  });

  test('an angle takes three points and starts again on the fourth', () => {
    const { measure } = setUp();
    measure.setMode('angle');
    for (const point of [v(1, 0, 0), v(0, 0, 0), v(0, 0, 1)]) measure.addPoint(point);
    assert.deepEqual([measure.complete, measure.text], [true, '90.0°']);
    measure.addPoint(v(5, 5, 5));
    assert.equal(measure.points.length, 1);
  });

  test('changing the mode takes the current measurement away', () => {
    const { measure } = setUp();
    measure.addPoint(v(0, 0, 0));
    measure.setMode('angle');
    assert.deepEqual([measure.mode, measure.points.length], ['angle', 0]);
  });

  test('d cycles length, area, angle and off, and says which', () => {
    const scene = new SceneView(model());
    const seen = [];
    for (let i = 0; i < 4; i += 1) {
      key('d').run({ view: scene, refresh: () => undefined });
      seen.push([scene.state.measuring, key('d').badge(scene)]);
    }
    assert.deepEqual(seen, [['length', 'Length'], ['area', 'Area'], ['angle', 'Angle'], [null, undefined]]);
  });
});
