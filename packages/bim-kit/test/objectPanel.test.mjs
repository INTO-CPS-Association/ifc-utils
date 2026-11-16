/**
 * Tests for copying a row of the object panel: the copy goes to the
 * clipboard, the row says so, and a refused copy claims nothing.
 */

import './support/dom.mjs';

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ObjectPanel, copyText } from '../dist/esm/react/ObjectPanel.js';

afterEach(cleanup);

function withClipboard(writeText) {
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true });
}

test('a row copies its value and then says it was copied', async () => {
  const copied = [];
  withClipboard(async (text) => { copied.push(text); });
  render(React.createElement(ObjectPanel, { globalId: '2XPyKWY018sA1ygZKgQPtU', facts: { name: 'Wall 4' } }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy Global ID' })); });
  assert.deepEqual(copied, ['2XPyKWY018sA1ygZKgQPtU']);
  assert.ok(screen.getByRole('button', { name: 'Global ID Copied' }));
});

test('a copy the browser refuses is not reported as done', async () => {
  withClipboard(async () => { throw new Error('denied'); });
  assert.equal(await copyText('x'), false);
  render(React.createElement(ObjectPanel, { globalId: 'g1', facts: { name: 'Wall 4' } }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy Name' })); });
  assert.ok(screen.getByRole('button', { name: 'Copy Name' }));
});
