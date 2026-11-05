/**
 * Tests for putting a model, or one object of it, in shot.
 *
 * three.js builds boxes and cameras in Node without a graphics context, so
 * the arithmetic is tested on real objects. The controls are a plain object
 * with the two members framing touches.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, PerspectiveCamera, Vector3 } from 'three';

import { frame, frameObject, MIN_FRAME_RADIUS_M, FAR_PLANE } from '../dist/esm/viewer/index.js';

/** A building 40 m across with a sensor of 5 cm at one corner. */
function building() {
  const model = new Group();
  const hall = new Mesh(new BoxGeometry(40, 10, 40));
  const sensor = new Mesh(new BoxGeometry(0.05, 0.05, 0.05));
  sensor.position.set(18, 2, 18);
  model.add(hall, sensor);
  model.updateMatrixWorld(true);
  return { model, sensor };
}

function viewer() {
  const camera = new PerspectiveCamera(45, 1.5, 0.1, 5000);
  const controls = { target: new Vector3(), updates: 0, update() { this.updates += 1; } };
  return { camera, controls };
}

test('the whole model is framed around its centre and its radius is returned', () => {
  const { model } = building();
  const { camera, controls } = viewer();
  const radius = frame(camera, controls, model);
  assert.ok(Math.abs(radius - new Vector3(40, 10, 40).length() / 2) < 1e-9);
  assert.ok(controls.target.distanceTo(new Vector3(0, 0, 0)) < 1e-9);
  assert.ok(camera.position.distanceTo(controls.target) > radius);
  assert.ok(camera.far <= FAR_PLANE);
});

test('framing the selection centres the object and keeps the direction of view', () => {
  const { model, sensor } = building();
  const { camera, controls } = viewer();
  frame(camera, controls, model, 'front');
  const before = camera.position.clone().sub(controls.target).normalize();
  assert.equal(frameObject(camera, controls, sensor, model), true);
  assert.ok(controls.target.distanceTo(new Vector3(18, 2, 18)) < 1e-9);
  const after = camera.position.clone().sub(controls.target).normalize();
  assert.ok(after.distanceTo(before) < 1e-9);
});

test('a small object is framed with the room around it, not filling the view', () => {
  const { model, sensor } = building();
  const { camera, controls } = viewer();
  frame(camera, controls, model);
  frameObject(camera, controls, sensor, model);
  const least = MIN_FRAME_RADIUS_M / Math.sin((45 * Math.PI) / 360);
  assert.ok(camera.position.distanceTo(controls.target) >= least);
});

test('framing one object keeps the far plane deep enough for the whole model', () => {
  const { model, sensor } = building();
  const { camera, controls } = viewer();
  frameObject(camera, controls, sensor, model);
  const distance = camera.position.distanceTo(controls.target);
  const across = new Vector3(40, 10, 40).length();
  assert.ok(camera.far >= distance + across - 1e-9);
});

test('an empty object moves nothing', () => {
  const { model } = building();
  const { camera, controls } = viewer();
  frame(camera, controls, model);
  const before = camera.position.clone();
  assert.equal(frameObject(camera, controls, new Group(), model), false);
  assert.ok(camera.position.equals(before));
});
