/**
 * Tests for the selection halo.
 *
 * The two that matter are the ones a bug would be silent about: a halo that
 * grows by a scale factor swallows a wall, and a halo that disposes the
 * geometry it borrowed deletes the model.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { createGlow, GLOW_MARGIN_M } from '../dist/esm/viewer/index.js';

/** A box of the given size at the origin, with its world matrix current. */
function object(size) {
  const mesh = new Mesh(new BoxGeometry(...size), new MeshStandardMaterial());
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** The one mesh the glow added to the scene. */
const haloOf = (scene) => scene.children[scene.children.length - 1];

describe('createGlow', () => {
  test('adds nothing visible until something is selected', () => {
    const scene = new Group();
    createGlow(scene);

    assert.equal(haloOf(scene).visible, false);
  });

  test('a small sensor gains the margin on every side', () => {
    // 85 mm is the thermostat this was written for. A scale factor tuned for
    // a wall leaves it a speck, which is the bug being prevented.
    const scene = new Group();
    const glow = createGlow(scene);
    const sensor = object([0.085, 0.085, 0.025]);

    glow.show(sensor);
    const halo = haloOf(scene);
    const scale = new Vector3().setFromMatrixScale(halo.matrix);

    assert.equal(halo.visible, true);
    // The geometry is stored as 32 bit floats, so the grown size lands within
    // a rounding error of the margin instead of exactly on it.
    assert.ok(Math.abs(0.085 * scale.x - (0.085 + 2 * GLOW_MARGIN_M)) < 1e-6);
  });

  test('a wall does not become a second wall', () => {
    const scene = new Group();
    const glow = createGlow(scene);

    glow.show(object([6, 3, 0.3]));
    const scale = new Vector3().setFromMatrixScale(haloOf(scene).matrix);

    assert.ok(scale.x < 1.1, `a wall grew by ${scale.x}`);
  });

  test('a degenerate object does not divide by zero', () => {
    const scene = new Group();
    const glow = createGlow(scene);

    glow.show(object([0, 0, 0]));
    const scale = new Vector3().setFromMatrixScale(haloOf(scene).matrix);

    assert.ok(Number.isFinite(scale.x));
  });

  test('hiding gives the borrowed geometry back instead of keeping it', () => {
    const scene = new Group();
    const glow = createGlow(scene);
    const sensor = object([0.085, 0.085, 0.025]);

    glow.show(sensor);
    glow.hide();

    assert.equal(haloOf(scene).visible, false);
    assert.notEqual(haloOf(scene).geometry, sensor.geometry);
  });

  test('disposing leaves the selected object its geometry', () => {
    // The halo never copies geometry, so disposing the wrong one here would
    // delete a mesh of the building.
    const scene = new Group();
    const glow = createGlow(scene);
    const sensor = object([0.085, 0.085, 0.025]);

    glow.show(sensor);
    glow.dispose();

    assert.ok(sensor.geometry.getAttribute('position').count > 0);
    assert.equal(scene.children.length, 0);
  });
});
