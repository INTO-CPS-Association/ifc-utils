/**
 * Tests for reading a building's name out of its IFC file.
 *
 * They run against `dist/`, not against `src/`, so what is checked is what is
 * published.
 *
 * The statements below are copied from the real models in the shared library,
 * because the cases worth testing are the ones those files present: an æ
 * escaped one way and an Ø another, a name on the project and a misspelt one on
 * the building, a job number where a name should be, and a template nobody
 * filled in.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeStepString,
  entityArguments,
  ifcBuildingName,
  usableName,
} from '../dist/esm/ifcName.js';
import {
  contentsUrl,
  formatSize,
  pairModels,
  readableName,
  readIfcName,
  uniqueNames,
} from '../dist/esm/react/assets.js';

/** Building_1911_AK_v2.ifc, as written. */
const PAEDAGOGISK = `DATA;
#1= IFCPROJECT('15LR9Aj8fA4eCrdnAwudiM',#18,'34372',$,$,'P\\X\\E6dagogisk Center','Udbudsprojekt',(#22),#306726);
#2= IFCBUILDING('15LR9Aj8fA4eCrdnAwudiN',#18,'P\\X\\E6dagosik Center',$,$,#30,$,'P\\X\\E6dagosik Center',.ELEMENT.,$,$,#31);`;

/** L187x_AK_v_done_v3b_processed.ifc, as written. */
const BYGNING_1870 = `DATA;
#1= IFCPROJECT('29fa62pe50pu2zreXLznet',#18,'39043-02',$,$,'Universitetsbyen - Bygning 1870','SOM UDF\\X2\\00D8\\X0\\RT',(#24),#1043004);
#2= IFCBUILDING('29fa62pe50pu2zreXLznes',#18,'',$,$,#32,$,'',.ELEMENT.,$,$,#33);`;

/** Building_1912_AK_v4.ifc, as written: the Revit template, never filled in. */
const TEMPLATE = `DATA;
#1= IFCPROJECT('0FHQg$qdvEPQB6VPH27kii',#18,'Project Number',$,$,'Project Name','Project Status',(#22),#167926);
#2= IFCBUILDING('0FHQg$qdvEPQB6VPH27kij',#18,'Building Name',$,$,#30,$,'Building Name',.ELEMENT.,$,$,#31);`;

/** substation_ok.ifc, as written: named on the project and nowhere else. */
const SUBSTATION = `DATA;
#1= IFCPROJECT('0b5j3C6_v5kA2vi1RMUzh5',$,'SWiM district cooling substation',$,$,$,$,(#10),#5);
#2= IFCBUILDING('2KVvvNoonF_RdJ2HL_fZM3',$,'DemoBuilding',$,$,#38,$,$,$,$,$,$);`;

test('an escaped ISO 8859-1 byte is the letter it stands for', () => {
  assert.equal(decodeStepString('P\\X\\E6dagogisk'), 'Pædagogisk');
});

test('an escaped UTF-16 run is the letters it stands for', () => {
  assert.equal(decodeStepString('SOM UDF\\X2\\00D8\\X0\\RT'), 'SOM UDFØRT');
});

test('a doubled quote and a doubled backslash are one of each', () => {
  assert.equal(decodeStepString("O''Brien\\\\x"), "O'Brien\\x");
});

test('an escaped upper-half character reads from ISO 8859-1', () => {
  // \\S\\ adds 128 to the character after it: \\S\\i is 0x69 + 0x80, 0xE9, é.
  assert.equal(decodeStepString('caf\\S\\i'), 'café');
});

test('a code page switch carries no character of its own', () => {
  assert.equal(decodeStepString('a\\PA\\b'), 'ab');
});

test('an escaped UTF-32 run is the characters it stands for', () => {
  assert.equal(decodeStepString('\\X4\\0001F3E0\\X0\\'), '🏠');
});

test('a backslash that starts no escape is kept as it is', () => {
  assert.equal(decodeStepString('a\\qb'), 'a\\qb');
});

test('an escape that is never closed ends the string there', () => {
  assert.equal(decodeStepString('ab\\X2\\00E6'), 'ab');
});

test('the arguments are split at the top level only', () => {
  const args = entityArguments(PAEDAGOGISK, 'IFCPROJECT');
  assert.equal(args.length, 9);
  // The list stays one argument, and so does a string holding a comma.
  assert.equal(args[7], '(#22)');
  assert.deepEqual(
    entityArguments("#1= IFCPROJECT('a, b',$);", 'IFCPROJECT'),
    ["'a, b'", '$'],
  );
});

test('a doubled quote inside an argument stays inside it', () => {
  // O'Brien's Hall, as ISO 10303-21 writes it.
  const args = entityArguments("#1= IFCPROJECT('O''Brien''s Hall',$);", 'IFCPROJECT');
  assert.deepEqual(args, ["'O''Brien''s Hall'", '$']);
  assert.equal(
    ifcBuildingName("#1= IFCPROJECT('x',#2,'O''Brien''s Hall',$,$,$);"),
    "O'Brien's Hall",
  );
});

test('a statement cut off by the end of what was read gives nothing', () => {
  assert.equal(entityArguments("#1= IFCPROJECT('a',#2,'unfinished", 'IFCPROJECT'), null);
});

test("the project's name wins over a misspelt one on the building", () => {
  assert.equal(ifcBuildingName(PAEDAGOGISK), 'Pædagogisk Center');
});

test('a job number is passed over for the name beside it', () => {
  assert.equal(ifcBuildingName(BYGNING_1870), 'Universitetsbyen - Bygning 1870');
});

test('a template nobody filled in names nothing', () => {
  // Seven of the twelve models in the shared library are this.
  assert.equal(ifcBuildingName(TEMPLATE), null);
});

test('the project name is read when it is the only name', () => {
  assert.equal(ifcBuildingName(SUBSTATION), 'SWiM district cooling substation');
});

test('a file with no project or building names nothing', () => {
  assert.equal(ifcBuildingName('ISO-10303-21;\nHEADER;\nENDSEC;'), null);
});

test('template text, job numbers and empty values are not names', () => {
  for (const value of ['Project Name', 'BUILDING NAME', 'Default', '34372', '39043-02', '  ', null]) {
    assert.equal(usableName(value), null, String(value));
  }
  assert.equal(usableName('  FEAS - Kommunehospital '), 'FEAS - Kommunehospital');
});

test('a name two files give is left out for both', () => {
  // Both substation models are "SWiM district cooling substation", and their
  // file names are what tells them apart.
  const titles = uniqueNames(new Map([
    ['substation_ok.ifc', 'SWiM district cooling substation'],
    ['substation_faults.ifc', 'SWiM district cooling substation'],
    ['Building_1911_AK_v2.ifc', 'Pædagogisk Center'],
    ['Building_1912_AK_v4.ifc', null],
  ]));
  assert.deepEqual([...titles], [['Building_1911_AK_v2.ifc', 'Pædagogisk Center']]);
});

/** Two IFC files as the contents API lists them. */
const ENTRIES = [
  { name: 'Building_1911_AK_v2.ifc', path: 'common/models/Building_1911_AK_v2.ifc', size: 10 },
  { name: 'Building_1912_AK_v4.ifc', path: 'common/models/Building_1912_AK_v4.ifc', size: 20 },
];

test('a model is shown by the name its file gives, or by its file name', () => {
  const models = pairModels(ENTRIES, new Map([['Building_1911_AK_v2.ifc', 'Pædagogisk Center']]));
  assert.deepEqual(
    models.map((model) => model.title),
    ['Building 1912 AK v4', 'Pædagogisk Center'],
  );
  // The list is in the order of what it shows, and each entry still carries its
  // file name, because the geometry beside a model is found by it and a name
  // must not be able to break that.
  assert.deepEqual(
    models.map((model) => model.name),
    ['Building_1912_AK_v4', 'Building_1911_AK_v2'],
  );
});

test('each model is paired with the geometry, tree and manifest beside it', () => {
  const [model] = pairModels([
    { name: 'a.ifc', path: 'm/a.ifc', size: 1 },
    { name: 'a.glb', path: 'm/a.glb' },
    { name: 'a.json', path: 'm/a.json' },
    { name: 'a.manifest.json', path: 'm/a.manifest.json' },
  ]);
  assert.equal(model.geometryPath, 'm/a.glb');
  assert.equal(model.treePath, 'm/a.json');
  // Ending in .json as well, and not taken for the tree.
  assert.equal(model.manifestPath, 'm/a.manifest.json');
});

test('the listing and file addresses are built under the library', () => {
  assert.equal(contentsUrl('http://host/jane', 'common/models'),
    'http://host/jane/api/contents/common/models');
  assert.equal(contentsUrl('http://host/jane/', 'common/models'),
    'http://host/jane/api/contents/common/models');
});

test('a size reads in the unit a person expects', () => {
  assert.equal(formatSize(undefined), '');
  assert.equal(formatSize(11 * 1024), '11 KB');
  assert.equal(formatSize(24.2 * 1024 * 1024), '24.2 MB');
});

test('a file name reads with spaces for its separators and keeps its case', () => {
  assert.equal(readableName('Building_1912_AK_v4'), 'Building 1912 AK v4');
  assert.equal(readableName('L187x_AK__v_done'), 'L187x AK v done');
});

/** Stand in for the one request readIfcName makes. */
function withFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return run().finally(() => { globalThis.fetch = original; });
}

/** A response whose body arrives in the chunks given. */
function streamed(chunks, status = 206) {
  let cancelled = false;
  let index = 0;
  const encoder = new TextEncoder();
  return {
    ok: status >= 200 && status < 300,
    status,
    get cancelled() { return cancelled; },
    body: {
      getReader: () => ({
        read: async () => (index < chunks.length
          ? { done: false, value: encoder.encode(chunks[index++]) }
          : { done: true, value: undefined }),
        cancel: async () => { cancelled = true; },
      }),
    },
  };
}

test('only the start of the file is asked for', async () => {
  let asked;
  await withFetch(
    async (url, init) => { asked = { url, init }; return streamed([PAEDAGOGISK]); },
    () => readIfcName('http://host/jane/', 'common/models/Building_1911_AK_v2.ifc'),
  );
  assert.equal(asked.url, 'http://host/jane/files/common/models/Building_1911_AK_v2.ifc');
  assert.equal(asked.init.headers.Range, 'bytes=0-65535');
  assert.equal(asked.init.credentials, 'include');
});

test('the name is read from the start of the file', async () => {
  const name = await withFetch(
    async () => streamed([PAEDAGOGISK]),
    () => readIfcName('http://host/jane/', 'common/models/Building_1911_AK_v2.ifc'),
  );
  assert.equal(name, 'Pædagogisk Center');
});

test('a server that sends the whole file is read only as far as the limit', async () => {
  // A server that ignores the range answers 200 with everything. The name is
  // in the first chunk, and the rest of a 64 MB model must not be downloaded.
  const filler = 'x'.repeat(40 * 1024);
  const response = streamed([PAEDAGOGISK, filler, filler, filler, filler], 200);
  const name = await withFetch(
    async () => response,
    () => readIfcName('http://host/jane/', 'common/models/a.ifc'),
  );
  assert.equal(name, 'Pædagogisk Center');
  assert.equal(response.cancelled, true);
});

test('a response with no stream is read from its buffer, to the limit', async () => {
  // Not every fetch gives a readable body. Without one the bytes come from the
  // buffer, cut at the same limit.
  const bytes = new TextEncoder().encode(PAEDAGOGISK + 'x'.repeat(100 * 1024));
  const name = await withFetch(
    async () => ({
      ok: true,
      status: 200,
      body: null,
      arrayBuffer: async () => bytes.buffer,
    }),
    () => readIfcName('http://host/jane/', 'common/models/a.ifc'),
  );
  assert.equal(name, 'Pædagogisk Center');
});

test('a name that cannot be read is null, and never a failure', async () => {
  const cases = [
    async () => ({ ok: false, status: 404 }),
    async () => { throw new TypeError('network down'); },
  ];
  for (const handler of cases) {
    const name = await withFetch(handler, () => readIfcName('http://host/jane/', 'x.ifc'));
    assert.equal(name, null);
  }
});
