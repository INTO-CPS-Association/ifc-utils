/**
 * Tests for the walking field.
 *
 * A plan is built out of boxes, so a room is a rectangle of walls and a door is a gap punched in one. What matters is that the field stops where a person would have to stop, so every test here is about a wall separating two things that a straight line would not.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { buildField, sourceAt, planAngle, CELL_M } from '../dist/esm/viewer/index.js';
import { walkOwners } from '../dist/esm/viewer/walk.js';

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

/**
 * The same two rooms turned about the vertical by `angle`, around the origin.
 *
 * An IFC model is often placed at an angle like this, and the grid along the
 * world axes drew its regions on a slant.
 */
function turned(plan, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (const mesh of plan) {
    const { x, z } = mesh.position;
    mesh.position.x = x * cos - z * sin;
    mesh.position.z = x * sin + z * cos;
    mesh.rotation.y = -angle;
    mesh.updateMatrixWorld(true);
  }
  return plan;
}

/** A point of the unturned plan, turned the same way. */
function turnedPoint(angle, x, z) {
  return [x * Math.cos(angle) - z * Math.sin(angle), x * Math.sin(angle) + z * Math.cos(angle)];
}

const ANGLE = Math.PI / 6;

describe('a plan at an angle to the world axes', () => {
  test('the walls of an orthogonal plan run along the world axes', () => {
    assert.ok(Math.abs(planAngle(twoRooms())) < 1e-9);
  });

  test('the angle of a turned plan is measured from its walls', () => {
    const angle = planAngle(turned(twoRooms(), ANGLE));

    assert.ok(Math.abs(angle - ANGLE) < 1e-6, `measured ${angle}`);
  });

  test('a wall between two turned rooms still stops the field', () => {
    const [lx, lz] = turnedPoint(ANGLE, 5, 5);
    const [rx, rz] = turnedPoint(ANGLE, 15, 5);
    const field = buildField(turned(twoRooms(), ANGLE), [new Vector3(lx, 1.2, lz)], 0);

    assert.equal(sourceAt(field, lx, lz), 0);
    assert.equal(sourceAt(field, rx, rz), -1);
  });

  test('a door in a turned plan lets it through', () => {
    const [lx, lz] = turnedPoint(ANGLE, 5, 5);
    const [rx, rz] = turnedPoint(ANGLE, 15, 5);
    const field = buildField(turned(twoRooms({ door: true }), ANGLE), [new Vector3(lx, 1.2, lz)], 0);

    assert.equal(sourceAt(field, rx, rz), 0);
  });

  test('each turned room is owned by its own sensor, up to its walls', () => {
    // The skew showed most near the walls, so the points are 0.5 m from them.
    const plan = turned(twoRooms(), ANGLE);
    const sensors = [turnedPoint(ANGLE, 5, 5), turnedPoint(ANGLE, 15, 5)];
    const field = buildField(plan, sensors.map(([x, z]) => new Vector3(x, 1.2, z)), 0);

    for (const [x, z, owner] of [[9.5, 0.5, 0], [9.5, 9.5, 0], [10.5, 0.5, 1], [10.5, 9.5, 1]]) {
      assert.equal(sourceAt(field, ...turnedPoint(ANGLE, x, z)), owner, `at ${x}, ${z}`);
    }
  });
});

describe('the walk in open space', () => {
  /** An open room of the given size, walls only. */
  function room(w, d) {
    return [
      box('IfcWall', [w / 2, 0, -0.1], [w + 0.4, 3, 0.2]),
      box('IfcWall', [w / 2, 0, d + 0.1], [w + 0.4, 3, 0.2]),
      box('IfcWall', [-0.1, 0, d / 2], [0.2, 3, d]),
      box('IfcWall', [w + 0.1, 0, d / 2], [0.2, 3, d]),
    ];
  }

  test('each cell goes to the nearest sensor in a straight line', () => {
    // A walk along rows and columns only split open rooms along 45-degree
    // lines and gave about one cell in twenty to the wrong sensor.
    const sensors = [new Vector3(3, 1.2, 3), new Vector3(16, 1.2, 4), new Vector3(9, 1.2, 10)];
    const field = buildField(room(20, 12), sensors, 0);
    let wrong = 0;
    let total = 0;
    for (let x = 0.5; x < 20; x += 0.5) {
      for (let z = 0.5; z < 12; z += 0.5) {
        const distances = sensors.map((s) => Math.hypot(s.x - x, s.z - z));
        const nearest = distances.indexOf(Math.min(...distances));
        const owner = sourceAt(field, x, z);
        total += 1;
        // A cell on the dividing line can go either way.
        if (owner !== nearest && distances[owner] - distances[nearest] > CELL_M) wrong += 1;
      }
    }
    assert.ok(wrong / total < 0.01, `${wrong} of ${total} points went to a farther sensor`);
  });
});

describe('walkOwners', () => {
  test('a diagonal step does not slip between walls that touch at a corner', () => {
    // 3 by 3 cells, the two cells beside the corner blocked.
    const blocked = new Uint8Array([0, 1, 0, 1, 0, 0, 0, 0, 0]);
    const owner = walkOwners(blocked, 3, 3, [{ cell: 0, source: 0, distance: 0 }]);

    assert.equal(owner[4], -1);
  });

  test('a nearer seed wins a cell even when it is seeded later', () => {
    // Two sources seed the same cell. The one listed second is nearer, so the
    // cell and everything reached through it are its own.
    const blocked = new Uint8Array(3);
    const owner = walkOwners(blocked, 3, 1, [
      { cell: 1, source: 0, distance: 2 },
      { cell: 1, source: 1, distance: 0.5 },
    ]);

    assert.deepEqual([...owner], [1, 1, 1]);
  });
});
