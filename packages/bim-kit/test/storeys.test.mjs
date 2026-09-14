/**
 * Tests for working out where the floors of a building are.
 *
 * The cases here are the real ones that made this necessary: a model that
 * names one floor several times, a model whose storeys are listed in an order
 * that does not match their height, and a storey with one object hanging below
 * the slab.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bandsFrom, bandOf, MERGE_WITHIN_M, FLOOR_MARGIN_M } from '../dist/esm/index.js';

/** Objects sitting flat on one floor. */
function floor(storey, base, count = 8) {
  return Array.from({ length: count }, () => ({ storey, base }));
}

test('one band per storey, lowest first', () => {
  const bands = bandsFrom(['L1', 'L2', 'L3'],
    [...floor('L1', 0), ...floor('L2', 3.2), ...floor('L3', 6.4)]);

  assert.equal(bands.length, 3);
  assert.deepEqual(bands.map((b) => b.names), [['L1'], ['L2'], ['L3']]);
});

test('a band reaches the floor above it', () => {
  const bands = bandsFrom(['L1', 'L2'], [...floor('L1', 0), ...floor('L2', 3.2)]);

  assert.equal(bands[0].to, 3.2);
  // A little below the measured floor, so the slab a person stands on is in
  // the band instead of cut away with the floor below.
  assert.equal(bands[0].from, -FLOOR_MARGIN_M);
});

test('the topmost floor gets the height the others have', () => {
  // Taken from the building instead of assumed, so a plant room and an office
  // block both get a sensible one.
  const bands = bandsFrom(['L1', 'L2', 'L3'],
    [...floor('L1', 0), ...floor('L2', 4), ...floor('L3', 8)]);

  assert.equal(bands[2].to, 12);
});

test('storeys within half a metre become one floor, keeping every name', () => {
  // 2116_FEAS_kedelhuset declares twenty six storeys and four of them sit
  // within twenty centimetres. As separate bands they show almost nothing.
  const bands = bandsFrom(['A', 'B', 'C', 'D'],
    [...floor('A', 0), ...floor('B', 0.07), ...floor('C', 0.18), ...floor('D', 3.2)]);

  assert.equal(bands.length, 2);
  assert.deepEqual(bands[0].names, ['A', 'B', 'C']);
  assert.deepEqual(bands[1].names, ['D']);
});

test('choosing any name of a merged floor finds the same band', () => {
  const bands = bandsFrom(['A', 'B'], [...floor('A', 0), ...floor('B', 0.1)]);

  assert.equal(bandOf(bands, 'A'), bandOf(bands, 'B'));
});

test('a floor just beyond the merge distance stays its own', () => {
  const bands = bandsFrom(['A', 'B'],
    [...floor('A', 0), ...floor('B', MERGE_WITHIN_M + 0.01)]);

  assert.equal(bands.length, 2);
});

test('order comes from measured height, not from how the model lists them', () => {
  // The Molecular Biology model lists its storeys in an order that does not
  // match where they are.
  const bands = bandsFrom(['Roof', 'Ground', 'First'],
    [...floor('Roof', 9), ...floor('Ground', 0), ...floor('First', 4.5)]);

  assert.deepEqual(bands.map((b) => b.names[0]), ['Ground', 'First', 'Roof']);
});

test('one object hanging below the slab does not set the floor', () => {
  // The lower quartile instead of the minimum, for exactly this.
  const bands = bandsFrom(['L1'], [{ storey: 'L1', base: -4 }, ...floor('L1', 0)]);

  assert.equal(bands[0].from, -FLOOR_MARGIN_M);
});

test('a storey the model declares but fills with nothing gets no band', () => {
  const bands = bandsFrom(['L1', 'Empty', 'L2'],
    [...floor('L1', 0), ...floor('L2', 3)]);

  assert.equal(bands.length, 2);
});

test('a model with no storeys gets no bands instead of an invented floor', () => {
  // A bridge, a road and a railway declare none at all.
  assert.deepEqual(bandsFrom([], []), []);
  assert.deepEqual(bandsFrom(['L1'], []), []);
});

test('an object with no finite base is ignored instead of poisoning the floor', () => {
  const bands = bandsFrom(['L1'],
    [{ storey: 'L1', base: Number.NaN }, { storey: 'L1', base: Infinity }, ...floor('L1', 2)]);

  assert.equal(bands.length, 1);
  assert.equal(bands[0].from, 2 - FLOOR_MARGIN_M);
});

test('an unknown storey name has no band', () => {
  const bands = bandsFrom(['L1'], floor('L1', 0));

  assert.equal(bandOf(bands, 'Basement'), undefined);
});
