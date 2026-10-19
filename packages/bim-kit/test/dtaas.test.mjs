/**
 * Tests for the DTaaS extension entry point, `./dtaas`.
 *
 * The SDK's own harness is the main check: it validates the declaration,
 * the presets, `setup()`, mounts every page against a fake host and fails if
 * the kit opens a socket. The rest checks what the harness cannot know about
 * buildings: which twins are claimed, which anchors are valid, how elements
 * group into rooms and storeys, and where a converted GLB is stored.
 */

import './support/dom.mjs';
import { mockCanvas } from './support/canvas.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateExtension } from '@into-cps-association/dtaas-sdk';
import { checkConformance, fakeHostServices } from '@into-cps-association/dtaas-sdk/testing';

mockCanvas();

const { extension } = await import('../dist/esm/dtaas/index.js');
const { default: persistGeometry } = await import('../dist/esm/dtaas/persistGeometry.js');

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const GLOBAL_ID = '0_sgz7bzz4Jh2ckU1ehFe$';
const HOUSE = { name: 'house', ifcPath: 'common/models/house.ifc' };

test('the extension passes the SDK static validation', () => {
  assert.deepEqual(validateExtension(extension), { valid: true, errors: [] });
});

test('the extension passes the conformance harness and logs that it is ready', async () => {
  const host = fakeHostServices({ extensionId: 'bim' });
  const report = await checkConformance(extension, { host, timeoutMs: 10_000 });
  assert.deepEqual(report, { passed: true, errors: [] });
  assert.ok(host.recorded.logs.some(({ level, args }) => level === 'info' && args[0] === 'bim ready'));
});

test('an empty models directory in the configuration fails setup', async () => {
  const host = fakeHostServices({ extensionId: 'bim', env: { REACT_APP_EXT_BIM_MODELS_DIRECTORY: '' } });
  const report = await checkConformance(extension, { host });
  assert.equal(report.passed, false);
  assert.match(report.errors[0], /^setup\(\) failed: Invalid configuration for extension "bim"/);
});

test('the extension declares the version of the package it ships in', () => {
  assert.equal(extension.version, PACKAGE.version);
});

test('a twin is claimed by its domain or by an IFC file among its files', async () => {
  const { detect } = extension.visualisation;
  assert.equal(await detect({ name: 'h', path: 'dt/h', files: ['House.IFC'] }), true);
  assert.equal(await detect({ name: 'h', path: 'dt/h', files: [], domain: 'bim' }), true);
  assert.equal(await detect({ name: 'w', path: 'dt/w', files: ['turbine.fmu'] }), false);
});

test('an ifc-guid anchor accepts a GlobalId and refuses anything else', () => {
  const [kind] = extension.visualisation.anchorKinds;
  assert.equal(kind.kind, 'ifc-guid');
  assert.equal(kind.validateRef(GLOBAL_ID), true);
  assert.equal(kind.validateRef('wall-1'), false);
});

test('an ifc-guid anchor is resolved by the substrate adapter it is given', () => {
  const [kind] = extension.visualisation.anchorKinds;
  const anchor = { kind: 'ifc-guid', ref: GLOBAL_ID, signalPath: 'r204/temp' };
  const element = { handle: {} };
  const asked = [];
  const adapter = {
    resolve: (seen) => {
      asked.push(seen);
      return element;
    },
  };
  assert.equal(kind.resolve(anchor, adapter), element);
  assert.deepEqual(asked, [anchor]);
});

/** An adapter whose elements carry the room and storey the aec substrate copies onto them. */
function adapterOf(facts) {
  return {
    resolve: ({ ref }) => (ref in facts ? { handle: { userData: facts[ref] } } : undefined),
  };
}

test('elements group by room and by storey, and an element with neither is left out', () => {
  const adapter = adapterOf({
    a: { room: '204', storey: 'Level 2' },
    b: { room: '205', storey: 'Level 2' },
    c: { room: '' },
  });
  const [room, storey] = extension.visualisation.scopes;
  const ids = ['a', 'b', 'c', 'missing'];
  assert.deepEqual(room.group(ids, { adapter }), { 204: ['a'], 205: ['b'] });
  assert.deepEqual(storey.group(ids, { adapter }), { 'Level 2': ['a', 'b'] });
});

test('a room named __proto__ is an ordinary group and not a prototype', () => {
  const adapter = adapterOf({ d: { room: '__proto__' } });
  const groups = extension.visualisation.scopes[0].group(['d'], { adapter });
  assert.deepEqual(Object.keys(groups), ['__proto__']);
  assert.equal(Object.getPrototypeOf(groups), Object.prototype);
});

test('a converted GLB is stored beside its IFC file through host.contents', async () => {
  const host = fakeHostServices({ extensionId: 'bim' });
  const glb = new Uint8Array([1, 2, 3]);
  await persistGeometry(host)(HOUSE, glb);
  assert.deepEqual(host.contents.files.get('common/models/house.glb'), glb);
});

test('a GLB follows its IFC file, whatever the case of its suffix and wherever it sits', async () => {
  const host = fakeHostServices({ extensionId: 'bim' });
  const glb = new Uint8Array([4]);
  await persistGeometry(host)({ name: 'tower', ifcPath: 'projects/aarhus/tower.IFC' }, glb);
  assert.deepEqual(host.contents.files.get('projects/aarhus/tower.glb'), glb);
});

test('a GLB already beside the IFC file is never replaced', async () => {
  const host = fakeHostServices({ extensionId: 'bim' });
  const made = new Uint8Array([9]);
  await host.contents.put('common/models/house.glb', made);
  await assert.rejects(persistGeometry(host)(HOUSE, new Uint8Array([1])));
  assert.deepEqual(host.contents.files.get('common/models/house.glb'), made);
});

test('a store the host refuses is logged and passed on to the page', async () => {
  const refused = new Error('read-only');
  const host = fakeHostServices({
    extensionId: 'bim',
    overrides: { contents: { put: async () => { throw refused; } } },
  });
  await assert.rejects(persistGeometry(host)(HOUSE, new Uint8Array()), refused);
  assert.ok(host.recorded.logs.some(({ level }) => level === 'warn'));
});
