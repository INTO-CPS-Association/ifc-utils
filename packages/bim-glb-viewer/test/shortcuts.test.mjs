/**
 * Tests for the shortcut table.
 *
 * The table binds the keys, builds the toolbar and writes the help. Most of what can go wrong is a mismatch between those three, so most of these check the table itself rather than any one action.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { SceneView, SHORTCUTS, handleKey } from '../dist/esm/viewer/index.js';

function view() {
  const model = new Group();
  const mesh = new Mesh(new BoxGeometry(1, 3, 1), new MeshStandardMaterial());
  mesh.userData.globalId = 'w1';
  mesh.userData.ifcClass = 'IfcWall';
  model.add(mesh);
  model.updateMatrixWorld(true);
  return new SceneView(model, {
    storeys: [{ name: 'L1' }],
    objects: { w1: { ifcClass: 'IfcWall', storey: 'L1' } },
  });
}

function context(scene) {
  const calls = [];
  return [{
    view: scene,
    // No bindings, which is the ordinary case: most models declare no sensors.
    bindings: [],
    refresh: () => calls.push('refresh'),
    frame: () => calls.push('frame'),
    look: (from) => calls.push(`look:${from}`),
    hovered: () => 'w1',
    toggleHelp: () => calls.push('help'),
    toggleFullscreen: () => calls.push('fullscreen'),
  }, calls];
}

function press(key, scene) {
  const [ctx, calls] = context(scene);
  const handled = handleKey({ key, target: { tagName: 'BODY' } }, ctx);
  return { handled, calls };
}

test('no two shortcuts share a key', () => {
  const keys = SHORTCUTS.map((entry) => entry.key);

  assert.equal(new Set(keys).size, keys.length);
});

test('every shortcut has a label, an icon and something to run', () => {
  for (const entry of SHORTCUTS) {
    assert.ok(entry.label, `${entry.key} needs a label`);
    assert.ok(entry.icon, `${entry.key} needs an icon`);
    assert.equal(typeof entry.run, 'function');
  }
});

test('a label reads as a label, not as a sentence', () => {
  for (const entry of SHORTCUTS) {
    assert.match(entry.label, /^[A-Z]/, `${entry.key}: ${entry.label}`);
    assert.doesNotMatch(entry.label, /\.$/, `${entry.key}: ${entry.label}`);
  }
});

test('a toggle says whether it is on and an action does not', () => {
  const scene = view();
  for (const entry of SHORTCUTS) {
    if (entry.on) assert.equal(typeof entry.on(scene), 'boolean', entry.key);
  }
  assert.equal(SHORTCUTS.find((e) => e.key === 'f').on, undefined,
    'fitting the model is an action, so its button should never light up');
});

test('the transparency key turns transparency on and off', () => {
  const scene = view();

  press('t', scene);
  assert.equal(scene.state.transparent, true);
  press('t', scene);
  assert.equal(scene.state.transparent, false);
});

test('the heatmap key cycles only through scopes the readings divide', () => {
  // No bindings, so nothing divides by room or storey and only the two that
  // are always offered remain.
  const scene = view();
  const seen = [];
  for (let i = 0; i < 3; i += 1) {
    press('m', scene);
    seen.push(scene.state.heat);
  }

  assert.deepEqual(seen, ['building', 'off', 'building']);
});

test('the reset key undoes the toggles and asks for the default view', () => {
  const scene = view();
  scene.state.transparent = true;
  const { calls } = press('r', scene);

  assert.equal(scene.state.transparent, false);
  assert.ok(calls.includes('look:corner'));
});

test('hiding what is under the cursor hides it, and the next key brings it back', () => {
  const scene = view();
  press('q', scene);
  assert.equal(scene.meshes.get('w1').visible, false);

  press('w', scene);
  assert.equal(scene.meshes.get('w1').visible, true);
});

test('an unbound key is left alone', () => {
  assert.equal(press('z', view()).handled, false);
});

test('a key with a modifier belongs to the browser, not to us', () => {
  const scene = view();
  const [ctx] = context(scene);

  assert.equal(handleKey({ key: 't', metaKey: true, target: { tagName: 'BODY' } }, ctx), false);
  assert.equal(scene.state.transparent, false);
});

test('typing in a field is typing, not a shortcut', () => {
  // A viewer that swallows the letter t from a search box is a viewer nobody
  // can search in.
  const scene = view();
  const [ctx] = context(scene);

  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(handleKey({ key: 't', target: { tagName } }, ctx), false);
  }
  assert.equal(handleKey({ key: 't', target: { tagName: 'DIV', isContentEditable: true } }, ctx), false);
  assert.equal(scene.state.transparent, false);
});

test('an upper case key press still works', () => {
  const scene = view();
  const [ctx] = context(scene);
  handleKey({ key: 'T', target: { tagName: 'BODY' } }, ctx);

  assert.equal(scene.state.transparent, true);
});
