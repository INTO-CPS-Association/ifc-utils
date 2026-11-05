/**
 * Tests for what the building models page does with sensors: comparing the
 * model file with the manifest's hash, picking a sensor from its card and
 * the staleness limit a host sets.
 *
 * The canvas is the stand-in of `support/canvas.mjs`, which records its props
 * so a test can hand the page the bytes or the viewer the real canvas would.
 */

import './support/dom.mjs';
import { canvas, mockCanvas } from './support/canvas.mjs';

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoxGeometry, Group, Mesh } from 'three';
import { SceneView } from '../dist/esm/viewer/index.js';

mockCanvas();

const { BuildingModels } = await import('../dist/esm/react/BuildingModels.js');

const LIBRARY = 'http://host/jane/';
const IFC = `DATA;
#1= IFCPROJECT('0b5j3C6_v5kA2vi1RMUzh5',$,'Room 204',$,$,$,$,(#10),#5);`;
const IFC_HASH = createHash('sha256').update(IFC).digest('hex');
const SENSOR = 'r204TempSensor00000001';

const manifest = (hash) => ({
  model: { source: 'room.ifc', source_sha256: hash, converter: 'test' },
  bindings: [{
    selector: { globalId: SENSOR },
    id: 'T1',
    label: 'Room 204 temperature',
    source: { live: { transport: 'mqtt', topic: 'r204/temp' } },
    display: { unit: '°C', ramp: [18, 26] },
  }],
});

/** A folder holding room.ifc, its manifest and, when asked, stored geometry. */
function library({ hash, glb = false }) {
  const files = { 'm/room.ifc': IFC, 'm/room.manifest.json': JSON.stringify(manifest(hash)) };
  if (glb) files['m/room.glb'] = 'glTF';
  const fetched = [];
  globalThis.fetch = async (url) => {
    const path = decodeURIComponent(String(url).slice(`${LIBRARY}files/`.length));
    fetched.push(path);
    if (!(path in files)) return new Response('', { status: 404 });
    const type = path.endsWith('.json') ? 'application/json' : 'text/plain';
    return new Response(files[path], { headers: { 'content-type': type } });
  };
  const list = async () => Object.keys(files).map((path) => ({
    name: path.slice(2), path, size: files[path].length,
  }));
  return { list, fetched };
}

function show(props) {
  return render(React.createElement(BuildingModels, {
    libraryUrl: LIBRARY, directory: 'm', selected: 'room', ...props,
  }));
}

/** Let the listing, the manifest and any hash settle. */
const settle = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, 30); }); });

beforeEach(() => { canvas.props = null; });
afterEach(cleanup);

test('a manifest that records its hash as unknown gets a quiet note and no alert', async () => {
  const { list } = library({ hash: 'unknown' });
  show({ list });
  assert.ok(await screen.findByText(/records no hash of its model/));
  assert.equal(screen.queryByText(/not the one the sensor manifest/), null);
});

test('the IFC bytes the canvas converts are hashed and a match says nothing', async () => {
  const { list, fetched } = library({ hash: IFC_HASH });
  show({ list });
  await screen.findByTestId('canvas');
  await settle();
  await act(async () => canvas.props.onSourceBytes(new TextEncoder().encode(IFC)));
  await settle();
  assert.equal(screen.queryByText(/not the one the sensor manifest was written for/), null);
  // Converted here, so the page never fetched the whole file a second time.
  assert.equal(fetched.filter((path) => path === 'm/room.ifc').length, 1);
});

test('converted bytes that differ from the manifest raise an alert naming both hashes', async () => {
  const { list } = library({ hash: IFC_HASH });
  show({ list });
  await screen.findByTestId('canvas');
  await settle();
  await act(async () => canvas.props.onSourceBytes(new TextEncoder().encode(`${IFC}\n`)));
  const alert = await screen.findByText(/not the one the sensor manifest was written for/);
  assert.ok(alert.closest('[role="alert"]'));
  assert.ok(screen.getByText(new RegExp(IFC_HASH.slice(0, 12))));
});

test('with stored geometry the IFC file is fetched and hashed for the check', async () => {
  const { list, fetched } = library({ hash: '0'.repeat(64), glb: true });
  show({ list });
  assert.ok(await screen.findByText(/not the one the sensor manifest was written for/));
  assert.ok(fetched.includes('m/room.ifc'));
  assert.match(canvas.props.url, /room\.glb$/);
});

test('with stored geometry and a matching hash the page says nothing', async () => {
  const { list } = library({ hash: IFC_HASH, glb: true });
  show({ list });
  await screen.findByTestId('canvas');
  await settle();
  assert.equal(screen.queryByText(/not the one the sensor manifest/), null);
  assert.equal(screen.queryByText(/was not compared/), null);
});

/** The canvas reports ready with a real view and a handle that records. */
async function viewerReady() {
  const model = new Group();
  const mesh = new Mesh(new BoxGeometry(1, 1, 1));
  mesh.userData.globalId = SENSOR;
  model.add(mesh);
  const view = new SceneView(model, { storeys: [], objects: {} });
  const calls = { framed: 0, shown: [] };
  await act(async () => canvas.props.onReady({
    view,
    frame: () => {},
    look: () => {},
    drawField: () => {},
    frameSelection: () => { calls.framed += 1; },
    showReadings: (readings, feed, staleAfter) => calls.shown.push(staleAfter),
  }));
  return { view, calls };
}

test('clicking a sensor card selects its object and frames it', async () => {
  const { list } = library({ hash: 'unknown' });
  const user = userEvent.setup();
  show({ list });
  await screen.findByTestId('canvas');
  const { view, calls } = await viewerReady();
  await user.click(await screen.findByText('Room 204 temperature'));
  assert.equal(view.state.selected, SENSOR);
  assert.equal(calls.framed, 1);
});

test('the selection key frames the selection', async () => {
  const { list } = library({ hash: 'unknown' });
  const user = userEvent.setup();
  show({ list });
  await screen.findByTestId('canvas');
  const { calls } = await viewerReady();
  await user.keyboard('s');
  assert.equal(calls.framed, 1);
});

/** A reading stamped 45 s ago, as from a controller whose clock runs late. */
const late = () => new Map([[SENSOR, { value: 21.5, receivedAt: Date.now() - 45_000 }]]);

test('by default a reading 45 s old is not live on its card', async () => {
  const { list } = library({ hash: 'unknown' });
  show({ list, readings: late(), feed: 'live' });
  await screen.findByTestId('canvas');
  const { calls } = await viewerReady();
  assert.ok(await screen.findByText(/45 s ago, not live/));
  assert.ok(calls.shown.includes(30));
});

test('a host that raises the staleness limit keeps a 45 s old reading live everywhere', async () => {
  const { list } = library({ hash: 'unknown' });
  show({ list, readings: late(), feed: 'live', staleAfter: 90 });
  await screen.findByTestId('canvas');
  const { calls } = await viewerReady();
  assert.ok(await screen.findByText('updated 45 s ago'));
  assert.ok(calls.shown.includes(90));
});
