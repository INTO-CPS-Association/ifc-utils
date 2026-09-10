/**
 * Tests for the converter, against real IFC files.
 *
 * A synthetic file proves nothing here: the whole difficulty of IFC conversion
 * is what real exporters produce.
 *
 * The files come from `fixtures/` at the top of the repository rather than
 * from beside these tests, because the Python converter runs against exactly
 * the same three. Two implementations of one job are only comparable if they
 * are asked the same questions, and a copy of a fixture is a question that
 * drifts.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { convertIfc } from '../dist/index.js';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

function fixture(name) {
  const path = `${FIXTURES}${name}`;
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
}

function extent(objects) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const object of objects) {
    for (let i = 0; i < object.positions.length; i += 3) {
      for (let a = 0; a < 3; a += 1) {
        const v = object.positions[i + a];
        if (v < lo[a]) lo[a] = v;
        if (v > hi[a]) hi[a] = v;
      }
    }
  }
  return hi.map((h, i) => h - lo[i]);
}

describe('a wall the geometry kernel leaves in its own units', () => {
  const bytes = fixture('wall_kernel_keeps_units.ifc');

  test('comes out three metres long, not three thousand', { skip: !bytes }, async () => {
    // The unit trap. This file declares millimetres, and a converter that
    // hands the numbers on unchanged produces a three kilometre wall.
    const { objects } = await convertIfc(bytes);
    const [x, y, z] = extent(objects);

    assert.ok(Math.max(x, y, z) < 10, `largest side was ${Math.max(x, y, z)}`);
    assert.ok(Math.max(x, y, z) > 2, `largest side was ${Math.max(x, y, z)}`);
  });
});

describe('a column authored in inches', () => {
  const bytes = fixture('column_in_inches.ifc');

  test('comes out about three metres tall', { skip: !bytes }, async () => {
    // Not every file is metric. Ten feet is 3.048 metres.
    const { objects } = await convertIfc(bytes);

    assert.ok(Math.max(...extent(objects)) > 3, 'the column should be about 3 m');
    assert.ok(Math.max(...extent(objects)) < 3.2, 'the column should be about 3 m');
  });
});

describe('which way is up', () => {
  const bytes = fixture('column_in_inches.ifc');

  test('a column stands along Y, because glTF is Y up', { skip: !bytes }, async () => {
    // The orientation trap, and the reason this test exists. web-ifc's flat
    // transformation already returns a Y-up world, so a converter that turns
    // it again for the Z-up to Y-up change lays the model on its side. Every
    // other test here still passes, because a rotation changes no distance.
    // Asking which axis a tall object is tall along is what catches it: with
    // the extra turn this column measures 0.20 by 0.20 by 3.05 instead.
    const { objects } = await convertIfc(bytes);
    const [x, y, z] = extent(objects);

    assert.ok(y > x && y > z, `a column should be tallest along Y, got x ${x}, y ${y}, z ${z}`);
  });
});

describe('a basin, one object at the origin', () => {
  const bytes = fixture('basin_at_the_origin.ifc');

  test('comes out about sixty centimetres across', { skip: !bytes }, async () => {
    const { objects } = await convertIfc(bytes);

    assert.ok(Math.max(...extent(objects)) < 1, 'a basin is under a metre');
    assert.ok(Math.max(...extent(objects)) > 0.3, 'a basin is over thirty centimetres');
  });

  test('every object it returns carries a GlobalId', { skip: !bytes }, async () => {
    // Binding is the whole purpose, so an object without one is useless and is
    // counted as failed rather than returned.
    const { objects } = await convertIfc(bytes);

    for (const object of objects) {
      assert.match(object.globalId, /^[0-9A-Za-z_$]{22}$/);
    }
  });

  test('reports the schema the file declares', { skip: !bytes }, async () => {
    assert.match((await convertIfc(bytes)).schema, /^IFC/);
  });

  test('names the IFC class of each object', { skip: !bytes }, async () => {
    const { objects } = await convertIfc(bytes);

    for (const object of objects) assert.match(object.ifcClass, /^Ifc/);
  });

  test('gives indices that address the vertices it returns', { skip: !bytes }, async () => {
    // An index past the end draws nothing and reports nothing, so it is worth
    // one assertion.
    const { objects } = await convertIfc(bytes);

    for (const object of objects) {
      const vertices = object.positions.length / 3;
      assert.equal(object.normals.length, object.positions.length);
      for (const index of object.indices) assert.ok(index < vertices);
    }
  });
});
