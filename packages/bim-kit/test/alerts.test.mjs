/**
 * Tests for what a sensor card warns about.
 *
 * The bounds come from the manifest and the kind comes from the payload, so
 * most of these are about not inventing either: a sensor with no declared
 * range cannot be out of range, and a value nobody dated is not an excursion.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { alertsOf, alertCounts, MEASURED_KIND } from '../dist/esm/index.js';

const NOW = 1_800_000_000_000;

const binding = {
  selector: { globalId: 'ts01' },
  label: 'TS-01 room temperature',
  id: 'TS-01',
  source: { live: { transport: 'mqtt', topic: 't/ts01' } },
  display: { unit: 'C', ramp: [10, 50] },
};

/** A reading that arrived just now, so it is live unless a test ages it. */
const reading = (value, extra = {}) => ({
  value, receivedAt: NOW, unit: 'C', ...extra,
});

const labels = (alerts) => alerts.map((alert) => alert.label);

describe('a sensor that is not speaking', () => {
  test('says so when no message has ever arrived', () => {
    const alerts = alertsOf(binding, undefined, 'live', 30, NOW);

    assert.deepEqual(labels(alerts), ['Never Reported']);
    assert.equal(alerts[0].level, 'warn');
  });

  test('says so when the last message is older than the stale window', () => {
    const old = { ...reading(21), receivedAt: NOW - 120_000 };

    assert.deepEqual(labels(alertsOf(binding, old, 'live', 30, NOW)), ['Not Reporting']);
  });

  test('says so when the broker is down, however recent the value', () => {
    assert.deepEqual(labels(alertsOf(binding, reading(21), 'down', 30, NOW)), ['Not Reporting']);
  });

  test('a live reading inside its range raises nothing', () => {
    assert.deepEqual(alertsOf(binding, reading(21), 'live', 30, NOW), []);
  });
});

describe('the declared range', () => {
  test('a value above the high bound is an alert naming the bounds', () => {
    const alerts = alertsOf(binding, reading(92), 'live', 30, NOW);

    assert.deepEqual(labels(alerts), ['Above Range']);
    assert.match(alerts[0].detail, /10 to 50 C/);
  });

  test('a value below the low bound is an alert', () => {
    assert.deepEqual(labels(alertsOf(binding, reading(-4), 'live', 30, NOW)), ['Below Range']);
  });

  test('the bounds themselves are inside the range', () => {
    assert.deepEqual(alertsOf(binding, reading(10), 'live', 30, NOW), []);
    assert.deepEqual(alertsOf(binding, reading(50), 'live', 30, NOW), []);
  });

  test('a sensor whose manifest declares no ramp cannot be out of range', () => {
    const noRamp = { ...binding, display: { unit: 'C' } };

    assert.deepEqual(alertsOf(noRamp, reading(999), 'live', 30, NOW), []);
  });

  test('a stale value is reported as silence and not as an excursion', () => {
    // Both at once reads as a live alarm on a sensor that is not reporting,
    // which is the opposite of what is happening.
    const old = { ...reading(92), receivedAt: NOW - 120_000 };

    assert.deepEqual(labels(alertsOf(binding, old, 'live', 30, NOW)), ['Not Reporting']);
  });
});

describe('a unit the payload disagrees with', () => {
  test('is named, with both units', () => {
    const alerts = alertsOf(binding, reading(21, { unit: 'F' }), 'live', 30, NOW);

    assert.deepEqual(labels(alerts), ['Unit Differs']);
    assert.match(alerts[0].detail, /F.*C|C.*F/);
  });

  test('a payload that declares no unit is not a disagreement', () => {
    const noUnit = { value: 21, receivedAt: NOW };

    assert.deepEqual(alertsOf(binding, noUnit, 'live', 30, NOW), []);
  });
});

describe('a value that was not measured', () => {
  test('a sample raises nothing, since that is a reading off the instrument', () => {
    const alerts = alertsOf(binding, reading(21, { kind: MEASURED_KIND }), 'live', 30, NOW);

    assert.deepEqual(alerts, []);
  });

  test('any other kind is noted, with the word the payload used', () => {
    const alerts = alertsOf(binding, reading(21, { kind: 'prediction' }), 'live', 30, NOW);

    assert.deepEqual(labels(alerts), ['Prediction']);
    assert.equal(alerts[0].level, 'note');
    assert.match(alerts[0].detail, /prediction/);
  });

  test('a kind nobody has defined yet still shows, instead of falling into other', () => {
    // A publisher that starts sending a new kind should show that kind. A
    // vocabulary fixed here would hide it.
    const alerts = alertsOf(binding, reading(21, { kind: 'simulation' }), 'live', 30, NOW);

    assert.deepEqual(labels(alerts), ['Simulation']);
  });

  test('a payload with no kind says nothing about how the value was produced', () => {
    assert.deepEqual(alertsOf(binding, reading(21), 'live', 30, NOW), []);
  });
});

describe('alertCounts', () => {
  const objectOf = (b) => b.selector.globalId;
  const second = { ...binding, selector: { globalId: 'ts02' }, id: 'TS-02' };

  test('counts a sensor once, however many alerts it carries', () => {
    const readings = new Map([['ts01', reading(92, { unit: 'F', kind: 'prediction' })]]);
    const counts = alertCounts([binding], readings, objectOf, 'live', 30, NOW);

    assert.deepEqual(counts, { warn: 1, note: 0 });
  });

  test('a note only counts as a note when nothing worse applies', () => {
    const readings = new Map([
      ['ts01', reading(21, { kind: 'prediction' })],
      ['ts02', reading(92)],
    ]);
    const counts = alertCounts([binding, second], readings, objectOf, 'live', 30, NOW);

    assert.deepEqual(counts, { warn: 1, note: 1 });
  });

  test('every sensor healthy counts nothing', () => {
    const readings = new Map([['ts01', reading(21)], ['ts02', reading(22)]]);

    assert.deepEqual(
      alertCounts([binding, second], readings, objectOf, 'live', 30, NOW),
      { warn: 0, note: 0 },
    );
  });

  test('no bindings counts nothing instead of throwing', () => {
    assert.deepEqual(
      alertCounts([], new Map(), objectOf, 'live', 30, NOW),
      { warn: 0, note: 0 },
    );
  });
});
