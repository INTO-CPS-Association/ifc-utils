/**
 * Tests for manifestToVisualisation: a binding manifest turned into the
 * `visualisation.json` asset the DTaaS client reads, checked against the
 * SDK's own asset schema and saved and loaded back through a fake host.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVisualisationAsset } from '@into-cps-association/dtaas-sdk/schema';
import { fakeHostServices } from '@into-cps-association/dtaas-sdk/testing';
import { readManifest } from '../dist/esm/schema.js';
import { manifestToVisualisation } from '../dist/esm/dtaas/index.js';

const live = (topic) => ({ live: { transport: 'mqtt', topic } });
const celsius = { unit: '°C', ramp: [4, 16] };

/** Two probes on one topic, one binding with no GlobalId, one with no live half. */
const SUBSTATION = {
  model: {
    source: 'substation.ifc',
    source_sha256: 'unknown',
    converter: 'ifc_explorer.to_manifest 0.1.0',
    geometry: 'substation.glb',
  },
  bindings: [
    { selector: { globalId: '0_sgz7bzz4Jh2ckU1ehFe$' }, label: 'HX-1 supply', source: live('swim/hx1/supply'), display: celsius },
    { selector: { globalId: '1yETHMphv6LwABqR4Pbs5g' }, label: 'HX-1 probe', source: live('swim/hx1/supply'), display: celsius },
    { selector: { nodeName: 'Pump-2' }, label: 'Pump-2 flow', source: live('swim/p2/flow'), display: { unit: 'L/min', ramp: [0, 200] } },
    {
      selector: { globalId: '2O2Fr$t4X7Zf8NOew3FLOH' },
      label: 'HX-1 return',
      source: { history: { bucket: 'swim', measurement: 'temperature' } },
      display: celsius,
    },
  ],
};

const OPTIONS = { name: 'substation', brokerUrl: 'wss://broker.example/ws' };

function manifest() {
  const result = readManifest(SUBSTATION);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.manifest;
}

test('the asset satisfies the SDK schema and draws the converted geometry', () => {
  const { asset } = manifestToVisualisation(manifest(), OPTIONS);
  assert.equal(parseVisualisationAsset(asset).success, true);
  assert.deepEqual(asset.substrates.building, { adapter: 'aec', source: 'substation.glb' });
  assert.deepEqual(asset.layout, { type: 'single', panes: ['building'] });
});

test('every binding with a GlobalId and a live topic becomes an ifc-guid anchor', () => {
  const { asset } = manifestToVisualisation(manifest(), OPTIONS);
  assert.deepEqual(asset.anchors, [
    { signalPath: 'swim/hx1/supply', kind: 'ifc-guid', ref: '0_sgz7bzz4Jh2ckU1ehFe$' },
    { signalPath: 'swim/hx1/supply', kind: 'ifc-guid', ref: '1yETHMphv6LwABqR4Pbs5g' },
  ]);
});

test('one mqtt transport names each topic once, and one colour scale follows each ramp', () => {
  const { asset } = manifestToVisualisation(manifest(), OPTIONS);
  assert.deepEqual(asset.transports, [
    { adapter: 'mqtt', url: 'wss://broker.example/ws', topics: ['swim/hx1/supply'], channel: 'measured' },
  ]);
  assert.deepEqual(asset.encodings.map(({ target, encoding }) => [target, encoding.domain]), [
    ['swim/hx1/supply', [4, 16]],
  ]);
});

test('a binding that cannot be anchored is returned with its reason', () => {
  const { skipped } = manifestToVisualisation(manifest(), OPTIONS);
  assert.deepEqual(skipped.map(({ reason }) => reason), [
    'no GlobalId: ifc-guid anchors need one',
    'no live topic: history-only bindings have nothing to anchor',
  ]);
});

test('a model with no converted geometry is drawn from its IFC file, with no transport', () => {
  const raw = { model: { source: 'raw.ifc', source_sha256: 'unknown', converter: 'test' }, bindings: [] };
  const { asset } = manifestToVisualisation(raw, OPTIONS);
  assert.equal(asset.substrates.building.source, 'raw.ifc');
  assert.deepEqual(asset.transports, []);
});

test('the asset is saved and loaded back through a host unchanged', async () => {
  const dt = { name: 'substation', path: 'digital_twins/substation', files: ['substation.ifc'] };
  const { asset } = manifestToVisualisation(manifest(), OPTIONS);
  const host = fakeHostServices();
  await host.viz.save(dt, asset);
  assert.deepEqual(await host.viz.load(dt), asset);
});
