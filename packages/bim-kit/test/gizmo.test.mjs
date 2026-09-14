/**
 * Tests for where the axes indicator is drawn.
 *
 * Only the pure half is tested: the placement of the square. Drawing needs a graphics context, and a test that mocks a WebGL renderer proves the mock works instead of that the gizmo does.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { cornerViewport, GIZMO_SIZE_PX, GIZMO_MARGIN_PX } from '../dist/esm/viewer/index.js';

describe('cornerViewport', () => {
  test('sits in the bottom left, inside the margin', () => {
    const { x, y, side } = cornerViewport(800, 600);

    assert.equal(x, GIZMO_MARGIN_PX);
    assert.equal(y, GIZMO_MARGIN_PX);
    assert.equal(side, GIZMO_SIZE_PX);
  });

  test('shrinks instead of hanging off a narrow view', () => {
    // A panel narrower than the gizmo is a real case, and a square drawn past
    // the edge reads as a rendering fault.
    assert.equal(cornerViewport(60, 600).side, 60 - 2 * GIZMO_MARGIN_PX);
  });

  test('shrinks for a short view too', () => {
    assert.equal(cornerViewport(800, 50).side, 50 - 2 * GIZMO_MARGIN_PX);
  });

  test('gives nothing to draw when the view is smaller than the margins', () => {
    // Asked for a negative side, WebGL raises instead of drawing nothing.
    assert.equal(cornerViewport(10, 10).side, 0);
    assert.equal(cornerViewport(0, 0).side, 0);
  });

  test('never lets the square cross the far edge', () => {
    for (const [width, height] of [[800, 600], [200, 200], [40, 300], [300, 40]]) {
      const { x, y, side } = cornerViewport(width, height);

      assert.ok(x + side <= width, `${x} + ${side} > ${width}`);
      assert.ok(y + side <= height, `${y} + ${side} > ${height}`);
    }
  });
});
