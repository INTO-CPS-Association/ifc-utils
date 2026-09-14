/**
 * Tests for reading a binding, and for the colour ramp.
 *
 * They run against `dist/`, not against `src/`, so what is checked is what is
 * published. A test that passes on the source and fails on the artifact is a
 * test that did not do its job.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { objectOf, topicOf, displayOf, idOf, rampColour, RAMP_STOPS }
  from '../dist/esm/index.js';

/** A binding as `ifc_explorer.manifest` writes it. */
const FULL = {
  selector: { globalId: '0_sgz7bzz4Jh2ckU1ehFe$' },
  label: 'HX-1 temperature TS-01',
  source: {
    live: { transport: 'mqtt', topic: 'swim/DemoBuilding/B1/temperature/TS-01' },
    history: { bucket: 'swim', measurement: 'temperature' },
  },
  display: { unit: '°C', ramp: [4, 16] },
  id: 'TS-01',
};

test('reads the object, the topic and the display from where the file puts them', () => {
  assert.equal(objectOf(FULL), '0_sgz7bzz4Jh2ckU1ehFe$');
  assert.equal(topicOf(FULL), 'swim/DemoBuilding/B1/temperature/TS-01');
  assert.deepEqual(displayOf(FULL), { unit: '°C', ramp: [4, 16] });
  assert.equal(idOf(FULL), 'TS-01');
});

test('a binding with only history has no topic, instead of throwing', () => {
  // Legal: it exists for the panel behind a click and never reaches a marker.
  const historyOnly = { ...FULL, source: { history: FULL.source.history } };
  assert.equal(topicOf(historyOnly), undefined);
});

test('a selector that is not a GlobalId gives no object', () => {
  assert.equal(objectOf({ ...FULL, selector: { nodeName: 'Wall-12' } }), undefined);
});

test('the label stands in when a manifest carries no id of ours', () => {
  // `id` is this project's addition, so a manifest from elsewhere lacks it.
  const { id: _dropped, ...theirs } = FULL;
  assert.equal(idOf(theirs), 'HX-1 temperature TS-01');
});

test('display is an object even when the binding has none', () => {
  // So a caller can read `.unit` without guarding first.
  assert.deepEqual(displayOf({ ...FULL, display: undefined }), {});
});

test('the ramp runs cold, light, warm across its range', () => {
  assert.equal(rampColour(4, 4, 16), RAMP_STOPS.cold);
  assert.equal(rampColour(10, 4, 16), RAMP_STOPS.middle);
  assert.equal(rampColour(16, 4, 16), RAMP_STOPS.warm);
});

test('a value outside the range is clamped, not extrapolated', () => {
  // An implausible reading should look like the end of the scale, not like a
  // colour the legend never showed.
  assert.equal(rampColour(-50, 4, 16), RAMP_STOPS.cold);
  assert.equal(rampColour(500, 4, 16), RAMP_STOPS.warm);
});

test('a range of no width does not divide by zero', () => {
  assert.equal(typeof rampColour(7, 7, 7), 'number');
});

test('every colour is a 24 bit number', () => {
  for (let v = 0; v <= 20; v += 1) {
    const colour = rampColour(v, 4, 16);
    assert.ok(colour >= 0 && colour <= 0xffffff, `${v} gave ${colour}`);
  }
});
