/**
 * Tests for the model catalogue, the optional file that names the buildings.
 *
 * They run against `dist/`, not against `src/`, so what is checked is what is
 * published.
 *
 * The rule the catalogue has to keep: it can never fail the page. A model list
 * that a missing or broken naming file could break would be worse than models
 * shown under their file names, so every failure here has to end in an empty
 * map.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pairModels, readCatalogue, readableName, CATALOGUE_FILE }
  from '../dist/esm/react/assets.js';

/** Two IFC files, one with geometry beside it, as the contents API lists them. */
const ENTRIES = [
  { name: 'Building_1911_AK_v2.ifc', path: 'common/models/Building_1911_AK_v2.ifc', size: 10 },
  { name: '2116_FEAS_kedelhuset.ifc', path: 'common/models/2116_FEAS_kedelhuset.ifc', size: 20 },
];

/** Stand in for the one request `readCatalogue` makes. */
function withFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return run().finally(() => { globalThis.fetch = original; });
}

const jsonResponse = (body) => ({
  ok: true,
  json: async () => body,
});

test('a model with no catalogue entry keeps its file name', () => {
  const models = pairModels(ENTRIES);
  assert.equal(models.length, 2);
  // The file name, with its separators read as spaces.
  assert.deepEqual(
    models.map((model) => model.title),
    ['2116 FEAS kedelhuset', 'Building 1911 AK v2'],
  );
});

test('a catalogue entry names the building, and the list sorts by that name', () => {
  // The names these two files carry, read out of them.
  const titles = new Map([
    ['Building_1911_AK_v2.ifc', 'Pædagogisk Center'],
    ['2116_FEAS_kedelhuset.ifc', 'FEAS - Kommunehospital'],
  ]);
  const models = pairModels(ENTRIES, titles);

  assert.deepEqual(
    models.map((model) => model.title),
    ['FEAS - Kommunehospital', 'Pædagogisk Center'],
  );
  // The file name is still there, because the geometry beside a model is
  // found by it and a title must not be able to break that.
  assert.deepEqual(
    models.map((model) => model.name),
    ['2116_FEAS_kedelhuset', 'Building_1911_AK_v2'],
  );
});

test('a model the catalogue does not mention keeps its file name', () => {
  const titles = new Map([['Building_1911_AK_v2.ifc', 'Pædagogisk Center']]);
  const models = pairModels(ENTRIES, titles);
  assert.deepEqual(
    models.map((model) => model.title),
    ['2116 FEAS kedelhuset', 'Pædagogisk Center'],
  );
});

test('a file name reads with spaces for its separators and keeps its case', () => {
  // AK and v4 mean something, so the case is not guessed at.
  assert.equal(readableName('Building_1912_AK_v4'), 'Building 1912 AK v4');
  assert.equal(readableName('L187x_AK__v_done'), 'L187x AK v done');
  assert.equal(
    readableName('[3D IFC SG] Project CleanTech One 02-24 IFC SG'),
    '[3D IFC SG] Project CleanTech One 02-24 IFC SG',
  );
});

test('readCatalogue asks for the catalogue beside the models', async () => {
  let asked = '';
  await withFetch(
    async (url) => { asked = url; return jsonResponse({}); },
    async () => { await readCatalogue('http://host/jane/', 'common/models'); },
  );
  assert.equal(asked, `http://host/jane/files/common/models/${CATALOGUE_FILE}`);
});

test('readCatalogue reads the titles it is given', async () => {
  await withFetch(
    async () => jsonResponse({ 'a.ifc': 'Building A', 'b.ifc': '  Building B  ' }),
    async () => {
      const titles = await readCatalogue('http://host/jane/');
      assert.equal(titles.get('a.ifc'), 'Building A');
      // Trimmed, because a title typed by hand collects spaces.
      assert.equal(titles.get('b.ifc'), 'Building B');
    },
  );
});

test('readCatalogue skips an entry that is not a usable title', async () => {
  await withFetch(
    async () => jsonResponse({ 'a.ifc': 42, 'b.ifc': { name: 'x' }, 'c.ifc': '   ', 'd.ifc': 'Fine' }),
    async () => {
      const titles = await readCatalogue('http://host/jane/');
      // A number or an object would otherwise reach the page as "[object
      // Object]", and an empty title would name a model with nothing at all.
      assert.deepEqual([...titles.keys()], ['d.ifc']);
    },
  );
});

test('no catalogue file means no titles, and no failure', async () => {
  await withFetch(
    async () => ({ ok: false, status: 404, json: async () => ({}) }),
    async () => {
      assert.equal((await readCatalogue('http://host/jane/')).size, 0);
    },
  );
});

test('a catalogue that is not an object means no titles', async () => {
  for (const body of [null, 'a string', [1, 2, 3]]) {
    await withFetch(
      async () => jsonResponse(body),
      async () => {
        const titles = await readCatalogue('http://host/jane/');
        assert.equal(titles.size, 0, `body ${JSON.stringify(body)}`);
      },
    );
  }
});

test('a broken catalogue means no titles, and no failure', async () => {
  await withFetch(
    async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } }),
    async () => {
      assert.equal((await readCatalogue('http://host/jane/')).size, 0);
    },
  );
});

test('a network failure means no titles, and no failure', async () => {
  await withFetch(
    async () => { throw new TypeError('network down'); },
    async () => {
      assert.equal((await readCatalogue('http://host/jane/')).size, 0);
    },
  );
});
