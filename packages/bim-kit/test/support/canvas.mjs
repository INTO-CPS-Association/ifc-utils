/**
 * A stand-in for BimCanvas, for the tests that render a page around it.
 *
 * The canvas draws with WebGL, which jsdom does not have. The stand-in
 * records the props it is given, and a test calls them to announce what the
 * real canvas would: a model ready, or a conversion finished.
 */

import { mock } from 'node:test';
import React from 'react';

/** What the stand-in canvas was last given. */
export const canvas = { props: null };

function StandInCanvas(props) {
  canvas.props = props;
  return React.createElement('div', { 'data-testid': 'canvas', 'data-url': props.url });
}

/**
 * Replace the built canvas module. It has to run before anything that
 * imports the page is loaded, so each test file calls it first.
 */
export function mockCanvas() {
  mock.module(new URL('../../dist/esm/react/BimCanvas.js', import.meta.url).href, {
    defaultExport: StandInCanvas,
  });
}
