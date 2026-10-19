/**
 * Tests for what the DTaaS extension contributes to the client's common
 * visualisation core, each checked against the SDK's own schemas and helpers:
 * the configuration, the encoding presets and the IFC to GLB converter.
 *
 * The converter runs for real on a fixture from the top of the repository,
 * the same file `convert.test.mjs` reads, because a converter tested on a
 * stand-in says nothing about the bytes a host would store.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readExtensionConfig } from '@into-cps-association/dtaas-sdk';
import { encodingPresetSchema } from '@into-cps-association/dtaas-sdk/schema';
import { default as configSchema } from '../dist/esm/dtaas/config.js';
import { default as converters } from '../dist/esm/dtaas/converters.js';
import { default as presets } from '../dist/esm/dtaas/presets/index.js';

/**
 * The part of a browser's FileReader that three's GLTFExporter uses to
 * assemble a GLB. Node has Blob and no FileReader, and jsdom's FileReader
 * refuses Node's Blob, so this file runs without jsdom and with this.
 */
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
};

const BASIN = new Uint8Array(readFileSync(new URL('../../../fixtures/basin_at_the_origin.ifc', import.meta.url)));

test('the models directory is read from REACT_APP_EXT_BIM_MODELS_DIRECTORY', () => {
  const result = readExtensionConfig('bim', configSchema, { REACT_APP_EXT_BIM_MODELS_DIRECTORY: 'projects' });
  assert.deepEqual(result.success && result.data, { modelsDirectory: 'projects' });
});

test('the configuration is optional, and an empty directory is refused', () => {
  assert.deepEqual(readExtensionConfig('bim', configSchema, {}).data, {});
  const empty = readExtensionConfig('bim', configSchema, { REACT_APP_EXT_BIM_MODELS_DIRECTORY: '' });
  assert.equal(empty.success, false);
});

test('every preset satisfies the SDK encoding preset schema', () => {
  for (const preset of presets) {
    assert.equal(encodingPresetSchema.safeParse(preset).success, true, preset.id);
  }
});

test('thermal comfort spans 18 to 26 °C and CO₂ spans 400 to 1400 ppm, on the aec substrate', () => {
  const domainOf = (id) => presets.find((preset) => preset.id === id).encodings[0].encoding.domain;
  assert.deepEqual(domainOf('bim.thermal-comfort'), [18, 26]);
  assert.deepEqual(domainOf('bim.co2'), [400, 1400]);
  assert.ok(presets.every((preset) => preset.substrate === 'aec'));
});

test('the converter turns IFC bytes into a GLB and reports what it converted', async () => {
  const [spec] = converters;
  assert.deepEqual([spec.id, spec.from, spec.to], ['bim.ifc-to-glb', ['.ifc'], 'glb']);

  const { default: convert } = await spec.load();
  const output = await convert({ name: 'basin_at_the_origin.ifc', bytes: BASIN }, {});

  assert.equal(output.format, 'glb');
  // Every GLB starts with the ASCII magic `glTF`.
  assert.equal(new TextDecoder().decode(output.bytes.subarray(0, 4)), 'glTF');
  assert.equal(output.metadata.failed, 0);
  assert.ok(output.metadata.objects > 0);
  assert.match(output.metadata.schema, /^IFC/);
});
