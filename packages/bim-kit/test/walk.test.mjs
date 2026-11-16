/**
 * Tests for walking through the building at eye height with the arrow keys.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from 'three';
import {
  CUT_M, EYE_HEIGHT_M, LOOK_AHEAD_M, NEAR_PLANE, SHORTCUTS, SceneView, TURN_SPEED_DEG_S, WALK_SPEED_M_S,
  startWalking, stepWalk, walkKeyOf,
} from '../dist/esm/viewer/index.js';

const NONE = { forward: false, back: false, left: false, right: false };

function rig() {
  const camera = new PerspectiveCamera(45, 1, 0.01, 100);
  camera.position.set(10, 20, 10);
  const controls = { target: new Vector3(0, 0, 0), update: () => undefined };
  return { camera, controls };
}

describe('startWalking', () => {
  test('brings the near plane in, so a wall a person walks up to is not cut away', () => {
    const { camera, controls } = rig();
    camera.near = 2;
    startWalking(camera, controls, 0);
    assert.equal(camera.near, NEAR_PLANE);
  });

  test('stands at eye height on the floor, looking straight ahead the way the camera looked', () => {
    const { camera, controls } = rig();
    startWalking(camera, controls, 3);
    assert.equal(camera.position.y, 3 + EYE_HEIGHT_M);
    assert.ok(Math.abs(controls.target.y - camera.position.y) < 1e-9);
    assert.ok(Math.abs(controls.target.distanceTo(camera.position) - LOOK_AHEAD_M) < 1e-9);
    const ahead = controls.target.clone().sub(camera.position).normalize();
    assert.ok(ahead.distanceTo(new Vector3(-1, 0, -1).normalize()) < 1e-9);
  });
});

describe('stepWalk', () => {
  test('walks forward at walking pace and back again', () => {
    const { camera, controls } = rig();
    startWalking(camera, controls, 0);
    const start = camera.position.clone();
    assert.equal(stepWalk(camera, controls, { ...NONE, forward: true }, 1), true);
    assert.ok(Math.abs(camera.position.distanceTo(start) - WALK_SPEED_M_S) < 1e-9);
    assert.equal(camera.position.y, start.y);
    stepWalk(camera, controls, { ...NONE, back: true }, 1);
    assert.ok(camera.position.distanceTo(start) < 1e-9);
  });

  test('turns left and right at turning pace without moving', () => {
    const { camera, controls } = rig();
    startWalking(camera, controls, 0);
    const start = camera.position.clone();
    const before = controls.target.clone().sub(camera.position).normalize();
    stepWalk(camera, controls, { ...NONE, left: true }, 1);
    const after = controls.target.clone().sub(camera.position).normalize();
    assert.ok(camera.position.distanceTo(start) < 1e-9);
    assert.ok(Math.abs((before.angleTo(after) * 180) / Math.PI - TURN_SPEED_DEG_S) < 1e-6);
  });

  test('keeps the tilt of the head the mouse set', () => {
    const { camera, controls } = rig();
    startWalking(camera, controls, 0);
    controls.target.y += 0.2;
    stepWalk(camera, controls, { ...NONE, forward: true }, 0.5);
    assert.ok(Math.abs(controls.target.y - camera.position.y - 0.2) < 1e-9);
  });

  test('does nothing with no key held', () => {
    const { camera, controls } = rig();
    assert.equal(stepWalk(camera, controls, NONE, 1), false);
  });
});

describe('the walking keys', () => {
  test('are the four arrows and nothing else', () => {
    assert.deepEqual(
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w'].map(walkKeyOf),
      ['forward', 'back', 'left', 'right', null],
    );
  });

  test('u walks and reset stops it, and the floor is where a person stands', () => {
    const group = new Group();
    const wall = new Mesh(new BoxGeometry(1, 3, 1), new MeshStandardMaterial());
    wall.position.set(0, 1.7, 0);
    wall.userData.globalId = 'w';
    wall.userData.ifcClass = 'IfcWall';
    group.add(wall);
    group.updateMatrixWorld(true);
    const view = new SceneView(group);
    assert.ok(Math.abs(view.floorLevel() - 0.2) < 1e-9);
    const u = SHORTCUTS.find((shortcut) => shortcut.key === 'u');
    u.run({ view, refresh: () => undefined });
    assert.equal(u.on(view), true);
    view.reset();
    assert.equal(view.state.walking, false);
  });
});

describe('floorLevel', () => {
  test('is the base of the walls on the floor in view, not the underside of its slab', () => {
    const group = new Group();
    const add = (id, ifcClass, y, height) => {
      const mesh = new Mesh(new BoxGeometry(1, height, 1), new MeshStandardMaterial());
      mesh.position.set(0, y + height / 2, 0);
      mesh.userData.globalId = id;
      mesh.userData.ifcClass = ifcClass;
      group.add(mesh);
    };
    add('slab0', 'IfcSlab', -0.3, 0.3);
    add('wall0', 'IfcWall', 0, 2.7);
    add('slab1', 'IfcSlab', 2.7, 0.3);
    add('wall1', 'IfcWallStandardCase', 3.0, 2.5);
    group.updateMatrixWorld(true);
    const view = new SceneView(group, {
      storeys: [{ name: 'L0' }, { name: 'L1' }],
      objects: {
        slab0: { storey: 'L0' }, wall0: { storey: 'L0' }, slab1: { storey: 'L1' }, wall1: { storey: 'L1' },
      },
    });
    assert.ok(Math.abs(view.floorLevel() - 0) < 1e-6);
    view.state.storey = 'L1';
    assert.ok(Math.abs(view.floorLevel() - 3.0) < 1e-6);
  });

  test('holds on a model far too large for Math.min over a spread array', () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshStandardMaterial();
    const group = new Group();
    for (let i = 0; i < 200000; i += 1) {
      const mesh = new Mesh(geometry, material);
      mesh.position.set(i % 500, 1 + (i % 7), Math.floor(i / 500));
      mesh.userData.globalId = `o${i}`;
      mesh.userData.ifcClass = i % 2 ? 'IfcWall' : 'IfcSlab';
      group.add(mesh);
    }
    group.updateMatrixWorld(true);
    const view = new SceneView(group);
    // Each box has its base at 1 + (i % 7) - 0.5, and walls (odd i, such as
    // i = 7) reach i % 7 = 0, so the lowest wall stands at 0.5.
    assert.ok(Math.abs(view.floorLevel() - 0.5) < 1e-6);
    view.state.sectioned = true;
    assert.ok(Math.abs(view.cutHeight() - (0.5 + CUT_M)) < 1e-6);
  });
});
