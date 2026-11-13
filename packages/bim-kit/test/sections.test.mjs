/**
 * Tests for the cuts: horizontal and vertical together, moved by steps, and
 * the clicks that land beyond them.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import {
  CUT_M, CUT_STEP_M, SHORTCUTS, SceneView, createSection,
} from '../dist/esm/viewer/index.js';

const key = (letter) => SHORTCUTS.find((shortcut) => shortcut.key === letter);
const press = (letter, view) => key(letter).run({ view, refresh: () => undefined });

/** A wall 10 m along X and 4 m along Z, standing on the ground, centred at x 5 and z 2. */
function view() {
  const group = new Group();
  const wall = new Mesh(new BoxGeometry(10, 3, 4), new MeshStandardMaterial());
  wall.position.set(5, 1.5, 2);
  wall.userData.globalId = 'w1';
  wall.userData.ifcClass = 'IfcWall';
  group.add(wall);
  group.updateMatrixWorld(true);
  return new SceneView(group);
}

describe('the cut planes', () => {
  test('are none until a cut is asked for', () => {
    assert.deepEqual(view().cutPlanes(), []);
  });

  test('a vertical cut along X keeps the near half and goes through the middle', () => {
    const scene = view();
    press('v', scene);
    assert.equal(scene.state.vertical, 'x');
    const [plane] = scene.cutPlanes();
    assert.ok(plane.distanceToPoint(new Vector3(4, 1, 2)) > 0);
    assert.ok(plane.distanceToPoint(new Vector3(6, 1, 2)) < 0);
    assert.equal(key('v').badge(scene), 'Along X');
  });

  test('v cycles from X to Z to none', () => {
    const scene = view();
    press('v', scene);
    press('v', scene);
    assert.equal(scene.state.vertical, 'z');
    const [plane] = scene.cutPlanes();
    assert.ok(plane.distanceToPoint(new Vector3(5, 1, 1.5)) > 0);
    assert.ok(plane.distanceToPoint(new Vector3(5, 1, 2.5)) < 0);
    press('v', scene);
    assert.equal(scene.state.vertical, null);
    assert.equal(key('v').badge(scene), undefined);
  });

  test('a horizontal and a vertical cut work together', () => {
    const scene = view();
    scene.state.sectioned = true;
    press('v', scene);
    assert.equal(scene.cutPlanes().length, 2);
    assert.equal(scene.keeps(new Vector3(4, 1, 2)), true);
    assert.equal(scene.keeps(new Vector3(4, 2, 2)), false);
    assert.equal(scene.keeps(new Vector3(6, 1, 2)), false);
  });
});

describe('moving a cut', () => {
  test('j and k move the vertical cut when there is one', () => {
    const scene = view();
    press('v', scene);
    press('k', scene);
    press('k', scene);
    const [plane] = scene.cutPlanes();
    // The middle is x 5, moved forward by two steps.
    assert.ok(Math.abs(plane.constant - (5 + 2 * CUT_STEP_M)) < 1e-9);
    press('j', scene);
    assert.ok(Math.abs(scene.state.depthShift - CUT_STEP_M) < 1e-9);
  });

  test('and the horizontal one otherwise', () => {
    const scene = view();
    scene.state.sectioned = true;
    press('k', scene);
    assert.ok(Math.abs(scene.cutHeight() - (CUT_M + CUT_STEP_M)) < 1e-9);
  });

  test('do nothing with no cut in force', () => {
    const scene = view();
    press('k', scene);
    assert.deepEqual([scene.state.heightShift, scene.state.depthShift], [0, 0]);
  });

  test('a new vertical cut starts from the middle again, and reset takes every cut away', () => {
    const scene = view();
    press('v', scene);
    press('k', scene);
    press('v', scene);
    assert.equal(scene.state.depthShift, 0);
    scene.state.sectioned = true;
    press('k', scene);
    scene.reset();
    assert.deepEqual(scene.cutPlanes(), []);
    assert.deepEqual([scene.state.vertical, scene.state.heightShift, scene.state.depthShift], [null, 0, 0]);
  });
});

describe('what a cut hides', () => {
  test('an object whose centre is beyond a cut is not shown, and comes back without the cut', () => {
    const group = new Group();
    for (const [id, x] of [['near', 2], ['far', 8]]) {
      const mesh = new Mesh(new BoxGeometry(1, 3, 1), new MeshStandardMaterial());
      mesh.position.set(x, 1.5, 0);
      mesh.userData.globalId = id;
      group.add(mesh);
    }
    group.updateMatrixWorld(true);
    const scene = new SceneView(group);
    assert.equal(scene.isShown('far'), true);
    press('v', scene);
    assert.deepEqual([scene.isShown('near'), scene.isShown('far')], [true, false]);
    press('v', scene);
    press('v', scene);
    assert.equal(scene.isShown('far'), true);
    scene.meshes.get('near').visible = false;
    assert.equal(scene.isShown('near'), false);
    assert.equal(scene.isShown('unknown'), true);
  });
});

describe('what the plan cut keeps', () => {
  test('a wall the cut runs through stays shown, an object wholly above it does not', () => {
    const group = new Group();
    const add = (id, y, height) => {
      const mesh = new Mesh(new BoxGeometry(1, height, 1), new MeshStandardMaterial());
      mesh.position.set(0, y + height / 2, 0);
      mesh.userData.globalId = id;
      mesh.userData.ifcClass = id === 'wall' ? 'IfcWall' : 'IfcBeam';
      group.add(mesh);
    };
    add('wall', 0, 2.7);
    add('beam', 2.4, 0.3);
    group.updateMatrixWorld(true);
    const scene = new SceneView(group);
    scene.state.sectioned = true;
    assert.deepEqual([scene.isShown('wall'), scene.isShown('beam')], [true, false]);
  });
});

describe('createSection with planes', () => {
  test('puts every plane on the renderer and takes them away with an empty list', () => {
    const renderer = { clippingPlanes: [] };
    const section = createSection(renderer);
    const scene = view();
    scene.state.sectioned = true;
    press('v', scene);
    section.setPlanes(scene.cutPlanes());
    assert.equal(renderer.clippingPlanes.length, 2);
    section.setPlanes([]);
    assert.deepEqual(renderer.clippingPlanes, []);
  });
});
