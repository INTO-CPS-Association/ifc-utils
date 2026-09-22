/**
 * The sensor cards, rendered.
 *
 * MUI 9 removed the system props, such as display on Typography, and a prop it
 * no longer knows is dropped without a word. The label and the age of a reading
 * then run together on one line. These tests read the style the browser would
 * apply, so a layout that silently stops applying fails here.
 */

import './support/dom.mjs';

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { SensorCards } from '../dist/esm/react/SensorCards.js';

afterEach(cleanup);

const binding = {
  selector: { globalId: '0_sgz7bzz4Jh2ckU1ehFe$' },
  label: 'HX-1 temperature TS-01',
  source: { live: { transport: 'mqtt', topic: 'swim/B1/temperature/TS-01' } },
  display: { unit: '°C', ramp: [10, 50] },
};

test('the label and the age of a reading sit on lines of their own', () => {
  render(React.createElement(SensorCards, {
    bindings: [binding],
    readings: new Map(),
    feed: 'live',
    selected: null,
    onSelect: () => {},
  }));

  // A binding with no id of its own is titled by its label as well, so the
  // label under the title is the caption, the span.
  const label = screen
    .getAllByText('HX-1 temperature TS-01')
    .find((element) => element.tagName === 'SPAN');
  assert.equal(getComputedStyle(label).display, 'block');
  // The line under the label is the age, and it is a block as well, so the two
  // never share a line.
  assert.equal(getComputedStyle(label.nextElementSibling).display, 'block');
});
