/**
 * Tests for the Buildings page as DTaaS mounts it, under the SDK's fake host.
 *
 * The page is the wiring between the host and BuildingModels, so these check
 * the wiring: the folder comes from the URL or the configuration and never
 * leaves the library, the files come from `host.contents`, the chosen model
 * lives in the route, a conversion is stored through the host, and readings
 * arrive through `host.signals`.
 */

import './support/dom.mjs';
import { canvas, mockCanvas } from './support/canvas.mjs';

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Group } from 'three';
import { Route, Routes, useLocation } from 'react-router-dom';
import { fakeHostServices, renderWithHost } from '@into-cps-association/dtaas-sdk/testing';
import { SceneView } from '../dist/esm/viewer/index.js';

mockCanvas();

const { default: BuildingsPage } = await import('../dist/esm/dtaas/pages/BuildingsPage.js');

const BASE_URL = 'https://dtaas.example/lib';
const TOPIC = 'hosp/r204/temp';
const TEMPLATE = `DATA;
#1= IFCPROJECT('0FHQg$qdvEPQB6VPH27kii',#18,'Project Number',$,$,'Project Name','Project Status',(#22),#167926);`;
const MANIFEST = {
  model: { source: 'hospital-a.ifc', source_sha256: 'unknown', converter: 'test' },
  bindings: [{
    selector: { globalId: 'r204TempSensor00000001' },
    label: 'Room 204 temperature',
    source: { live: { transport: 'mqtt', topic: TOPIC } },
    display: { unit: '°C', ramp: [18, 26] },
  }],
};
const FILES = {
  'common/models/hospital-a.ifc': TEMPLATE,
  'common/models/hospital-a.manifest.json': JSON.stringify(MANIFEST),
  'common/models/office-b.ifc': TEMPLATE,
  'projects/aarhus/tower.ifc': TEMPLATE,
};

/** Serves `files/<path>` the way a workspace does. The listing goes through `host.contents`. */
function serveFiles() {
  globalThis.fetch = async (url) => {
    const path = decodeURIComponent(String(url).slice(`${BASE_URL}/files/`.length));
    if (!(path in FILES)) return new Response('', { status: 404 });
    const type = path.endsWith('.json') ? 'application/json' : 'text/plain';
    return new Response(FILES[path], { headers: { 'content-type': type } });
  };
}

/** The page under both routes the extension declares, and where navigation landed. */
function App() {
  const location = useLocation();
  const page = React.createElement(BuildingsPage);
  return React.createElement(React.Fragment, null,
    React.createElement('div', { 'data-testid': 'location' }, `${location.pathname}${location.search}`),
    React.createElement(Routes, null,
      React.createElement(Route, { path: '/bim', element: page }),
      React.createElement(Route, { path: '/bim/models/:model', element: page })));
}

function show(route, env = {}) {
  const host = fakeHostServices({ extensionId: 'bim', files: FILES, env });
  const calls = [];
  const list = host.contents.list.bind(host.contents);
  host.contents.list = (path) => {
    calls.push(path);
    return list(path);
  };
  renderWithHost(React.createElement(App), { host, route });
  return { host, calls };
}

const location = () => screen.getByTestId('location').textContent;

async function choose(user, name) {
  await user.click(screen.getByRole('combobox', { name: /^IFC Model/ }));
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

beforeEach(() => {
  canvas.props = null;
  serveFiles();
});

afterEach(() => cleanup());

test('the page names itself and says what it is for, in the host page shell', async () => {
  show('/bim');
  assert.ok(await screen.findByRole('heading', { name: 'Building Models' }));
  assert.ok(screen.getByText(/drawn in the browser and coloured by the readings/));
});

test('the host convention folder is listed through host.contents when the URL names none', async () => {
  const { calls } = show('/bim');
  assert.ok(await screen.findByText(/2 IFC models/));
  assert.deepEqual(calls, ['common/models']);
  assert.ok(screen.getByRole('button', { name: 'Folder: common/models' }));
});

test('the folder is read from ?dir=, and from the configuration when ?dir= is absent', async () => {
  show('/bim?dir=projects/aarhus');
  assert.ok(await screen.findByText(/1 IFC model /));
  cleanup();
  show('/bim', { REACT_APP_EXT_BIM_MODELS_DIRECTORY: 'projects/aarhus' });
  assert.ok(await screen.findByText(/1 IFC model /));
});

test('a folder that could leave the library is refused and never listed', async () => {
  const { calls } = show('/bim?dir=projects/%2e%2e/secret');
  assert.ok(await screen.findByText(/is not a folder in your library/));
  assert.ok(screen.getByRole('button', { name: 'Folder: common/models' }));
  assert.deepEqual(calls, []);
});

test('a model the folder does not hold is named', async () => {
  show('/bim/models/gone?dir=common/models');
  assert.ok(await screen.findByText('No model named gone in common/models'));
});

test('choosing a model from the menu moves to its route and draws it', async () => {
  const user = userEvent.setup();
  show('/bim');
  await screen.findByText(/2 IFC models/);
  await choose(user, 'office-b');
  assert.equal(location(), '/bim/models/office-b?dir=common/models');
  assert.match((await screen.findByTestId('canvas')).dataset.url, /office-b\.ifc$/);
});

test('a folder chosen in the directory picker moves to its route', async () => {
  const user = userEvent.setup();
  show('/bim');
  await screen.findByText(/2 IFC models/);
  await user.click(screen.getByRole('button', { name: 'Folder: common/models' }));
  await user.click(await screen.findByRole('button', { name: 'Up' }));
  await user.click(await screen.findByRole('button', { name: 'Up' }));
  await user.click(await screen.findByRole('button', { name: 'projects' }));
  await user.click(await screen.findByRole('button', { name: 'aarhus' }));
  await user.click(screen.getByRole('button', { name: 'Use this folder' }));
  assert.equal(location(), '/bim?dir=projects/aarhus');
});

test('a conversion is stored beside its IFC file through the host, and the page says so', async () => {
  const { host } = show('/bim/models/hospital-a?dir=common/models');
  await screen.findByTestId('canvas');
  const glb = new Uint8Array([1, 2, 3]);
  await act(async () => canvas.props.onConverted(glb));
  assert.deepEqual(host.contents.files.get('common/models/hospital-a.glb'), glb);
  assert.ok(await screen.findByText(/Stored in the library/));
});

/** hospital-a open and ready, with its one sensor card waiting for a reading. */
async function showHospitalA() {
  const { host } = show('/bim/models/hospital-a?dir=common/models');
  await screen.findByTestId('canvas');
  const view = new SceneView(new Group(), { storeys: [], objects: {} });
  await act(async () => canvas.props.onReady({
    view, frame: () => {}, look: () => {}, drawField: () => {},
  }));
  await screen.findByText('Waiting');
  return host;
}

const emit = (host, value) => act(() => {
  host.signals.emit({ twinId: 'h', signalPath: TOPIC, channel: 'measured', ts: Date.now(), value });
});

test('a reading pushed through host.signals reaches the sensor card of its binding', async () => {
  const host = await showHospitalA();
  emit(host, 21.5);
  assert.ok(await screen.findByText('21.5 °C'));
});

test('a connection that goes down marks the card not live and keeps the value', async () => {
  const host = await showHospitalA();
  emit(host, 21.5);
  await screen.findByText('21.5 °C');
  act(() => host.signals.setConnection('down'));
  assert.ok(await screen.findByText(/not live/));
  assert.ok(screen.getByText('21.5 °C'));
});
