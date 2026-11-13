/**
 * Tests for walking through the building at eye height with the arrow keys.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from 'three';
import {
  EYE_HEIGHT_M, LOOK_AHEAD_M, SHORTCUTS, SceneView, TURN_SPEED_DEG_S, WALK_SPEED_M_S,
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
