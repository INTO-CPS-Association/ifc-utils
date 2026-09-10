/**
 * Tests for how old a reading is and what it averages to.
 *
 * A stale number shown as current is worse than no number, so most of these
 * are about the moment a value stops counting: the connection dropping, the
 * messages stopping, and the colouring going with them.
 *
 * Time is passed in instead of read, so a test can be at a moment instead of
 * waiting for one.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ageOf, ageText, isLive, zoneOf, zonesOf, availableScopes, DEFAULT_STALE_AFTER_S,
} from '../dist/esm/index.js';

const NOW = 1_800_000_000_000;
const seconds = (n) => ({ value: 20, receivedAt: NOW - n * 1000 });

function binding(globalId, ramp = [4, 16]) {
  return {
    selector: { globalId },
    label: globalId,
    source: { live: { transport: 'mqtt', topic: `t/${globalId}` } },
    display: { unit: '°C', ramp },
  };
}

test('a reading that never arrived has no age', () => {
  assert.equal(ageOf(undefined, NOW), null);
  assert.equal(ageText(undefined, 'live', DEFAULT_STALE_AFTER_S, NOW), 'no message yet');
});

test('a recent reading on a live feed is current', () => {
  assert.equal(isLive(seconds(5), 'live', DEFAULT_STALE_AFTER_S, NOW), true);
});

test('a recent reading on a dead feed is not current', () => {
  // A number nobody can date is worse than no number.
  assert.equal(isLive(seconds(1), 'down', DEFAULT_STALE_AFTER_S, NOW), false);
});

test('an old reading on a live feed is not current', () => {
  assert.equal(isLive(seconds(DEFAULT_STALE_AFTER_S + 1), 'live', DEFAULT_STALE_AFTER_S, NOW), false);
});

test('the boundary counts as current, one second past it does not', () => {
  assert.equal(isLive(seconds(DEFAULT_STALE_AFTER_S), 'live', DEFAULT_STALE_AFTER_S, NOW), true);
  assert.equal(isLive(seconds(DEFAULT_STALE_AFTER_S + 0.1), 'live', DEFAULT_STALE_AFTER_S, NOW), false);
});

test('age reads in seconds while it is short and in minutes once it is not', () => {
  assert.equal(ageText(seconds(5), 'live', DEFAULT_STALE_AFTER_S, NOW), 'updated 5 s ago');
  assert.match(ageText(seconds(600), 'down', DEFAULT_STALE_AFTER_S, NOW), /^last message 10 min ago/);
});

test('a stale reading says so instead of looking updated', () => {
  assert.match(ageText(seconds(120), 'live', DEFAULT_STALE_AFTER_S, NOW), /not live$/);
});

describe('the scopes worth offering', () => {
  const where = {
    a: { room: 'R1', storey: 'L1' },
    b: { room: 'R2', storey: 'L2' },
    c: { room: 'R1', storey: 'L1' },
  };
  const at = (id) => where[id];
  const bind = (id) => ({
    selector: { globalId: id },
    label: id,
    source: { live: { transport: 'mqtt', topic: `t/${id}` } },
    display: { unit: 'C', ramp: [0, 1] },
  });

  test('offers a scope that puts the sensors in more than one group', () => {
    assert.deepEqual(availableScopes([bind('a'), bind('b')], at),
      ['off', 'room', 'storey', 'building']);
  });

  test('skips a scope that puts every sensor in the same group', () => {
    // The case this got wrong: a model declaring ten storeys with all ten of
    // its sensors on one of them can be grouped by storey and gains nothing.
    assert.deepEqual(availableScopes([bind('a'), bind('c')], at), ['off', 'building']);
  });

  test('offers off and building whatever the readings look like', () => {
    // One group is what Building means, instead of a failure of it.
    assert.deepEqual(availableScopes([], at), ['off', 'building']);
  });

  test('ignores a sensor the model knows nothing about', () => {
    assert.deepEqual(availableScopes([bind('a'), bind('unknown')], at), ['off', 'building']);
  });
});

test('every object is in the building, whatever else it is in', () => {
  assert.equal(zoneOf('building', undefined), 'building');
  assert.equal(zoneOf('room', { storey: 'L1' }), undefined);
  assert.equal(zoneOf('storey', { storey: 'L1' }), 'L1');
});

test('several sensors in one zone average', () => {
  // That is what a zone reading is.
  const readings = new Map([['a', { value: 10, receivedAt: NOW }],
    ['b', { value: 20, receivedAt: NOW }]]);
  const zones = zonesOf([binding('a'), binding('b')], readings, 'storey',
    () => ({ storey: 'L1' }), 'live', DEFAULT_STALE_AFTER_S, NOW);

  assert.equal(zones.meanByZone.get('L1'), 15);
  assert.equal(zones.counted, 2);
});

test('the range comes from the manifest, not from the readings', () => {
  // A range that rescaled itself would make a steady building look like a
  // changing one.
  const readings = new Map([['a', { value: 100, receivedAt: NOW }]]);
  const zones = zonesOf([binding('a', [4, 16])], readings, 'building',
    () => ({}), 'live', DEFAULT_STALE_AFTER_S, NOW);

  assert.equal(zones.low, 4);
  assert.equal(zones.high, 16);
});

test('nothing current means no zones at all', () => {
  // This is what makes the colouring disappear when a broker stops, instead
  // of freeze on its last values.
  const readings = new Map([['a', seconds(600)]]);

  assert.equal(zonesOf([binding('a')], readings, 'building', () => ({}),
    'live', DEFAULT_STALE_AFTER_S, NOW), null);
  assert.equal(zonesOf([binding('a')], new Map([['a', seconds(1)]]), 'building',
    () => ({}), 'down', DEFAULT_STALE_AFTER_S, NOW), null);
});

test('the off scope produces nothing without looking at any reading', () => {
  assert.equal(zonesOf([binding('a')], new Map([['a', seconds(1)]]), 'off',
    () => ({}), 'live', DEFAULT_STALE_AFTER_S, NOW), null);
});

test('a sensor whose object is in no zone is left out instead of guessed', () => {
  const readings = new Map([['a', { value: 10, receivedAt: NOW }],
    ['b', { value: 30, receivedAt: NOW }]]);
  const zones = zonesOf([binding('a'), binding('b')], readings, 'room',
    (id) => (id === 'a' ? { room: 'R1' } : {}), 'live', DEFAULT_STALE_AFTER_S, NOW);

  assert.equal(zones.counted, 1);
  assert.equal(zones.meanByZone.get('R1'), 10);
});
