/**
 * Tests for the walking field.
 *
 * A plan is built out of boxes, so a room is a rectangle of walls and a door is a gap punched in one. What matters is that the field stops where a person would have to stop, so every test here is about a wall separating two things that a straight line would not.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { buildField, sourceAt, CELL_M } from '../dist/esm/viewer/index.js';

/** A box of the given size, centred on the given point, of the given IFC class. */
function box(ifcClass, [x, y, z], [w, h, d]) {
  const mesh = new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial());
  mesh.position.set(x, y + h / 2, z);
  mesh.userData.ifcClass = ifcClass;
  mesh.updateMatrixWorld(true);
  return mesh;
}

/**
 * Two rooms side by side, ten metres each, with a wall between them.
 *
 * The floor is at zero and every wall is three metres tall, so the cut at
 * 1.2 m passes through all of them.
 */
function twoRooms({ door = false } = {}) {
  const walls = [
    box('IfcSlab', [10, -0.2, 5], [20.4, 0.2, 10.4]),
    box('IfcWall', [10, 0, -0.1], [20.4, 3, 0.2]),
    box('IfcWall', [10, 0, 10.1], [20.4, 3, 0.2]),
    box('IfcWall', [-0.1, 0, 5], [0.2, 3, 10]),
    box('IfcWall', [20.1, 0, 5], [0.2, 3, 10]),
    // The one that separates them.
    box('IfcWall', [10, 0, 5], [0.2, 3, 10]),
  ];
  if (door) walls.push(box('IfcDoor', [10, 0, 5], [0.4, 2.1, 1]));
  return walls;
}

const inLeft = new Vector3(5, 1.2, 5);
const inRight = new Vector3(15, 1.2, 5);

describe('buildField', () => {
  test('a wall between two rooms stops the field', () => {
    // The whole point. A straight line from the left sensor reaches the right
    // room in ten metres and a person cannot.
    const field = buildField(twoRooms(), [inLeft, inRight], 0);

    assert.equal(sourceAt(field, 5, 5), 0);
    assert.equal(sourceAt(field, 15, 5), 1);
  });

  test('one sensor does not reach through the wall into the other room', () => {
    const field = buildField(twoRooms(), [inLeft], 0);

    assert.equal(sourceAt(field, 5, 5), 0);
    assert.equal(sourceAt(field, 15, 5), -1);
  });

  test('a door lets it through', () => {
    // The same plan with a doorway. One sensor now owns both rooms, which is
    // right: the two share air through the opening.
    const field = buildField(twoRooms({ door: true }), [inLeft], 0);

    assert.equal(sourceAt(field, 15, 5), 0);
  });

  test('furniture does not stop it, because air moves over a desk', () => {
    const plan = [...twoRooms(), box('IfcFurniture', [5, 0, 5], [4, 0.8, 2])];
    const field = buildField(plan, [new Vector3(2, 1.2, 5)], 0);

    assert.equal(sourceAt(field, 8, 5), 0);
  });

  test('a wall shorter than the cut does not stop it', () => {
    // A parapet at knee height is not a room boundary, and the cut at chest
    // height is what tells the two apart.
    const plan = [...twoRooms().slice(0, 5), box('IfcWall', [10, 0, 5], [0.2, 0.5, 10])];
    const field = buildField(plan, [inLeft], 0);

    assert.equal(sourceAt(field, 15, 5), 0);
  });

  test('a sensor mounted inside a wall is still in its own region', () => {
    // Where this broke first. The sensor's own cell is blocked, so the lookup
    // has to ring outward or the sensor colours nothing.
    const field = buildField(twoRooms(), [new Vector3(9.85, 1.2, 5)], 0);

    assert.notEqual(sourceAt(field, 9.85, 5), -1);
  });

  test('the grid covers the plan at the stated resolution', () => {
    const field = buildField(twoRooms(), [inLeft], 0);

    assert.equal(field.cell, CELL_M);
    assert.ok(field.nx * field.cell >= 20, `${field.nx} cells across 20 m`);
    assert.ok(field.nz * field.cell >= 10, `${field.nz} cells deep 10 m`);
  });

  test('says nothing when there is nothing to flood from or through', () => {
    // Both are ordinary: most models declare no sensors at all.
    assert.equal(buildField(twoRooms(), [], 0), null);
    assert.equal(buildField([], [inLeft], 0), null);
  });

  test('a point outside the plan belongs to nobody', () => {
    const field = buildField(twoRooms(), [inLeft], 0);

    assert.equal(sourceAt(field, -50, -50), -1);
  });
});
