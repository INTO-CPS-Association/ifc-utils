/**
 * Tests for drawing on the view: the arrow head, what each tool draws, and the
 * surface that takes the mouse only while a tool is up.
 *
 * A recording pen stands in for the 2D context, which jsdom does not have.
 */

import './support/dom.mjs';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ARROW_HEAD_PX, SHORTCUTS, SKETCH_COLOUR, SKETCH_FONT, SceneView, arrowHead, createSketch, drawStroke,
} from '../dist/esm/viewer/index.js';
import { Group } from 'three';

function recordingPen() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args.map((n) => Math.round(n * 100) / 100)]);
  return {
    calls,
    beginPath: record('begin'),
    moveTo: record('move'),
    lineTo: record('line'),
    strokeRect: record('rect'),
    stroke: record('stroke'),
    clearRect: record('clear'),
    fillText: (text, x, y) => calls.push(['text', text, x, y]),
  };
}

describe('arrowHead', () => {
  test('sits behind the tip, one on each side, at the head length', () => {
    const [one, two] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 });
    for (const end of [one, two]) {
      assert.ok(end.x < 100);
      assert.ok(Math.abs(Math.hypot(100 - end.x, end.y) - ARROW_HEAD_PX) < 1e-9);
    }
    assert.ok(Math.abs(one.y + two.y) < 1e-9);
  });
});

describe('drawStroke', () => {
  test('a pen line follows every point', () => {
    const pen = recordingPen();
    drawStroke(pen, { tool: 'pen', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 2 }] });
    assert.deepEqual(pen.calls, [['begin'], ['move', 0, 0], ['line', 5, 5], ['line', 9, 2], ['stroke']]);
  });

  test('a box goes from the first point to the last', () => {
    const pen = recordingPen();
    drawStroke(pen, { tool: 'box', points: [{ x: 10, y: 20 }, { x: 40, y: 60 }] });
    assert.deepEqual(pen.calls, [['begin'], ['rect', 10, 20, 30, 40]]);
  });

  test('an arrow draws its shaft and both sides of its head', () => {
    const pen = recordingPen();
    drawStroke(pen, { tool: 'arrow', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] });
    assert.equal(pen.calls.filter(([name]) => name === 'line').length, 3);
    assert.deepEqual(pen.calls[2], ['line', 100, 0]);
  });

  test('a note is written at its one point in the drawing colour', () => {
    const pen = recordingPen();
    drawStroke(pen, { tool: 'text', points: [{ x: 12, y: 30 }], text: 'Leak here' });
    assert.deepEqual(pen.calls, [['text', 'Leak here', 12, 30]]);
    assert.equal(pen.font, SKETCH_FONT);
    assert.equal(pen.fillStyle, SKETCH_COLOUR);
  });

  test('a single point draws nothing', () => {
    const pen = recordingPen();
    drawStroke(pen, { tool: 'pen', points: [{ x: 1, y: 1 }] });
    assert.deepEqual(pen.calls, []);
  });
});

describe('createSketch', () => {
  function surface() {
    const overlay = document.createElement('div');
    document.body.appendChild(overlay);
    const sketch = createSketch(overlay);
    return { overlay, sketch, canvas: overlay.querySelector('[data-bim-sketch]') };
  }
  const pointer = (type, x, y) => new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });

  test('takes the mouse only while a tool is up', () => {
    const { sketch, canvas } = surface();
    assert.equal(canvas.style.pointerEvents, 'none');
    sketch.setTool('pen');
    assert.equal(canvas.style.pointerEvents, 'auto');
    sketch.setTool(null);
    assert.equal(canvas.style.pointerEvents, 'none');
  });

  test('records a pen stroke point by point, and an arrow by its two ends', () => {
    const { sketch, canvas } = surface();
    sketch.setTool('pen');
    canvas.dispatchEvent(pointer('pointerdown', 1, 1));
    canvas.dispatchEvent(pointer('pointermove', 2, 2));
    canvas.dispatchEvent(pointer('pointermove', 3, 3));
    canvas.dispatchEvent(pointer('pointerup', 3, 3));
    sketch.setTool('arrow');
    canvas.dispatchEvent(pointer('pointerdown', 0, 0));
    canvas.dispatchEvent(pointer('pointermove', 5, 5));
    canvas.dispatchEvent(pointer('pointermove', 9, 9));
    canvas.dispatchEvent(pointer('pointerup', 9, 9));
    assert.deepEqual(sketch.strokes.map((s) => [s.tool, s.points.length]), [['pen', 3], ['arrow', 2]]);
    assert.deepEqual(sketch.strokes[1].points[1], { x: 9, y: 9 });
  });

  test('draws nothing when no tool is up, and putting the tools away wipes the drawing', () => {
    const { sketch, canvas } = surface();
    canvas.dispatchEvent(pointer('pointerdown', 1, 1));
    assert.equal(sketch.strokes.length, 0);
    sketch.setTool('box');
    canvas.dispatchEvent(pointer('pointerdown', 1, 1));
    sketch.setTool(null);
    assert.equal(sketch.strokes.length, 0);
  });

  test('a click with the text tool opens a box, Enter keeps the note and Escape drops it', () => {
    const { overlay, sketch, canvas } = surface();
    sketch.setTool('text');
    canvas.dispatchEvent(pointer('pointerdown', 40, 50));
    let input = overlay.querySelector('input');
    assert.ok(input);
    input.value = 'Check this valve';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.deepEqual(sketch.strokes.map((s) => [s.tool, s.text]), [['text', 'Check this valve']]);
    assert.equal(overlay.querySelector('input'), null);
    canvas.dispatchEvent(pointer('pointerdown', 10, 10));
    input = overlay.querySelector('input');
    input.value = 'Dropped';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(sketch.strokes.length, 1);
  });

  test('letters typed in a note do not reach the viewer shortcuts', () => {
    const { overlay, sketch, canvas } = surface();
    sketch.setTool('text');
    canvas.dispatchEvent(pointer('pointerdown', 40, 50));
    let reached = false;
    overlay.addEventListener('keydown', () => { reached = true; });
    overlay.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    assert.equal(reached, false);
  });

  test('goes away on dispose', () => {
    const { overlay, sketch } = surface();
    sketch.dispose();
    assert.equal(overlay.querySelector('[data-bim-sketch]'), null);
  });
});

describe('the n key', () => {
  test('cycles pen, arrow, box, text and off, names each, and reset puts the tools away', () => {
    const view = new SceneView(new Group());
    const n = SHORTCUTS.find((shortcut) => shortcut.key === 'n');
    const seen = [];
    for (let i = 0; i < 5; i += 1) {
      n.run({ view, refresh: () => undefined });
      seen.push([view.state.sketching, n.badge(view)]);
    }
    assert.deepEqual(seen, [['pen', 'Pen'], ['arrow', 'Arrow'], ['box', 'Box'], ['text', 'Text'], [null, undefined]]);
    n.run({ view, refresh: () => undefined });
    view.reset();
    assert.equal(view.state.sketching, null);
  });
});
