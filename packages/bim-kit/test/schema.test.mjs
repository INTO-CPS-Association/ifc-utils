/**
 * Tests for the manifest schema.
 *
 * A manifest is written by a person and will frequently be wrong, so most of
 * these are about being wrong usefully: the error has to say which binding and
 * which field, because "invalid manifest" on a file with forty bindings is not
 * something anyone can act on.
 *
 * Run against `dist/schema.js`, which is the separate entry point, so this
 * also checks that a consumer can reach the validator without the core
 * dragging zod in behind it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readManifest } from '../dist/esm/schema.js';

const GOOD = {
  model: {
    source: 'substation_ok.ifc',
    source_sha256: '60b1b94ee88a2b087080200c3c347edaf2347e768c1accb4b3608c6a129fbb09',
    converter: 'ifc_explorer.to_manifest 0.1.0',
  },
  bindings: [{
    selector: { globalId: '0_sgz7bzz4Jh2ckU1ehFe$' },
    label: 'HX-1 temperature TS-01',
    source: {
      live: { transport: 'mqtt', topic: 'swim/DemoBuilding/B1/temperature/TS-01' },
      history: { bucket: 'swim', measurement: 'temperature' },
    },
    display: { unit: '°C', ramp: [4, 16] },
  }],
};

/** The good manifest with one thing changed, so a test says what it changed. */
function withBinding(changes) {
  return { ...GOOD, bindings: [{ ...GOOD.bindings[0], ...changes }] };
}

test('accepts a manifest this project generates', () => {
  assert.equal(readManifest(GOOD).ok, true);
});

test('accepts a manifest with no bindings', () => {
  // Eight of the eleven models declare no sensors. An empty list is the honest
  // answer for those and not an error.
  assert.equal(readManifest({ ...GOOD, bindings: [] }).ok, true);
});

test('names the binding and the field when something is wrong', () => {
  const result = readManifest(withBinding({ display: { unit: '°C', ramp: [16, 4] } }));

  assert.equal(result.ok, false);
  assert.equal(result.problems[0].where, 'bindings[0].display.ramp');
  assert.match(result.problems[0].message, /low must be lower/);
});

test('reports every problem, not only the first', () => {
  const result = readManifest({
    model: GOOD.model,
    bindings: [
      { ...GOOD.bindings[0], label: '' },
      { ...GOOD.bindings[0], display: { unit: '°C', ramp: [5, 5] } },
    ],
  });

  assert.equal(result.ok, false);
  assert.ok(result.problems.length >= 2);
});

test('refuses a selector that names nothing', () => {
  const result = readManifest(withBinding({ selector: {} }));

  assert.equal(result.ok, false);
  assert.match(result.problems[0].message, /exactly one/);
});

test('refuses a selector that names two things', () => {
  // Two would leave the resolver choosing, and a manifest should not depend on
  // which it chose.
  const result = readManifest(withBinding({
    selector: { globalId: '0_sgz7bzz4Jh2ckU1ehFe$', expressId: 42 },
  }));

  assert.equal(result.ok, false);
});

test('accepts nodeName and expressId, so a non-IFC asset can reuse this', () => {
  assert.equal(readManifest(withBinding({ selector: { nodeName: 'Wall-12' } })).ok, true);
  assert.equal(readManifest(withBinding({ selector: { expressId: 1234 } })).ok, true);
});

test('refuses a GlobalId of the wrong length', () => {
  const result = readManifest(withBinding({ selector: { globalId: 'tooshort' } }));

  assert.equal(result.ok, false);
  assert.match(result.problems[0].message, /22 characters/);
});

test('refuses a wildcard topic', () => {
  // A binding names one sensor. A wildcard would bind a marker to whatever
  // else happened to match.
  const result = readManifest(withBinding({
    source: { live: { transport: 'mqtt', topic: 'swim/DemoBuilding/#' } },
  }));

  assert.equal(result.ok, false);
  assert.match(result.problems[0].message, /wildcard/);
});

test('refuses a topic with a leading slash', () => {
  const result = readManifest(withBinding({
    source: { live: { transport: 'mqtt', topic: '/swim/x' } },
  }));

  assert.equal(result.ok, false);
});

test('accepts a binding with history and no live source', () => {
  // Charting is not reimplemented in the 3D view, so a binding may exist for
  // the panel behind a click and never carry a current value.
  const result = readManifest(withBinding({
    source: { history: { bucket: 'swim', measurement: 'temperature' } },
  }));

  assert.equal(result.ok, true);
});

test('requires the source hash', () => {
  // Issue 1762 asks for it, and the reason is specific: without it there is no
  // way to tell whether a manifest still describes the model beside it.
  const { source_sha256: _dropped, ...withoutHash } = GOOD.model;

  assert.equal(readManifest({ ...GOOD, model: withoutHash }).ok, false);
});

test('accepts unknown as a hash, since a generator may not have read the file', () => {
  assert.equal(
    readManifest({ ...GOOD, model: { ...GOOD.model, source_sha256: 'unknown' } }).ok, true);
});

test('refuses a hash that is not a SHA-256', () => {
  assert.equal(
    readManifest({ ...GOOD, model: { ...GOOD.model, source_sha256: 'not-a-hash' } }).ok, false);
});

test('carries the proposed flag through, so the viewer can say so', () => {
  const result = readManifest({
    ...GOOD,
    model: { ...GOOD.model, proposed: true, basis: 'One sensor per storey.' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.manifest.model.proposed, true);
});

for (const value of [null, undefined, 42, 'a string', []]) {
  test(`refuses ${JSON.stringify(value)}, which is not a manifest at all`, () => {
    assert.equal(readManifest(value).ok, false);
  });
}
