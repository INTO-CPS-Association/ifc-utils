/**
 * Tests for the styles a model is painted in and the backgrounds behind it.
 *
 * The painting rules are the one place that decides what an object looks
 * like, so each style is checked against the rules that must still win over
 * it: the selection, and a heatmap.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import {
  BACKDROPS, CLASS_COLOURS, MONO_COLOUR, SHORTCUTS, SceneView,
} from '../dist/esm/viewer/index.js';

const key = (letter) => SHORTCUTS.find((shortcut) => shortcut.key === letter);
const press = (letter, view) => key(letter).run({ view, refresh: () => view.refresh() });

function building() {
  const group = new Group();
  const own = new MeshStandardMaterial({ color: 0x123456 });
  for (const [id, ifcClass] of [['w1', 'IfcWall'], ['w2', 'IfcWall'], ['d1', 'IfcDoor']]) {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), own);
    mesh.userData.globalId = id;
    mesh.userData.ifcClass = ifcClass;
    group.add(mesh);
  }
  group.updateMatrixWorld(true);
  const view = new SceneView(group);
  view.refresh();
  return { view, own };
}

const colourOf = (view, id) => view.meshes.get(id).material.color.getHex();

describe('the styles', () => {
  test('shaded keeps the colours the model came with', () => {
    const { view, own } = building();
    assert.equal(view.meshes.get('w1').material, own);
    assert.equal(key('y').on(view), false);
  });

  test('y cycles single colour, by class, wireframe and back, and names each', () => {
    const { view, own } = building();
    press('y', view);
    assert.deepEqual([colourOf(view, 'w1'), key('y').badge(view)], [MONO_COLOUR, 'Single Colour']);
    press('y', view);
    // Classes sorted: IfcDoor first, IfcWall second.
    assert.deepEqual([colourOf(view, 'd1'), colourOf(view, 'w1')], [CLASS_COLOURS[0], CLASS_COLOURS[1]]);
    assert.equal(colourOf(view, 'w1'), colourOf(view, 'w2'));
    assert.equal(key('y').badge(view), 'By Class');
    press('y', view);
    assert.equal(view.meshes.get('w1').material.wireframe, true);
    assert.equal(key('y').badge(view), 'Wireframe');
    press('y', view);
    assert.equal(view.meshes.get('w1').material, own);
  });

  test('the legend shows the class colours in the colour by class style', () => {
    const { view } = building();
    view.state.style = 'classes';
    const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
    assert.deepEqual([...view.classColours()], [['IfcDoor', hex(CLASS_COLOURS[0])], ['IfcWall', hex(CLASS_COLOURS[1])]]);
  });

  test('the selection still wins over any style', () => {
    const { view } = building();
    view.state.style = 'mono';
    view.state.selected = 'w1';
    view.refresh();
    assert.notEqual(colourOf(view, 'w1'), MONO_COLOUR);
    assert.equal(colourOf(view, 'w2'), MONO_COLOUR);
  });

  test('a wireframe copy is made once per material and reset puts the style back', () => {
    const { view, own } = building();
    view.state.style = 'wireframe';
    view.refresh();
    assert.equal(view.meshes.get('w1').material, view.meshes.get('w2').material);
    view.reset();
    assert.equal(view.meshes.get('w1').material, own);
  });
});

describe('the backgrounds', () => {
  test('z cycles dim, slate, ink and back to light, which is the colour the viewer always had', () => {
    const { view } = building();
    assert.equal(BACKDROPS.light, 0xe9edef);
    const seen = [];
    for (let i = 0; i < 4; i += 1) {
      press('z', view);
      seen.push([view.state.backdrop, key('z').badge(view)]);
    }
    assert.deepEqual(seen, [['dim', 'Dim'], ['slate', 'Slate'], ['ink', 'Ink'], ['light', 'Light']]);
    press('z', view);
    view.reset();
    assert.equal(view.state.backdrop, 'light');
  });
});

describe('what the heatmap colours', () => {
  test('never the site, in any scope', () => {
    const group = new Group();
    const own = new MeshStandardMaterial({ color: 0x00aa00 });
    for (const [id, ifcClass] of [['w1', 'IfcWall'], ['site', 'IfcSite'], ['tree', 'IfcGeographicElement']]) {
      const mesh = new Mesh(new BoxGeometry(1, 1, 1), own);
      mesh.userData.globalId = id;
      mesh.userData.ifcClass = ifcClass;
      group.add(mesh);
    }
    group.updateMatrixWorld(true);
    const view = new SceneView(group);
    const bindings = [{
      selector: { globalId: 'w1' }, label: 'w1',
      source: { live: { transport: 'mqtt', topic: 't/w1' } }, display: { unit: '°C', ramp: [18, 26] },
    }];
    view.state.heat = 'building';
    view.applyReadings(bindings, new Map([['w1', { value: 25, receivedAt: Date.now() }]]), 'live');
    view.refresh();
    assert.notEqual(view.meshes.get('w1').material, own);
    assert.equal(view.meshes.get('site').material, own);
    assert.equal(view.meshes.get('tree').material, own);
  });

  test('wins over every style', () => {
    const group = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    mesh.userData.globalId = 'w1';
    mesh.userData.ifcClass = 'IfcWall';
    group.add(mesh);
    group.updateMatrixWorld(true);
    const view = new SceneView(group);
    const bindings = [{
      selector: { globalId: 'w1' }, label: 'w1',
      source: { live: { transport: 'mqtt', topic: 't/w1' } }, display: { unit: '°C', ramp: [18, 26] },
    }];
    view.state.heat = 'building';
    view.applyReadings(bindings, new Map([['w1', { value: 25, receivedAt: Date.now() }]]), 'live');
    view.refresh();
    const heat = mesh.material.color.getHex();
    for (const style of ['mono', 'classes', 'wireframe']) {
      view.state.style = style;
      view.refresh();
      assert.equal(mesh.material.color.getHex(), heat, style);
    }
  });
});
