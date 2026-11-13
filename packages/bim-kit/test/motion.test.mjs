/**
 * Tests for the motion: the camera flying to a new shot and the pulse of a
 * sensor marker when it is picked.
 *
 * Both run on a clock the test passes in, so nothing waits for real time.
 */

import './support/dom.mjs';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { BoxGeometry, Group, Mesh, PerspectiveCamera, Vector3 } from 'three';
import {
  FLIGHT_MS, PULSE_GROWTH, PULSE_MS, createFlight, createMarkers, ease, pulseFactor,
} from '../dist/esm/viewer/index.js';

function rig() {
  const camera = new PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  let updates = 0;
  const controls = { target: new Vector3(), update: () => { updates += 1; } };
  return { camera, controls, updates: () => updates };
}

const moveTo = (camera, controls) => () => {
  camera.position.set(20, 0, 10);
  controls.target.set(20, 0, 0);
};

describe('ease', () => {
  test('starts at 0, ends at 1 and is half way at the middle', () => {
    assert.equal(ease(0), 0);
    assert.equal(ease(1), 1);
    assert.equal(ease(0.5), 0.5);
    assert.equal(ease(-1), 0);
    assert.equal(ease(2), 1);
  });

  test('starts and ends slowly', () => {
    assert.ok(ease(0.1) < 0.1);
    assert.ok(ease(0.9) > 0.9);
  });
});

describe('createFlight', () => {
  test('keeps the camera where it was, then flies to where the change put it', () => {
    const { camera, controls } = rig();
    const flight = createFlight(camera, controls, FLIGHT_MS, false);
    flight.fly(moveTo(camera, controls), 1000);
    assert.equal(flight.flying, true);
    assert.deepEqual(camera.position.toArray(), [0, 0, 10]);
    flight.step(1000 + FLIGHT_MS / 2);
    assert.ok(Math.abs(camera.position.x - 10) < 1e-9);
    assert.ok(Math.abs(controls.target.x - 10) < 1e-9);
    assert.equal(flight.step(1000 + FLIGHT_MS), false);
    assert.deepEqual(camera.position.toArray(), [20, 0, 10]);
    assert.deepEqual(controls.target.toArray(), [20, 0, 0]);
  });

  test('jumps for a person who asked to reduce motion', () => {
    const { camera, controls } = rig();
    const flight = createFlight(camera, controls, FLIGHT_MS, true);
    flight.fly(moveTo(camera, controls), 0);
    assert.equal(flight.flying, false);
    assert.deepEqual(camera.position.toArray(), [20, 0, 10]);
  });

  test('stops where it is when the view is grabbed', () => {
    const { camera, controls } = rig();
    const flight = createFlight(camera, controls, FLIGHT_MS, false);
    flight.fly(moveTo(camera, controls), 0);
    flight.step(FLIGHT_MS / 2);
    flight.cancel();
    const there = camera.position.clone();
    assert.equal(flight.step(FLIGHT_MS), false);
    assert.ok(camera.position.equals(there));
  });

  test('does not fly when the change moves nothing', () => {
    const { camera, controls } = rig();
    const flight = createFlight(camera, controls, FLIGHT_MS, false);
    flight.fly(() => undefined, 0);
    assert.equal(flight.flying, false);
  });
});

describe('the pulse of a picked marker', () => {
  test('grows once and settles back', () => {
    assert.equal(pulseFactor(0), 1);
    assert.ok(Math.abs(pulseFactor(PULSE_MS / 2) - (1 + PULSE_GROWTH)) < 1e-9);
    assert.equal(pulseFactor(PULSE_MS), 1);
    assert.equal(pulseFactor(-5), 1);
    assert.equal(pulseFactor(Number.NaN), 1);
  });

  function markers() {
    const model = new Group();
    const objects = ['a', 'b'].map((globalId, i) => {
      const node = new Mesh(new BoxGeometry(1, 1, 1));
      node.position.set(i * 10, 0, 0);
      model.add(node);
      return {
        binding: {
          selector: { globalId }, id: `S${i}`, label: `S${i}`,
          source: { live: { transport: 'mqtt', topic: `t/${i}` } }, display: { unit: '°C' },
        },
        object: { node },
      };
    });
    model.updateMatrixWorld(true);
    const set = createMarkers(model, objects, document.createElement('div'), 60);
    const camera = new PerspectiveCamera(45, 1.5, 0.1, 5000);
    camera.position.set(5, 0, 400);
    camera.lookAt(5, 0, 0);
    // A marker is named by its sensor's id, and selected by its object's GlobalId.
    const dot = (globalId) => model.getObjectByName(`marker:S${globalId === 'a' ? 0 : 1}`);
    return { set, camera, dot };
  }

  test('pulses the marker a person picks, and only that one', () => {
    const { set, camera, dot } = markers();
    const all = () => true;
    set.place(camera, 900, 600, 'a', all, 0);
    const resting = dot('a').scale.x;
    set.place(camera, 900, 600, 'a', all, PULSE_MS / 2);
    assert.ok(Math.abs(dot('a').scale.x / resting - (1 + PULSE_GROWTH)) < 1e-6);
    const other = dot('b').scale.x;
    set.place(camera, 900, 600, 'a', all, PULSE_MS);
    assert.ok(Math.abs(dot('a').scale.x - resting) < 1e-9);
    assert.ok(Math.abs(dot('b').scale.x - other) < 1e-9);
  });

  test('pulses again when another marker is picked', () => {
    const { set, camera, dot } = markers();
    const all = () => true;
    set.place(camera, 900, 600, 'a', all, 0);
    set.place(camera, 900, 600, 'b', all, 5000);
    const resting = dot('b').scale.x;
    set.place(camera, 900, 600, 'b', all, 5000 + PULSE_MS / 2);
    assert.ok(dot('b').scale.x > resting);
  });
});

describe('going to a sensor from the view', () => {
  function scene(onPick) {
    const model = new Group();
    const objects = ['a', 'b'].map((globalId, i) => {
      const node = new Mesh(new BoxGeometry(1, 1, 1));
      node.position.set(i * 10, 0, 0);
      model.add(node);
      return {
        binding: {
          selector: { globalId }, id: `S${i}`, label: `S${i}`,
          source: { live: { transport: 'mqtt', topic: `t/${i}` } }, display: { unit: '°C' },
        },
        object: { node },
      };
    });
    model.updateMatrixWorld(true);
    const overlay = document.createElement('div');
    const set = createMarkers(model, objects, overlay, 60, onPick);
    const camera = new PerspectiveCamera(45, 1.5, 0.1, 5000);
    camera.position.set(5, 0, 40);
    camera.lookAt(5, 0, 0);
    camera.updateMatrixWorld();
    set.place(camera, 900, 600, null, () => true, 0);
    model.updateMatrixWorld(true);
    return { set, camera, overlay, model };
  }

  test('a click on a label picks its sensor and goes no further', () => {
    const picked = [];
    const { overlay } = scene((id) => picked.push(id));
    const label = [...overlay.querySelectorAll('[data-bim-label]')].find((el) => el.title === 'S1');
    assert.equal(label.style.pointerEvents, 'auto');
    let reachedViewer = false;
    overlay.addEventListener('click', () => { reachedViewer = true; });
    label.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.deepEqual(picked, ['b']);
    assert.equal(reachedViewer, false);
  });

  test('a label stays out of the way when nothing goes to the sensor', () => {
    const { overlay } = scene(undefined);
    const label = overlay.querySelector('[data-bim-label]');
    assert.notEqual(label.style.pointerEvents, 'auto');
  });

  test('a ray through a dot picks that sensor, a ray past them picks none', async () => {
    const { Raycaster, Vector2 } = await import('three');
    const { set, camera } = scene(() => undefined);
    const ray = new Raycaster();
    const through = (x, y, z) => {
      const point = new Vector3(x, y, z).project(camera);
      ray.setFromCamera(new Vector2(point.x, point.y), camera);
      return set.pick(ray);
    };
    assert.equal(through(10, 0, 0), 'b');
    assert.equal(through(0, 0, 0), 'a');
    assert.equal(through(5, 8, 0), null);
  });
});
