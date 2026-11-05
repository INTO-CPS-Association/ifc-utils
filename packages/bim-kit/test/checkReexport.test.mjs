/**
 * Tests for the script that checks which bindings survive another export.
 *
 * The IFC side runs the package's converter on a real fixture, the same file
 * the converter tests use and the GLB side reads a binary glTF built here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  checkBindings, formatReport, hashVerdict, objectsOfGlb, objectsOfIfc, sha256Of,
} from '../scripts/check-reexport.mjs';

const WALL = new Uint8Array(readFileSync(new URL('../../../fixtures/wall_kernel_keeps_units.ifc', import.meta.url)));

const binding = (selector, label) => ({
  selector, label, source: { live: { transport: 'mqtt', topic: `t/${label}` } },
});

/** A binary glTF holding only its JSON chunk, which is all the script reads. */
function glb(gltf) {
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const padded = new Uint8Array(Math.ceil(json.length / 4) * 4).fill(0x20);
  padded.set(json);
  json = padded;
  const bytes = new Uint8Array(20 + json.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, json.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(json, 20);
  return bytes;
}

test('a GLB yields every node with a mesh, with its GlobalId and its name', () => {
  const objects = objectsOfGlb(glb({
    nodes: [
      { name: 'ifc' },
      { name: 'Wall', mesh: 0, extras: { globalId: '2O2Fr$t4X7Zf8NOew3FLOH' } },
      { mesh: 1 },
    ],
  }));
  assert.deepEqual(objects, [
    { globalId: '2O2Fr$t4X7Zf8NOew3FLOH', nodeName: 'Wall' },
    { globalId: undefined, nodeName: undefined },
  ]);
});

test('a file that is not a binary glTF is refused', () => {
  assert.throws(() => objectsOfGlb(new Uint8Array(24)), /not a binary glTF/);
});

test('bindings that the other export holds survive and the rest are lost with a reason', async () => {
  const objects = await objectsOfIfc(WALL);
  assert.ok(objects.length > 0);
  const kept = objects[0].globalId;
  const report = checkBindings({
    bindings: [binding({ globalId: kept }, 'kept'), binding({ globalId: 'gone00000000000000000a' }, 'gone')],
  }, objects);
  assert.equal(report.total, 2);
  assert.deepEqual(report.survived.map((b) => b.label), ['kept']);
  assert.equal(report.lost[0].label, 'gone');
  assert.match(report.lost[0].reason, /no object carries GlobalId gone/);
});

test('a manifest with no bindings reports none and does not throw', () => {
  assert.deepEqual(checkBindings({}, []), { total: 0, survived: [], lost: [] });
});

test('the hash verdict says whether the model is the file the manifest names', () => {
  const actual = sha256Of(WALL);
  assert.equal(hashVerdict(actual, actual), 'same file');
  assert.equal(hashVerdict(actual.toUpperCase(), actual), 'same file');
  assert.equal(hashVerdict('0'.repeat(64), actual), 'different file');
  assert.match(hashVerdict('unknown', actual), /unknown/);
  assert.match(hashVerdict(undefined, actual), /no hash/);
});

test('the report counts survivors and losses out of the total', () => {
  const text = formatReport({
    manifest: 'a.manifest.json', model: 'b.ifc', objects: 3, schemaProblems: [], hash: 'different file',
    total: 2, survived: [{ label: 'kept' }], lost: [{ label: 'gone', reason: 'no object.' }],
  });
  assert.match(text, /Survive: 1 of 2/);
  assert.match(text, /Lost: 1 of 2\n {2}lost {2}gone: no object\./);
});
