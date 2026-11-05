/**
 * Tests for the sensor markers and their labels.
 *
 * The scene objects are real three.js objects and the labels are elements of
 * a jsdom document. Nothing is drawn, so what is tested is what would be
 * drawn: the size of each dot, its colour and the text and place of its label.
 */

import './support/dom.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, PerspectiveCamera } from 'three';

import {
  createMarkers, labelText, markerColour, markerScale, toScreen, worldPerPixel,
  MARKER_MIN_PX, NO_READING_COLOUR, SELECTED_MARKER_MIN_PX, SELECTED_COLOUR,
} from '../dist/esm/viewer/index.js';
import { rampColour } from '../dist/esm/index.js';

const binding = (globalId, id) => ({
  selector: { globalId },
  id,
  label: `${id} temperature`,
  source: { live: { transport: 'mqtt', topic: `t/${id}` } },
  display: { unit: '°C', ramp: [18, 26] },
});

const fresh = (value) => ({ value, receivedAt: Date.now() });

/** A model of two objects with a marker on each and a camera far away. */
function scene() {
  const model = new Group();
  const objects = ['a', 'b'].map((globalId, i) => {
    const node = new Mesh(new BoxGeometry(1, 1, 1));
    node.position.set(i * 10, 0, 0);
    model.add(node);
    return { binding: binding(globalId, `S${i + 1}`), object: { node } };
  });
  model.updateMatrixWorld(true);
  const overlay = document.createElement('div');
  const markers = createMarkers(model, objects, overlay, 60);
  const camera = new PerspectiveCamera(45, 1.5, 0.1, 5000);
  camera.position.set(5, 0, 400);
  camera.lookAt(5, 0, 0);
  return { model, overlay, markers, camera };
}

const dots = (model) => model.children.filter((child) => child.name.startsWith('marker:'));

test('one pixel at a distance is the height seen at that distance over the screen height', () => {
  const seen = 2 * 100 * Math.tan((45 * Math.PI) / 360);
  assert.ok(Math.abs(worldPerPixel(100, 45, 800) - seen / 800) < 1e-12);
  assert.equal(worldPerPixel(100, 45, 0), 0);
});

test('a far marker is scaled up to its smallest size on screen, a near one is left alone', () => {
  const far = markerScale(0.1, 500, 45, 800, MARKER_MIN_PX);
  const pixels = (2 * 0.1 * far) / worldPerPixel(500, 45, 800);
  assert.ok(Math.abs(pixels - MARKER_MIN_PX) < 1e-9);
  assert.equal(markerScale(0.1, 1, 45, 800, MARKER_MIN_PX), 1);
});

test('a current value colours the marker on its ramp and anything else leaves it grey', () => {
  const sensor = binding('a', 'S1');
  assert.equal(markerColour(sensor, fresh(22), 'live'), rampColour(22, 18, 26));
  assert.equal(markerColour(sensor, undefined, 'live'), NO_READING_COLOUR);
  assert.equal(markerColour(sensor, fresh(22), 'down'), NO_READING_COLOUR);
  const old = { value: 22, receivedAt: Date.now() - 60_000 };
  assert.equal(markerColour(sensor, old, 'live', 30), NO_READING_COLOUR);
  assert.equal(markerColour(sensor, old, 'live', 90), rampColour(22, 18, 26));
});

test('a label names the sensor and says its value, or that it waits', () => {
  assert.equal(labelText(binding('a', 'S1'), fresh(21.54)), 'S1  21.5 °C');
  assert.equal(labelText(binding('a', 'S1'), undefined), 'S1  Waiting');
});

test('a projected point lands on the canvas in pixels and one behind the camera is hidden', () => {
  assert.deepEqual(toScreen({ x: 0, y: 0, z: 0.5 }, 800, 600), { x: 400, y: 300, visible: true });
  assert.deepEqual(toScreen({ x: -1, y: 1, z: 0 }, 800, 600), { x: 0, y: 0, visible: true });
  assert.equal(toScreen({ x: 0, y: 0, z: 1.2 }, 800, 600).visible, false);
});

test('every resolved binding gets a dot, a ring and a label', () => {
  const { model, overlay, markers } = scene();
  assert.equal(markers.count, 2);
  assert.equal(dots(model).length, 2);
  assert.equal(model.children.length, 2 + 4);
  assert.deepEqual([...overlay.children].map((label) => label.textContent),
    ['S1  Waiting', 'S2  Waiting']);
});

test('the selected marker is larger, in the selection colour and its label is marked', () => {
  const { model, overlay, markers, camera } = scene();
  markers.place(camera, 1200, 800, 'b', () => true);
  const [plain, picked] = dots(model);
  assert.ok(picked.scale.x > plain.scale.x);
  assert.ok(Math.abs(picked.scale.x / plain.scale.x - SELECTED_MARKER_MIN_PX / MARKER_MIN_PX) < 1e-6);
  assert.equal(picked.material.color.getHex(), SELECTED_COLOUR);
  assert.equal(plain.material.color.getHex(), NO_READING_COLOUR);
  const [first, second] = overlay.children;
  assert.equal(second.dataset.selected, 'true');
  assert.equal(first.dataset.selected, 'false');
  assert.ok(Number(second.style.zIndex) > Number(first.style.zIndex));
});

test('readings rewrite the labels and colour the dots', () => {
  const { model, overlay, markers, camera } = scene();
  markers.showReadings(new Map([['a', fresh(25)]]), 'live');
  markers.place(camera, 1200, 800, null, () => true);
  assert.equal(overlay.children[0].textContent, 'S1  25.0 °C');
  assert.equal(dots(model)[0].material.color.getHex(), rampColour(25, 18, 26));
  assert.equal(overlay.children[0].style.opacity, '1');
  assert.equal(overlay.children[1].style.opacity, '0.7');
});

test('a sensor whose object is hidden loses its dot and its label', () => {
  const { model, overlay, markers, camera } = scene();
  markers.place(camera, 1200, 800, null, (globalId) => globalId !== 'a');
  assert.equal(dots(model)[0].visible, false);
  assert.equal(overlay.children[0].style.display, 'none');
  assert.equal(overlay.children[1].style.display, 'block');
});

test('labels take their colours from the theme, with a fallback for a host with none', () => {
  const { overlay } = scene();
  const style = overlay.children[0].getAttribute('style');
  assert.match(style, /var\(--bim-label-bg,/);
  assert.match(style, /var\(--bim-label-fg,/);
});

test('disposing removes every label', () => {
  const { overlay, markers } = scene();
  markers.dispose();
  assert.equal(overlay.children.length, 0);
});
