/**
 * Tests for the building models page, rendered.
 *
 * Everything else in this suite tests logic. These render BuildingModels into a
 * jsdom document and drive it the way a person does, because the parts that
 * went wrong on this page were in how it behaved: a save that said nothing
 * while it happened, a model marked unconverted after it was stored, a name
 * that never arrived in the heading.
 *
 * The canvas is replaced. It draws with WebGL, which jsdom does not have, and
 * what is tested here is the page around the drawing. The stand-in records the
 * props it is given, counts how often it is mounted, and lets a test announce
 * that a conversion finished, which is what starts a save.
 *
 * The IFC statements are the ones in the real models, as in ifcName.test.mjs.
 */

import './support/dom.mjs';

import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { SceneView } from '../dist/esm/viewer/index.js';

const PAEDAGOGISK = `DATA;
#1= IFCPROJECT('15LR9Aj8fA4eCrdnAwudiM',#18,'34372',$,$,'P\\X\\E6dagogisk Center','Udbudsprojekt',(#22),#306726);`;
const TEMPLATE = `DATA;
#1= IFCPROJECT('0FHQg$qdvEPQB6VPH27kii',#18,'Project Number',$,$,'Project Name','Project Status',(#22),#167926);`;
const SUBSTATION = `DATA;
#1= IFCPROJECT('0b5j3C6_v5kA2vi1RMUzh5',$,'SWiM district cooling substation',$,$,$,$,(#10),#5);`;

const LIBRARY = 'http://host/jane/';
const DIRECTORY = 'common/models';

/** What the stand-in canvas was last given, and how often it was mounted. */
const canvas = { props: null, mounts: 0 };

function StandInCanvas(props) {
  canvas.props = props;
  React.useEffect(() => {
    canvas.mounts += 1;
  }, []);
  return React.createElement('div', {
    'data-testid': 'canvas',
    'data-url': props.url,
    'data-convert': String(props.convert),
  });
}

// defaultExport and not exports.default. Node 26 calls defaultExport deprecated,
// but the CI that publishes this package runs Node 22, where the options are
// cache, defaultExport and namedExports, and exports does not exist yet. The
// deprecation warning on a newer Node is the lesser cost.
mock.module(new URL('../dist/esm/react/BimCanvas.js', import.meta.url).href, {
  defaultExport: StandInCanvas,
});

const { BuildingModels } = await import('../dist/esm/react/BuildingModels.js');

/**
 * A workspace to answer the page's requests.
 *
 * `files` is what the models directory lists, `heads` is the start of each IFC
 * file, and `gate`, when set, holds every name read until it is opened, so a
 * test can look at the page before the names arrive.
 */
function workspace({ files, heads = {}, json = {}, listing = 'ok' }) {
  const state = { files: [...files], heads, json, listing, gate: null, cached: null };
  const page = () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } });
  const data = (value) => new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
  globalThis.fetch = async (url, init = {}) => {
    const address = String(url);
    if (address.includes('/api/contents/')) {
      if (state.listing === 'page') return page();
      if (state.listing === 'error') return new Response('', { status: 500 });
      // Jupyter sends the listing with Last-Modified and no Cache-Control, so
      // a browser may answer a later request from its cache. A request that
      // does not opt out gets the first listing again, as it could in a tab.
      if (init.cache !== 'no-store' && state.cached) return data(state.cached);
      state.cached = { type: 'directory', content: [...state.files] };
      return data({ type: 'directory', content: state.files });
    }
    if (address.includes('/files/')) {
      const name = decodeURIComponent(address.split('/').pop());
      if (name in state.json) return state.json[name] === 'page' ? page() : data(state.json[name]);
      if (state.gate) await state.gate.promise;
      return new Response(state.heads[name] ?? '', { status: 206 });
    }
    return new Response('', { status: 404 });
  };
  return state;
}

/** An IFC entry as the contents API lists it. */
const ifc = (name, size = 1000) => ({ name, path: `${DIRECTORY}/${name}`, size });

/** A promise a test settles itself. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function show(props = {}) {
  return render(
    React.createElement(BuildingModels, {
      libraryUrl: LIBRARY,
      directory: DIRECTORY,
      ...props,
    }),
  );
}

/** Open the model menu and return the text of each option. */
async function menuOptions(user) {
  await user.click(screen.getByRole('combobox', { name: /^IFC Model/ }));
  const options = await screen.findAllByRole('option');
  return options.map((option) => option.textContent);
}

async function choose(user, name) {
  await user.click(screen.getByRole('combobox', { name: /^IFC Model/ }));
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
  return screen.findByTestId('canvas');
}

beforeEach(() => {
  canvas.props = null;
  canvas.mounts = 0;
});

afterEach(() => {
  cleanup();
});

test('the menu is named by the heading above it', async () => {
  workspace({ files: [ifc('Building_1912_AK_v4.ifc')], heads: { 'Building_1912_AK_v4.ifc': TEMPLATE } });
  show();

  assert.ok(await screen.findByRole('combobox', { name: /^IFC Model/ }));
  assert.ok(screen.getByRole('heading', { name: 'IFC Model' }));
});

test('a model is listed by its file name until its own name is read', async () => {
  const library = workspace({
    files: [ifc('Building_1911_AK_v2.ifc'), ifc('Building_1912_AK_v4.ifc')],
    heads: { 'Building_1911_AK_v2.ifc': PAEDAGOGISK, 'Building_1912_AK_v4.ifc': TEMPLATE },
  });
  library.gate = deferred();
  const user = userEvent.setup();
  show();

  await screen.findByText(/2 IFC models in the shared library/);
  let options = await menuOptions(user);
  assert.ok(options.some((text) => text.startsWith('Building 1911 AK v2')), options.join(' | '));

  await act(async () => {
    library.gate.resolve();
    await library.gate.promise;
  });

  options = (await screen.findAllByRole('option')).map((option) => option.textContent);
  assert.ok(options.some((text) => text.startsWith('Pædagogisk Center')), options.join(' | '));
  // A template nobody filled in names nothing, so its file name stays.
  assert.ok(options.some((text) => text.startsWith('Building 1912 AK v4')), options.join(' | '));
});

test('a name two files share is shown by neither', async () => {
  workspace({
    files: [ifc('substation_ok.ifc'), ifc('substation_faults.ifc')],
    heads: { 'substation_ok.ifc': SUBSTATION, 'substation_faults.ifc': SUBSTATION },
  });
  const user = userEvent.setup();
  show();

  await screen.findByText(/2 IFC models/);
  const options = await menuOptions(user);
  assert.ok(options.some((text) => text.startsWith('substation ok')), options.join(' | '));
  assert.ok(options.some((text) => text.startsWith('substation faults')), options.join(' | '));
  assert.ok(!options.some((text) => text.includes('SWiM district cooling')), options.join(' | '));
});

test('the heading names the model once its name arrives, not only if it came first', async () => {
  // A person can choose a model before its name has been read. The heading was
  // bound to the object picked from the menu and kept its file name.
  const library = workspace({
    files: [ifc('Building_1911_AK_v2.ifc')],
    heads: { 'Building_1911_AK_v2.ifc': PAEDAGOGISK },
  });
  library.gate = deferred();
  const user = userEvent.setup();
  show();

  await screen.findByText(/1 IFC model in the shared library/);
  await choose(user, 'Building 1911 AK v2');
  assert.ok(screen.getByRole('heading', { name: 'Building 1911 AK v2' }));

  await act(async () => {
    library.gate.resolve();
    await library.gate.promise;
  });

  assert.ok(await screen.findByRole('heading', { name: 'Pædagogisk Center' }));
});

test('a model with no geometry says it is read from the IFC file', async () => {
  workspace({ files: [ifc('Building_1912_AK_v4.ifc')], heads: { 'Building_1912_AK_v4.ifc': TEMPLATE } });
  const user = userEvent.setup();
  show({ onPersistGeometry: async () => {} });

  await screen.findByText(/1 IFC model/);
  const drawn = await choose(user, 'Building 1912 AK v4');

  assert.equal(drawn.dataset.convert, 'true');
  assert.ok(screen.getByText(/No converted geometry sits beside this model/));
});

test('a stored conversion is said while it happens and after it lands', async () => {
  const library = workspace({ files: [ifc('Building_1912_AK_v4.ifc')], heads: { 'Building_1912_AK_v4.ifc': TEMPLATE } });
  const store = deferred();
  const stored = [];
  const user = userEvent.setup();
  show({
    onPersistGeometry: (model, glb) => {
      stored.push({ model: model.ifcPath, bytes: glb.length });
      return store.promise;
    },
  });

  await screen.findByText(/1 IFC model/);
  await choose(user, 'Building 1912 AK v4');

  await act(async () => {
    canvas.props.onConverted(new Uint8Array([1, 2, 3]));
  });
  assert.deepEqual(stored, [{ model: `${DIRECTORY}/Building_1912_AK_v4.ifc`, bytes: 3 }]);
  assert.ok(screen.getByText(/Saving the conversion to the library/));

  // The file the host wrote, which the page finds when it reads the directory
  // again.
  library.files.push({ name: 'Building_1912_AK_v4.glb', path: `${DIRECTORY}/Building_1912_AK_v4.glb`, size: 3 });
  await act(async () => {
    store.resolve();
    await store.promise;
  });

  assert.ok(await screen.findByText(/Stored in the library/));
  assert.equal(screen.queryByText(/Saving the conversion/), null);
});

test('after a save the model reads as converted, and the drawing is not redrawn', async () => {
  const library = workspace({ files: [ifc('Building_1912_AK_v4.ifc')], heads: { 'Building_1912_AK_v4.ifc': TEMPLATE } });
  const user = userEvent.setup();
  show({ onPersistGeometry: async () => {} });

  await screen.findByText(/1 IFC model/);
  await choose(user, 'Building 1912 AK v4');
  const heading = screen.getByRole('heading', { name: 'Building 1912 AK v4' });
  assert.ok(within(heading.parentElement).getByText('From IFC'));

  library.files.push({ name: 'Building_1912_AK_v4.glb', path: `${DIRECTORY}/Building_1912_AK_v4.glb`, size: 3 });
  await act(async () => {
    canvas.props.onConverted(new Uint8Array([1, 2, 3]));
  });

  // The chip beside the name follows the listing, and so does the notice.
  assert.ok(await within(heading.parentElement).findByText('Converted'));
  assert.equal(screen.queryByText(/No converted geometry sits beside this model/), null);
  // The model already on screen stays: redrawing it from the new file would
  // throw away a drawing that is correct.
  assert.equal(canvas.mounts, 1);
});

test('a refused store is said, and nothing breaks', async () => {
  workspace({ files: [ifc('Building_1912_AK_v4.ifc')], heads: { 'Building_1912_AK_v4.ifc': TEMPLATE } });
  const user = userEvent.setup();
  show({ onPersistGeometry: async () => { throw new Error('HTTP 403'); } });

  await screen.findByText(/1 IFC model/);
  await choose(user, 'Building 1912 AK v4');
  await act(async () => {
    canvas.props.onConverted(new Uint8Array([1]));
  });

  assert.ok(await screen.findByText(/could not be stored, so this model will convert again/));
  assert.ok(screen.getByTestId('canvas'));
});

test('choosing another model clears the message about the last one', async () => {
  workspace({
    files: [ifc('Building_1912_AK_v4.ifc'), ifc('Building_Deli_AK_v1.ifc')],
    heads: { 'Building_1912_AK_v4.ifc': TEMPLATE, 'Building_Deli_AK_v1.ifc': TEMPLATE },
  });
  const user = userEvent.setup();
  show({ onPersistGeometry: async () => { throw new Error('refused'); } });

  await screen.findByText(/2 IFC models/);
  await choose(user, 'Building 1912 AK v4');
  await act(async () => {
    canvas.props.onConverted(new Uint8Array([1]));
  });
  assert.ok(await screen.findByText(/could not be stored/));

  await choose(user, 'Building Deli AK v1');
  assert.equal(screen.queryByText(/could not be stored/), null);
});

test('without a way to store, the canvas is never asked for the bytes', async () => {
  workspace({ files: [ifc('Building_1912_AK_v4.ifc')], heads: { 'Building_1912_AK_v4.ifc': TEMPLATE } });
  const user = userEvent.setup();
  show();

  await screen.findByText(/1 IFC model/);
  await choose(user, 'Building 1912 AK v4');

  assert.equal(canvas.props.onConverted, undefined);
});

test('an empty library says so', async () => {
  workspace({ files: [] });
  show();

  assert.ok(await screen.findByText(/No IFC file is in the shared library yet/));
});

test('a listing that comes back as a page says the library could not be listed', async () => {
  // What a workspace served under a different name than the one signed in
  // looks like: the address falls through to the application's own page.
  workspace({ files: [], listing: 'page' });
  show();

  assert.ok(await screen.findByText('The shared library could not be listed.'));
  assert.ok(screen.getByText(/returned a web page instead of data/));
});

test('a listing the server refuses names the status', async () => {
  workspace({ files: [], listing: 'error' });
  show();

  assert.ok(await screen.findByText('The shared library could not be listed.'));
  assert.ok(screen.getByText(/returned HTTP 500/));
});

/** A model with its property tree and its manifest beside it. */
function withSidecars(manifest) {
  return workspace({
    files: [
      ifc('Building_1912_AK_v4.ifc'),
      { name: 'Building_1912_AK_v4.json', path: `${DIRECTORY}/Building_1912_AK_v4.json` },
      { name: 'Building_1912_AK_v4.manifest.json', path: `${DIRECTORY}/Building_1912_AK_v4.manifest.json` },
    ],
    heads: { 'Building_1912_AK_v4.ifc': TEMPLATE },
    json: {
      'Building_1912_AK_v4.json': { storeys: [{ name: 'L1' }], objects: { w1: { ifcClass: 'IfcWall' } } },
      'Building_1912_AK_v4.manifest.json': manifest,
    },
  });
}

const MANIFEST = {
  model: { source: 'Building_1912_AK_v4.ifc', source_sha256: 'unknown', converter: 'test' },
  bindings: [{
    selector: { globalId: 'w1' },
    label: 'Wall temperature',
    source: { live: { transport: 'mqtt', topic: 'swim/b/w1' } },
    display: { unit: '°C', ramp: [4, 16] },
  }],
};

test('the property tree and the manifest beside a model reach the canvas', async () => {
  withSidecars(MANIFEST);
  const user = userEvent.setup();
  show();

  await screen.findByText(/1 IFC model/);
  await choose(user, 'Building 1912 AK v4');

  await act(async () => {});
  assert.deepEqual(canvas.props.tree.objects, { w1: { ifcClass: 'IfcWall' } });
  assert.deepEqual(canvas.props.bindings.map((b) => b.label), ['Wall temperature']);
});

test('a manifest that cannot be read says so', async () => {
  withSidecars('page');
  const user = userEvent.setup();
  show();

  await screen.findByText(/1 IFC model/);
  await choose(user, 'Building 1912 AK v4');

  assert.ok(await screen.findByText('The sensor manifest could not be read.'));
});

/** Two floors, a wall and a slab on each, as the scene view tests build them. */
function building() {
  const model = new Group();
  const box = (globalId, ifcClass, y) => {
    const mesh = new Mesh(new BoxGeometry(1, 3, 1), new MeshStandardMaterial());
    mesh.position.set(0, y + 1.5, 0);
    mesh.userData.globalId = globalId;
    mesh.userData.ifcClass = ifcClass;
    return mesh;
  };
  for (const mesh of [
    box('w1', 'IfcWall', 0), box('s1', 'IfcSlab', 3),
    box('w2', 'IfcWall', 3.3), box('s2', 'IfcSlab', 6.3),
  ]) model.add(mesh);
  model.updateMatrixWorld(true);
  return new SceneView(model, {
    storeys: [{ name: 'L1' }, { name: 'L2' }],
    objects: {
      w1: { ifcClass: 'IfcWall', storey: 'L1' },
      s1: { ifcClass: 'IfcSlab', storey: 'L1' },
      w2: { ifcClass: 'IfcWall', storey: 'L2' },
      s2: { ifcClass: 'IfcSlab', storey: 'L2' },
    },
  });
}

/** The canvas says it is ready, with a real view and a handle that records. */
async function viewerReady() {
  const view = building();
  const looked = [];
  const painted = { count: 0 };
  await act(async () => {
    canvas.props.onReady({
      view,
      frame: () => {},
      look: (from) => looked.push(from),
      drawField: () => { painted.count += 1; },
    });
  });
  return { view, looked, painted };
}

test('once the viewer is ready, the legend lists the classes and their counts', async () => {
  workspace({ files: [ifc('Building_1912_AK_v4.ifc')], heads: { 'Building_1912_AK_v4.ifc': TEMPLATE } });
  const user = userEvent.setup();
  show();

  await screen.findByText(/1 IFC model/);
  await choose(user, 'Building 1912 AK v4');
  await viewerReady();

  const legend = screen.getByText('In This Model').parentElement;
  const rows = within(legend).getAllByRole('button').map((row) => row.textContent);
  assert.deepEqual(rows.sort(), ['Slab2', 'Wall2']);
});

test('picking a class in the legend lights it, and picking it again clears it', async () => {
  workspace({ files: [ifc('Building_1912_AK_v4.ifc')], heads: { 'Building_1912_AK_v4.ifc': TEMPLATE } });
  const user = userEvent.setup();
  show();

  await screen.findByText(/1 IFC model/);
  await choose(user, 'Building 1912 AK v4');
  const { view } = await viewerReady();

  const legend = screen.getByText('In This Model').parentElement;
  await user.click(within(legend).getByRole('button', { name: /Wall/ }));
  assert.equal(view.state.highlightedClass, 'IfcWall');

  await user.click(within(legend).getByRole('button', { name: /Wall/ }));
  assert.equal(view.state.highlightedClass, null);
});

test('a keyboard shortcut reaches the viewer', async () => {
  workspace({ files: [ifc('Building_1912_AK_v4.ifc')], heads: { 'Building_1912_AK_v4.ifc': TEMPLATE } });
  const user = userEvent.setup();
  show();

  await screen.findByText(/1 IFC model/);
  await choose(user, 'Building 1912 AK v4');
  const { looked } = await viewerReady();

  // 1 is Look From Above in the shortcut table.
  await user.keyboard('1');
  assert.deepEqual(looked, ['top']);
});

test('a viewer left alone is painted once, not over and over', async () => {
  // A host that passes no readings used to get a new empty map on every
  // render. The effect that applies readings depends on it and repaints, which
  // rendered again, so the page repainted the model without end.
  workspace({ files: [ifc('Building_1912_AK_v4.ifc')], heads: { 'Building_1912_AK_v4.ifc': TEMPLATE } });
  const user = userEvent.setup();
  show();

  await screen.findByText(/1 IFC model/);
  await choose(user, 'Building 1912 AK v4');
  const { painted } = await viewerReady();
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });

  assert.equal(painted.count, 1);
});

test('a property tree that cannot be read leaves the model drawing without it', async () => {
  withSidecars(MANIFEST);
  // The tree comes back as a page. It is not worth stopping the page for, so
  // the model draws and says less about each object.
  globalThis.fetch = ((original) => async (url, init) => {
    if (String(url).endsWith('Building_1912_AK_v4.json')) {
      return new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } });
    }
    return original(url, init);
  })(globalThis.fetch);
  const user = userEvent.setup();
  show();

  await screen.findByText(/1 IFC model/);
  await choose(user, 'Building 1912 AK v4');
  await act(async () => {});

  assert.ok(screen.getByTestId('canvas'));
  assert.equal(canvas.props.tree, undefined);
  assert.equal(screen.queryByText(/could not be listed/), null);
});

test('choosing a floor shows that floor', async () => {
  workspace({ files: [ifc('Building_1912_AK_v4.ifc')], heads: { 'Building_1912_AK_v4.ifc': TEMPLATE } });
  const user = userEvent.setup();
  show();

  await screen.findByText(/1 IFC model/);
  await choose(user, 'Building 1912 AK v4');
  const { view } = await viewerReady();

  await user.click(screen.getByRole('combobox', { name: /^Floor/ }));
  await user.click(await screen.findByRole('option', { name: 'L2' }));

  assert.equal(view.state.storey, 'L2');
});

test('the floor picker sits on the toolbar row, right after its last button', async () => {
  // One line of controls above the drawing. jsdom has no layout, so this
  // checks the structure that produces it: the toolbar and the floor picker
  // are siblings in one wrapping row, with the picker after the toolbar.
  workspace({ files: [ifc('Building_1912_AK_v4.ifc')], heads: { 'Building_1912_AK_v4.ifc': TEMPLATE } });
  const user = userEvent.setup();
  show();

  await screen.findByText(/1 IFC model/);
  await choose(user, 'Building 1912 AK v4');
  await viewerReady();

  const toolbar = document.querySelector('[data-revision]');
  const floor = screen.getByRole('combobox', { name: /^Floor/ });
  assert.ok(toolbar.nextElementSibling.contains(floor));
  assert.equal(getComputedStyle(toolbar.parentElement).flexWrap, 'wrap');
});
