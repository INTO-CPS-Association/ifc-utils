/**
 * Tests for the light, the shadows and the section plane.
 *
 * The room light and the occlusion pass need a graphics context, so they are
 * left to the browser. What is tested is the arithmetic that goes wrong
 * silently: a shadow camera that does not cover the building, a ground that
 * floats or sinks, a cut at the wrong height or one that never comes off.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  BoxGeometry, DirectionalLight, Group, Mesh, MeshStandardMaterial, Scene, Vector3,
} from 'three';
import {
  GROUND_DROP_M, SHADOW_MAP_PX, SHORTCUTS, SceneView, castShadows, createSection, CUT_M,
  prepareRenderer,
} from '../dist/esm/viewer/index.js';

/** A box of the given size with its base at `y`, carrying an identity. */
function box(globalId, ifcClass, y, size = [10, 3, 4]) {
  const mesh = new Mesh(new BoxGeometry(...size), new MeshStandardMaterial());
  mesh.position.set(0, y + size[1] / 2, 0);
  mesh.userData.globalId = globalId;
  mesh.userData.ifcClass = ifcClass;
  return mesh;
}

function model() {
  const group = new Group();
  group.add(box('w1', 'IfcWall', 2), box('w2', 'IfcWall', 5));
  group.updateMatrixWorld(true);
  return group;
}

describe('castShadows', () => {
  test('lets every object throw and take a shadow', () => {
    const group = model();
    castShadows(group, new DirectionalLight(), new Scene());
    group.traverse((node) => {
      if (!node.isMesh) return;
      assert.equal(node.castShadow, true);
      assert.equal(node.receiveShadow, true);
    });
  });

  test('puts the ground just under the lowest object, and takes it away again', () => {
    const scene = new Scene();
    const undo = castShadows(model(), new DirectionalLight(), scene);
    const ground = scene.getObjectByName('ground');
    assert.ok(ground);
    assert.ok(Math.abs(ground.position.y - (2 - GROUND_DROP_M)) < 1e-9);
    assert.equal(ground.receiveShadow, true);
    undo();
    assert.equal(scene.getObjectByName('ground'), undefined);
  });

  test('keeps the direction of the sun and fits its shadow to the model', () => {
    const sun = new DirectionalLight();
    sun.position.set(5, 10, 7);
    const before = sun.position.clone().normalize();
    castShadows(model(), sun, new Scene());

    // The model spans y 2 to 8, so its centre is at y 5.
    assert.deepEqual(sun.target.position.toArray(), [0, 5, 0]);
    const after = sun.position.clone().sub(sun.target.position).normalize();
    assert.ok(after.distanceTo(before) < 1e-9);
    assert.equal(sun.castShadow, true);
    assert.equal(sun.shadow.mapSize.x, SHADOW_MAP_PX);
    // Half of the largest side is 5 m, and the camera has to reach past it.
    assert.ok(sun.shadow.camera.right > 5);
    assert.ok(sun.shadow.camera.far > sun.position.distanceTo(new Vector3(0, 5, 0)));
  });

  test('does nothing to an empty model and gives a harmless undo', () => {
    const scene = new Scene();
    const undo = castShadows(new Group(), new DirectionalLight(), scene);
    assert.equal(scene.getObjectByName('ground'), undefined);
    assert.doesNotThrow(undo);
  });
});

describe('createSection', () => {
  test('puts the planes it is given on the renderer and takes them away with none', async () => {
    const { Plane } = await import('three');
    const renderer = { clippingPlanes: [] };
    const section = createSection(renderer);
    const plane = new Plane(new Vector3(0, -1, 0), 3.2);
    section.setPlanes([plane]);
    assert.deepEqual(renderer.clippingPlanes, [plane]);
    section.setPlanes([]);
    assert.deepEqual(renderer.clippingPlanes, []);
  });
});

describe('prepareRenderer', () => {
  test('draws the shadow map once and then only when the canvas asks', () => {
    const renderer = { shadowMap: { enabled: false, type: 0, autoUpdate: true, needsUpdate: false } };
    prepareRenderer(renderer);
    assert.equal(renderer.shadowMap.enabled, true);
    assert.equal(renderer.shadowMap.autoUpdate, false);
    assert.equal(renderer.shadowMap.needsUpdate, true);
  });
});

describe('the section of a view', () => {
  function building() {
    const group = new Group();
    group.add(box('w1', 'IfcWall', 0), box('w2', 'IfcWall', 3.3));
    group.updateMatrixWorld(true);
    return new SceneView(group, {
      storeys: [{ name: 'L1' }, { name: 'L2' }],
      objects: { w1: { storey: 'L1' }, w2: { storey: 'L2' } },
    });
  }

  test('is off until asked for', () => {
    assert.equal(building().cutHeight(), null);
  });

  test('cuts where the heatmap plan is cut, on the floor in view or the lowest', () => {
    // The plan of the heatmap is cut at the floor of the band plus CUT_M, so
    // the section has to be too, or the two would show different rooms.
    const view = building();
    view.state.sectioned = true;
    const [lower, upper] = view.bands;
    assert.ok(Math.abs(view.cutHeight() - (lower.from + CUT_M)) < 1e-9);
    view.state.storey = 'L2';
    assert.ok(Math.abs(view.cutHeight() - (upper.from + CUT_M)) < 1e-9);
    assert.ok(view.cutHeight() > 3.3 && view.cutHeight() < 6.3);
  });

  test('cuts above the lowest wall of a model without storeys, not above the terrain', () => {
    const group = new Group();
    group.add(box('site', 'IfcSite', -1, [20, 1, 20]), box('w1', 'IfcWallStandardCase', 0.2));
    group.updateMatrixWorld(true);
    const view = new SceneView(group);
    view.state.sectioned = true;
    assert.ok(Math.abs(view.cutHeight() - (0.2 + CUT_M)) < 1e-9);
  });

  test('cuts above the lowest object of a model without walls', () => {
    const group = new Group();
    group.add(box('s1', 'IfcSlab', 1));
    group.updateMatrixWorld(true);
    const view = new SceneView(group);
    view.state.sectioned = true;
    assert.ok(Math.abs(view.cutHeight() - (1 + CUT_M)) < 1e-9);
  });

  test('is switched by the x key and comes off on reset', () => {
    const view = building();
    const cut = SHORTCUTS.find((shortcut) => shortcut.key === 'x');
    cut.run({ view, refresh: () => undefined });
    assert.equal(cut.on(view), true);
    view.reset();
    assert.equal(view.state.sectioned, false);
  });
});
