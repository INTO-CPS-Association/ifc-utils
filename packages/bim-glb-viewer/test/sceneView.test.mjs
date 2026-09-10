/**
 * Tests for what a loaded model looks like and what is visible.
 *
 * three.js builds a scene graph without a canvas, so all of this runs in Node. Only drawing needs WebGL, and nothing here draws.
 *
 * The two invariants under test were both bought with bugs: one place decides the material, one place writes `visible`. When several wrote either, the last to run won, and which ran last depended on the order readings arrived.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { SceneView } from '../dist/esm/viewer/index.js';

const NOW = 1_800_000_000_000;

/** A box of the given size, at the given height, carrying an identity. */
function object(globalId, ifcClass, y, height = 3) {
  const mesh = new Mesh(new BoxGeometry(1, height, 1), new MeshStandardMaterial());
  mesh.position.set(0, y + height / 2, 0);
  mesh.userData.globalId = globalId;
  mesh.userData.ifcClass = ifcClass;
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** Two floors: a wall and a slab on each. */
function building() {
  const model = new Group();
  for (const mesh of [
    object('w1', 'IfcWall', 0), object('s1', 'IfcSlab', 3, 0.3),
    object('w2', 'IfcWall', 3.3), object('s2', 'IfcSlab', 6.3, 0.3),
  ]) model.add(mesh);
  model.updateMatrixWorld(true);

  const tree = {
    storeys: [{ name: 'L1' }, { name: 'L2' }],
    rooms: [{ name: 'R1' }],
    objects: {
      w1: { ifcClass: 'IfcWall', storey: 'L1', room: 'R1' },
      s1: { ifcClass: 'IfcSlab', storey: 'L1' },
      w2: { ifcClass: 'IfcWall', storey: 'L2' },
      s2: { ifcClass: 'IfcSlab', storey: 'L2' },
    },
  };
  return new SceneView(model, tree);
}

function binding(globalId, ramp = [4, 16]) {
  return {
    selector: { globalId },
    label: globalId,
    source: { live: { transport: 'mqtt', topic: `t/${globalId}` } },
    display: { unit: '°C', ramp },
  };
}

test('finds every object that carries a GlobalId', () => {
  const view = building();

  assert.deepEqual([...view.meshes.keys()].sort(), ['s1', 's2', 'w1', 'w2']);
});

test('an object with no GlobalId is not tracked, since nothing can bind to it', () => {
  const model = new Group();
  model.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()));
  model.updateMatrixWorld(true);

  assert.equal(new SceneView(model).meshes.size, 0);
});

test('the floors come from the measured geometry', () => {
  assert.deepEqual(building().storeys, ['L1', 'L2']);
});

test('a model with no storeys offers none instead of inventing one', () => {
  const model = new Group();
  model.add(object('a', 'IfcWall', 0));
  model.updateMatrixWorld(true);

  assert.deepEqual(new SceneView(model, { objects: { a: {} } }).storeys, []);
});

test('everything is visible until a floor is chosen', () => {
  const view = building();
  view.refreshVisibility();

  assert.equal([...view.meshes.values()].every((m) => m.visible), true);
});

test('choosing a floor hides what is not on it', () => {
  const view = building();
  view.state.storey = 'L2';
  view.refreshVisibility();

  assert.equal(view.meshes.get('w2').visible, true);
  assert.equal(view.meshes.get('w1').visible, false);
});

test('the lid comes off but the floor stays', () => {
  // Hiding every slab takes the floor as well, which leaves the furniture
  // standing on nothing and is worse than the lid.
  const view = building();
  view.state.storey = 'L1';
  view.state.slabsHidden = true;
  view.refreshVisibility();

  assert.equal(view.meshes.get('s1').visible, false, 'the lid above L1 should go');
  assert.equal(view.meshes.get('w1').visible, true);
});

test('with no floor chosen the lid toggle is all or nothing', () => {
  const view = building();
  view.state.slabsHidden = true;
  view.refreshVisibility();

  assert.equal(view.meshes.get('s1').visible, false);
  assert.equal(view.meshes.get('s2').visible, false);
});

test('an object hidden by hand comes back in the order it went', () => {
  const view = building();
  view.hide('w1');
  view.hide('w2');
  assert.equal(view.meshes.get('w2').visible, false);

  view.restoreLastHidden();
  assert.equal(view.meshes.get('w2').visible, true);
  assert.equal(view.meshes.get('w1').visible, false);
});

test('hiding the same object twice does not need two restores', () => {
  const view = building();
  view.hide('w1');
  view.hide('w1');
  view.restoreLastHidden();

  assert.equal(view.meshes.get('w1').visible, true);
});

test('selection wins over hover, and hover over the heatmap', () => {
  const view = building();
  view.state.selected = 'w1';
  view.state.hovered = 'w1';
  view.refreshMaterials();
  const selected = view.meshes.get('w1').material;

  view.state.selected = null;
  view.refreshMaterials();

  assert.notEqual(view.meshes.get('w1').material, selected);
});

test('hover changes nothing while hover highlighting is off', () => {
  // Reading a heatmap with a colour following the cursor is unreadable.
  const view = building();
  view.refreshMaterials();
  const before = view.meshes.get('w1').material;

  view.state.hoverHighlight = false;
  view.state.hovered = 'w1';
  view.refreshMaterials();

  assert.equal(view.meshes.get('w1').material, before);
});

test('the heatmap colours by zone, and two objects in one zone share a material', () => {
  const view = building();
  view.state.heat = 'storey';
  view.applyReadings([binding('w1')], new Map([['w1', { value: 10, receivedAt: NOW }]]),
    'live', 30, NOW);
  view.refreshMaterials();

  assert.equal(view.meshes.get('w1').material, view.meshes.get('s1').material,
    'both are on L1, so both take the L1 colour');
  assert.notEqual(view.meshes.get('w2').material, view.meshes.get('w1').material,
    'L2 has no reading, so it keeps its own colour');
});

test('stale readings leave every object in its own colour', () => {
  // A heatmap of stale values is a confident wrong answer.
  const view = building();
  view.refreshMaterials();
  const own = view.meshes.get('w1').material;

  view.state.heat = 'storey';
  view.applyReadings([binding('w1')],
    new Map([['w1', { value: 10, receivedAt: NOW - 600_000 }]]), 'live', 30, NOW);
  view.refreshMaterials();

  assert.equal(view.meshes.get('w1').material, own);
});

test('transparency reaches the shell and leaves everything else alone', () => {
  const view = building();
  view.refreshMaterials();
  const wall = view.meshes.get('w1').material;

  view.state.transparent = true;
  view.refreshMaterials();

  assert.notEqual(view.meshes.get('w1').material, wall);
  assert.equal(view.meshes.get('w1').material.opacity < 1, true);
});

test('resetting puts a model back to how it opened', () => {
  const view = building();
  view.state.storey = 'L2';
  view.state.transparent = true;
  view.state.slabsHidden = true;
  view.hide('w1');
  view.reset();

  assert.equal(view.state.storey, null);
  assert.equal([...view.meshes.values()].every((m) => m.visible), true);
});

test('a scope the readings do not divide is not offered', () => {
  // Two sensors on two storeys and in one room. Grouping by storey separates
  // them and grouping by room does not, so only one of the two is offered.
  const view = building();
  const bind = (globalId) => ({
    selector: { globalId },
    label: globalId,
    source: { live: { transport: 'mqtt', topic: `t/${globalId}` } },
    display: { unit: 'C', ramp: [0, 1] },
  });

  assert.deepEqual(view.scopesFor([bind('w1'), bind('w2')]), ['off', 'storey', 'building']);
  assert.deepEqual(view.scopesFor([bind('w1')]), ['off', 'building']);
});

describe('sizeOf', () => {
  test('measures the object from its geometry, in metres', () => {
    // The tree does not carry a size, so this comes from the mesh. Y is the
    // height, because the scene is Y up.
    const size = building().sizeOf('w1');

    assert.equal(size.x, 1);
    assert.equal(size.y, 3);
    assert.equal(size.z, 1);
  });

  test('says nothing about an object that is not in the model', () => {
    // A manifest can name an object the geometry does not have, and a size of
    // zero would read as a real measurement of a flat thing.
    assert.equal(building().sizeOf('not-here'), undefined);
  });
});

describe('highlightedClass', () => {
  test('lights every object of the class and nothing else', () => {
    // The question in front of a grey building is "where are the columns",
    // and a legend that only names colours does not answer it.
    const view = building();
    view.state.highlightedClass = 'IfcWall';
    view.refreshMaterials();

    const material = (id) => view.meshes.get(id).material;
    assert.equal(material('w1'), material('w2'));
    assert.notEqual(material('w1'), material('s1'));
  });

  test('the selection still wins, so pointing at one object says which', () => {
    const view = building();
    view.state.highlightedClass = 'IfcWall';
    view.state.selected = 'w1';
    view.refreshMaterials();

    assert.notEqual(view.meshes.get('w1').material, view.meshes.get('w2').material);
  });

  test('clearing it puts every object back in its own colour', () => {
    const view = building();
    const before = view.meshes.get('w1').material;
    view.state.highlightedClass = 'IfcWall';
    view.refreshMaterials();
    view.state.highlightedClass = null;
    view.refreshMaterials();

    assert.equal(view.meshes.get('w1').material, before);
  });
});
