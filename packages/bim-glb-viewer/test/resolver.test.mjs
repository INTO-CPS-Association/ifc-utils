/**
 * Tests for turning a selector into the object it names.
 *
 * The case that matters most is the one that fails: a manifest pointing at an
 * object the geometry does not have. That happens whenever a model is
 * re-exported, and a viewer that silently draws four markers where the
 * manifest asked for six is worse than one that says which two are missing.
 *
 * Run against `dist/`, so what is checked is what is published.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveBindings, topicsOf, bindingsByTopic } from '../dist/esm/index.js';

function binding(selector, topic) {
  return {
    selector,
    label: 'a sensor',
    source: topic === undefined ? {} : { live: { transport: 'mqtt', topic } },
    display: { unit: '°C', ramp: [4, 16] },
  };
}

const SCENE = [
  { globalId: '0_sgz7bzz4Jh2ckU1ehFe$', nodeName: 'HX-1', expressId: 101 },
  { globalId: '2rhLI2AGjBtf4PwudZJble', nodeName: 'Wall', expressId: 102 },
  { globalId: '1tlDO0c_bCJRLcLkbWZYQN', nodeName: 'Wall', expressId: 103 },
];

test('resolves a binding by GlobalId', () => {
  const { resolved, unresolved } = resolveBindings(
    [binding({ globalId: '0_sgz7bzz4Jh2ckU1ehFe$' })], SCENE);

  assert.equal(unresolved.length, 0);
  assert.equal(resolved[0].object.nodeName, 'HX-1');
});

test('reports a binding whose object is not in the model, instead of dropping it', () => {
  const { resolved, unresolved } = resolveBindings(
    [binding({ globalId: '0000000000000000000000' })], SCENE);

  assert.equal(resolved.length, 0);
  assert.match(unresolved[0].reason, /re-exported/);
});

test('keeps the good bindings when one fails', () => {
  // A single bad binding must not cost the others. This is the ordinary state
  // of a manifest that has drifted from its model.
  const { resolved, unresolved } = resolveBindings([
    binding({ globalId: '0_sgz7bzz4Jh2ckU1ehFe$' }),
    binding({ globalId: '0000000000000000000000' }),
  ], SCENE);

  assert.equal(resolved.length, 1);
  assert.equal(unresolved.length, 1);
});

test('refuses a nodeName that two objects share', () => {
  // A name is not an identifier. Picking either would be a guess presented as
  // a fact.
  const { unresolved } = resolveBindings([binding({ nodeName: 'Wall' })], SCENE);

  assert.match(unresolved[0].reason, /2 objects are named Wall/);
  assert.match(unresolved[0].reason, /globalId/);
});

test('resolves a nodeName that only one object has', () => {
  const { resolved } = resolveBindings([binding({ nodeName: 'HX-1' })], SCENE);

  assert.equal(resolved[0].object.globalId, '0_sgz7bzz4Jh2ckU1ehFe$');
});

test('says an express id does not survive a re-export', () => {
  const { unresolved } = resolveBindings([binding({ expressId: 999 })], SCENE);

  assert.match(unresolved[0].reason, /does not survive a re-export/);
});

test('handles an empty model without throwing', () => {
  const { resolved, unresolved } = resolveBindings(
    [binding({ globalId: '0_sgz7bzz4Jh2ckU1ehFe$' })], []);

  assert.equal(resolved.length, 0);
  assert.equal(unresolved.length, 1);
});

test('handles an empty manifest without throwing', () => {
  assert.equal(resolveBindings([], SCENE).resolved.length, 0);
});

test('returns each topic once', () => {
  // Subscribing twice to one topic delivers every message twice.
  const topics = topicsOf([
    binding({ nodeName: 'a' }, 'swim/x'),
    binding({ nodeName: 'b' }, 'swim/x'),
    binding({ nodeName: 'c' }, 'swim/y'),
  ]);

  assert.deepEqual(topics.sort(), ['swim/x', 'swim/y']);
});

test('leaves a binding with no live source out of the topic list', () => {
  assert.deepEqual(topicsOf([binding({ nodeName: 'a' })]), []);
});

test('groups two bindings that share a topic', () => {
  // Two markers can legitimately show the same sensor.
  const index = bindingsByTopic([
    binding({ nodeName: 'a' }, 'swim/x'),
    binding({ nodeName: 'b' }, 'swim/x'),
  ]);

  assert.equal(index.get('swim/x').length, 2);
});

test('leaves a binding with no live source out of the topic index', () => {
  assert.equal(bindingsByTopic([binding({ nodeName: 'a' })]).size, 0);
});
