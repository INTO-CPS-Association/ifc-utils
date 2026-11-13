/**
 * Tests for the model tree: grouping by floor and by class, the search, the
 * entries a view gives it and the list a person clicks.
 */

import './support/dom.mjs';

import { afterEach, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import {
  NO_FLOOR, SceneView, groupEntries, matches, readableClass,
} from '../dist/esm/viewer/index.js';
import { MAX_ROWS, ModelTree } from '../dist/esm/react/ModelTree.js';

afterEach(cleanup);

const entry = (globalId, name, ifcClass, storey, values = []) => ({ globalId, name, ifcClass, storey, values });

const ENTRIES = [
  entry('d1', 'Front Door', 'IfcDoor', 'L1', ['EI60']),
  entry('w2', 'Wall B', 'IfcWallStandardCase', 'L2'),
  entry('w1', 'Wall A', 'IfcWallStandardCase', 'L1'),
  entry('s1', 'Site', 'IfcSite', null),
];

describe('readableClass', () => {
  test('drops Ifc and splits the words', () => {
    assert.equal(readableClass('IfcWallStandardCase'), 'Wall Standard Case');
    assert.equal(readableClass('IfcDoor'), 'Door');
    assert.equal(readableClass('Ifc'), 'Ifc');
  });
});

describe('matches', () => {
  test('finds a word in the name, the class, the GlobalId, the floor or a property value', () => {
    assert.equal(matches(ENTRIES[0], 'door'), true);
    assert.equal(matches(ENTRIES[0], 'ei60'), true);
    assert.equal(matches(ENTRIES[2], 'standard case'), true);
    assert.equal(matches(ENTRIES[1], 'w2'), true);
    assert.equal(matches(ENTRIES[1], 'l2 wall'), true);
    assert.equal(matches(ENTRIES[1], 'l2 door'), false);
    assert.equal(matches(ENTRIES[1], '   '), true);
  });
});

describe('groupEntries', () => {
  test('by floor follows the building, lowest first, objects without one last', () => {
    const groups = groupEntries(ENTRIES, 'storey', '', ['L1', 'L2']);
    assert.deepEqual(groups.map((group) => group.title), ['L1', 'L2', NO_FLOOR]);
    assert.deepEqual(groups[0].entries.map((e) => e.name), ['Front Door', 'Wall A']);
  });

  test('by class is alphabetical and names the classes as a person reads them', () => {
    const groups = groupEntries(ENTRIES, 'class');
    assert.deepEqual(groups.map((group) => group.title), ['Door', 'Site', 'Wall Standard Case']);
  });

  test('keeps only what the search finds, and drops a group left empty', () => {
    const groups = groupEntries(ENTRIES, 'storey', 'wall', ['L1', 'L2']);
    assert.deepEqual(groups.map((group) => group.title), ['L1', 'L2']);
    assert.deepEqual(groups[0].entries.map((e) => e.globalId), ['w1']);
  });
});

describe('SceneView.entries', () => {
  test('takes the name and class from the tree and the floor from the tree or the band', () => {
    const group = new Group();
    for (const [id, y] of [['a', 0], ['b', 3.2]]) {
      const mesh = new Mesh(new BoxGeometry(1, 3, 1), new MeshStandardMaterial());
      mesh.position.set(0, y + 1.5, 0);
      mesh.userData.globalId = id;
      mesh.userData.ifcClass = 'IfcWall';
      mesh.name = `mesh ${id}`;
      group.add(mesh);
    }
    group.updateMatrixWorld(true);
    const view = new SceneView(group, {
      storeys: [{ name: 'L1' }, { name: 'L2' }],
      objects: {
        a: { name: 'Wall A', ifcClass: 'IfcWallStandardCase', storey: 'L1', properties: { Pset: { FireRating: 'EI60' } } },
        b: { storey: 'L2' },
      },
    });
    const byId = Object.fromEntries(view.entries().map((e) => [e.globalId, e]));
    assert.deepEqual(byId.a, {
      globalId: 'a', name: 'Wall A', ifcClass: 'IfcWallStandardCase', storey: 'L1', values: ['EI60'],
    });
    assert.deepEqual([byId.b.name, byId.b.ifcClass, byId.b.storey], ['mesh b', 'IfcWall', 'L2']);
  });
});

describe('ModelTree', () => {
  test('lists the objects by floor, switches to class, and picks one on click', () => {
    const picked = [];
    render(React.createElement(ModelTree, {
      entries: ENTRIES, floors: ['L1', 'L2'], selected: null, onPick: (id) => picked.push(id),
    }));
    assert.ok(screen.getByText('L1 (2)'));
    assert.ok(screen.getByText('4 objects'));
    fireEvent.click(screen.getByText('Wall B'));
    assert.deepEqual(picked, ['w2']);
    fireEvent.click(screen.getByRole('button', { name: 'By Class' }));
    assert.ok(screen.getByText('Wall Standard Case (2)'));
  });

  test('searches and says how many it found', () => {
    render(React.createElement(ModelTree, {
      entries: ENTRIES, floors: ['L1', 'L2'], selected: null, onPick: () => undefined,
    }));
    fireEvent.change(screen.getByLabelText('Find Objects'), { target: { value: 'ei60' } });
    assert.ok(screen.getByText('1 of 4 objects'));
    assert.ok(screen.getByText('Front Door'));
    assert.equal(screen.queryByText('Wall A'), null);
  });

  test('draws at most the row limit and says so', () => {
    const many = Array.from({ length: MAX_ROWS + 5 }, (_, i) => entry(`g${i}`, `Beam ${i}`, 'IfcBeam', 'L1'));
    render(React.createElement(ModelTree, {
      entries: many, floors: ['L1'], selected: null, onPick: () => undefined,
    }));
    assert.ok(screen.getByText(`${MAX_ROWS + 5} objects, the first ${MAX_ROWS} shown`));
    assert.equal(screen.getAllByRole('button').filter((b) => b.textContent.startsWith('Beam')).length, MAX_ROWS);
  });
});
