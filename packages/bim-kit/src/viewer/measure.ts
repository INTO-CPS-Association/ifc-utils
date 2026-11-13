/**
 * Measuring the distance between two points on the model.
 *
 * Each click puts a point on the surface under the cursor. The second point
 * closes the measurement: a line between the two and a label with the length
 * in metres. A third click starts a new one, so a person measures one thing
 * after another without clearing by hand.
 *
 * The line is drawn over the model, so a measurement across a room is not
 * hidden by the furniture in it. The label lives in the overlay beside the
 * marker labels, in the page and not in the 3D scene, so it stays sharp.
 */

import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Line,
  LineBasicMaterial,
  type Scene,
  Vector3,
} from 'three';

import { placeLabel, toScreen } from './markerLabels.js';

/** The colour of the line, the accent the selected label uses. */
const LINE_COLOUR = 0x1565c0;

/** The side of the dot on each end of a measurement, in pixels. */
export const END_DOT_PX = 10;

/** The length of a measurement as a person reads it: metres, to the centimetre. */
export function distanceText(from: Vector3, to: Vector3): string {
  return `${from.distanceTo(to).toFixed(2)} m`;
}

export interface Measure {
  /** Put a point on the model. The second closes a measurement, the third starts a new one. */
  addPoint(point: Vector3): void;
  /** The points of the measurement in progress or the last one closed. */
  readonly points: readonly Vector3[];
  /** The length of the last closed measurement, or null. */
  readonly text: string | null;
  /** Keep the label over the middle of the line, for the camera as it is now. */
  place(camera: Camera, width: number, height: number): void;
  /** Take the measurement away. */
  clear(): void;
  dispose(): void;
}

export function createMeasure(scene: Scene, overlay: HTMLElement): Measure {
  const points: Vector3[] = [];
  const material = new LineBasicMaterial({ color: LINE_COLOUR, depthTest: false });
  // Room for both ends from the start. `setFromPoints` writes into the buffer
  // it made the first time and does not grow it, so a line set from one point
  // and then from two kept one vertex and drew nothing.
  const positions = new BufferAttribute(new Float32Array(6), 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', positions);
  const line = new Line(geometry, material);
  line.name = 'measure';
  // Drawn after the model and through it, so it is never hidden.
  line.renderOrder = 10;
  line.visible = false;
  line.raycast = () => undefined;
  scene.add(line);

  const label = overlay.ownerDocument.createElement('div');
  label.dataset.bimMeasure = '';
  label.setAttribute('style', [
    'position:absolute', 'left:0', 'top:0', 'pointer-events:none', 'display:none',
    'padding:2px 6px', 'border-radius:4px', 'font:600 12px/1.4 system-ui,sans-serif',
    'background:var(--bim-label-background,#ffffff)', 'color:var(--bim-label-text,#1f2a33)',
    'border:2px solid var(--bim-label-accent,#1565c0)', 'white-space:nowrap', 'z-index:3',
  ].join(';'));
  overlay.appendChild(label);
  // A dot on each end, drawn in the page at a fixed size in pixels. The line
  // is one pixel wide, which WebGL does not widen, and the first dot is the
  // only sign after the first click that a measurement has begun.
  const dots = [0, 1].map(() => {
    const dot = overlay.ownerDocument.createElement('div');
    dot.dataset.bimMeasureEnd = '';
    dot.setAttribute('style', [
      'position:absolute', 'left:0', 'top:0', 'pointer-events:none', 'display:none',
      `width:${END_DOT_PX}px`, `height:${END_DOT_PX}px`, 'border-radius:50%',
      'background:var(--bim-label-accent,#1565c0)', 'border:2px solid #ffffff', 'z-index:3',
    ].join(';'));
    overlay.appendChild(dot);
    return dot;
  });
  let text: string | null = null;

  const draw = () => {
    points.forEach((point, index) => positions.setXYZ(index, point.x, point.y, point.z));
    positions.needsUpdate = true;
    geometry.setDrawRange(0, points.length);
    // The sphere decides whether the line is in view. Measured once on an
    // empty line it would leave every later line culled.
    geometry.computeBoundingSphere();
    line.visible = points.length === 2;
    text = points.length === 2 ? distanceText(points[0], points[1]) : null;
    label.textContent = text ?? '';
  };

  const clear = () => {
    points.length = 0;
    draw();
    label.style.display = 'none';
    dots.forEach((dot) => { dot.style.display = 'none'; });
  };

  return {
    addPoint(point) {
      if (points.length === 2) points.length = 0;
      points.push(point.clone());
      draw();
    },
    get points() {
      return points;
    },
    get text() {
      return text;
    },
    place(camera, width, height) {
      dots.forEach((dot, index) => {
        const point = points[index];
        const at = point && toScreen(point.clone().project(camera), width, height);
        dot.style.display = at?.visible ? 'block' : 'none';
        if (at) dot.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -50%)`;
      });
      if (points.length !== 2) {
        label.style.display = 'none';
        return;
      }
      const middle = points[0].clone().add(points[1]).multiplyScalar(0.5);
      placeLabel(label, toScreen(middle.project(camera), width, height), true);
    },
    clear,
    dispose() {
      clear();
      scene.remove(line);
      geometry.dispose();
      material.dispose();
      label.remove();
      dots.forEach((dot) => dot.remove());
    },
  };
}
