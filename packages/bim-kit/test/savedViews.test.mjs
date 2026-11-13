/**
 * Tests for the saved views: the store, which never breaks on bad storage,
 * and the control that saves, shows and deletes them.
 */

import './support/dom.mjs';

import { afterEach, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  MAX_SAVED_VIEWS, createViewStore, isSavedView, nextViewName, snapshot,
} from '../dist/esm/viewer/index.js';
import { SavedViews } from '../dist/esm/react/SavedViews.js';

afterEach(cleanup);

const STATE = {
  storey: 'L1', parallel: true, sectioned: true, vertical: 'x', heightShift: 0.25, depthShift: -0.5,
};

function memory() {
  const items = new Map();
  return {
    items,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, value),
  };
}

const view = (name) => snapshot(name, { x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0 }, STATE);

describe('snapshot and isSavedView', () => {
  test('keep the camera, the floor, the lens and the cuts', () => {
    const saved = view('Entrance');
    assert.deepEqual(saved, {
      name: 'Entrance', position: [1, 2, 3], target: [0, 0, 0], ...STATE,
    });
    assert.equal(isSavedView(JSON.parse(JSON.stringify(saved))), true);
  });

  test('refuse what another version or a person may have left in storage', () => {
    assert.equal(isSavedView(null), false);
    assert.equal(isSavedView({ ...view('a'), position: [1, 2] }), false);
    assert.equal(isSavedView({ ...view('a'), vertical: 'y' }), false);
    assert.equal(isSavedView({ ...view('a'), name: ' ' }), false);
    assert.equal(isSavedView({ ...view('a'), target: [0, Number.NaN, 0] }), false);
  });
});

describe('nextViewName', () => {
  test('counts on from the list and skips a name taken', () => {
    assert.equal(nextViewName([]), 'View 1');
    assert.equal(nextViewName([view('View 2')]), 'View 3');
    assert.equal(nextViewName([view('View 1'), view('View 3')]), 'View 4');
  });
});

describe('createViewStore', () => {
  test('saves, replaces by name and removes, one list per key', () => {
    const storage = memory();
    const store = createViewStore(storage, 'k1');
    store.save(view('A'));
    store.save(view('B'));
    store.save({ ...view('A'), position: [9, 9, 9] });
    assert.deepEqual(store.list().map((saved) => saved.name), ['B', 'A']);
    assert.deepEqual(store.list()[1].position, [9, 9, 9]);
    assert.deepEqual(createViewStore(storage, 'k2').list(), []);
    assert.deepEqual(store.remove('B').map((saved) => saved.name), ['A']);
  });

  test('keeps the latest views up to the limit', () => {
    const store = createViewStore(memory(), 'k');
    for (let i = 0; i < MAX_SAVED_VIEWS + 3; i += 1) store.save(view(`V${i}`));
    const names = store.list().map((saved) => saved.name);
    assert.equal(names.length, MAX_SAVED_VIEWS);
    assert.equal(names.at(-1), `V${MAX_SAVED_VIEWS + 2}`);
  });

  test('reads broken, foreign or missing storage as an empty list and never throws', () => {
    const storage = memory();
    storage.setItem('k', '{not json');
    assert.deepEqual(createViewStore(storage, 'k').list(), []);
    storage.setItem('k', JSON.stringify([view('ok'), { name: 'old' }]));
    assert.deepEqual(createViewStore(storage, 'k').list().map((saved) => saved.name), ['ok']);
    const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    assert.deepEqual(createViewStore(full, 'k').save(view('A')).map((saved) => saved.name), ['A']);
    assert.deepEqual(createViewStore(undefined, 'k').list(), []);
  });
});

describe('SavedViews', () => {
  test('saves the view on screen with the save button', () => {
    let saved = 0;
    render(React.createElement(SavedViews, {
      views: [], onSave: () => { saved += 1; }, onShow: () => undefined, onRemove: () => undefined,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Save This View' }));
    assert.equal(saved, 1);
    assert.ok(screen.getByText('None Yet'));
    assert.equal(screen.getByRole('button', { name: 'Delete The Chosen View' }).disabled, true);
  });

  test('shows a view chosen in the list and then deletes it', () => {
    const shown = [];
    const removed = [];
    render(React.createElement(SavedViews, {
      views: [view('Entrance'), view('Roof')],
      onSave: () => undefined,
      onShow: (saved) => shown.push(saved.name),
      onRemove: (name) => removed.push(name),
    }));
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Roof'));
    assert.deepEqual(shown, ['Roof']);
    fireEvent.click(screen.getByRole('button', { name: 'Delete The Chosen View' }));
    assert.deepEqual(removed, ['Roof']);
  });
});
