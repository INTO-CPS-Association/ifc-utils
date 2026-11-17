/**
 * Measuring on the model: a length, an area or an angle.
 *
 * Each click puts a point on the surface under the cursor.
 *
 * - A length takes two points and gives the distance between them.
 * - An angle takes three, the middle one the corner, and gives the angle
 *   there in degrees.
 * - An area takes as many as the outline needs and gives the area of the
 *   polygon they make, updated with each point. A click back on the first
 *   point closes it.
 *
 * A click after a measurement is complete starts a new one, so a person
 * measures one thing after another without clearing by hand. The lines are
 * drawn over the model, so a measurement across a room is not hidden by the
 * furniture in it. The label and a dot on each point live in the page, in the
 * overlay beside the marker labels, so they stay sharp at any zoom.
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

import {
  LABEL_ACCENT, LABEL_BG, LABEL_FG, placeLabel, toScreen,
} from './markerLabels.js';

export type MeasureMode = 'length' | 'area' | 'angle';

/** The colour of the line, the accent the selected label uses. */
const LINE_COLOUR = 0x1565c0;

/** The side of the dot on each point of a measurement, in pixels. */
export const END_DOT_PX = 10;

/** The most points an area outline takes. */
export const MAX_POINTS = 64;

/** How close to the first point a click has to land to close an area, in metres. */
export const CLOSE_M = 0.3;

/** The length of a measurement as a person reads it: metres, to the centimetre. */
export function distanceText(from: Vector3, to: Vector3): string {
  return `${from.distanceTo(to).toFixed(2)} m`;
}

/** The area of a flat polygon in space, whatever way it faces (Newell's method). */
export function polygonArea(points: readonly Vector3[]): number {
  if (points.length < 3) return 0;
  const normal = new Vector3();
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    normal.x += (point.y - next.y) * (point.z + next.z);
    normal.y += (point.z - next.z) * (point.x + next.x);
    normal.z += (point.x - next.x) * (point.y + next.y);
  });
  return normal.length() / 2;
}

/** The angle at `corner` between the lines to `a` and to `b`, in degrees. */
export function angleAt(a: Vector3, corner: Vector3, b: Vector3): number {
  const one = a.clone().sub(corner);
  const two = b.clone().sub(corner);
  if (one.lengthSq() === 0 || two.lengthSq() === 0) return 0;
  return (one.angleTo(two) * 180) / Math.PI;
}

/** How many points complete a measurement in each mode. An area is completed by closing it. */
const NEEDED: Record<MeasureMode, number> = { length: 2, angle: 3, area: Number.POSITIVE_INFINITY };

/** What a measurement says, or null while it has too few points to say anything. */
export function measureText(mode: MeasureMode, points: readonly Vector3[]): string | null {
  if (mode === 'length') return points.length === 2 ? distanceText(points[0], points[1]) : null;
  if (mode === 'angle') {
    return points.length === 3 ? `${angleAt(points[0], points[1], points[2]).toFixed(1)}°` : null;
  }
  return points.length >= 3 ? `${polygonArea(points).toFixed(2)} m²` : null;
}

export interface Measure {
  /** Choose what the next measurement is. Changing it takes the current one away. */
  setMode(mode: MeasureMode): void;
  readonly mode: MeasureMode;
  /** Put a point on the model. */
  addPoint(point: Vector3): void;
  /** The points of the measurement in progress or the last one completed. */
  readonly points: readonly Vector3[];
  /** Whether the measurement has all its points, or for an area, has been closed. */
  readonly complete: boolean;
  /** What the measurement says, or null. */
  readonly text: string | null;
  /** Keep the label and the dots on their points, for the camera as it is now. */
  place(camera: Camera, width: number, height: number): void;
  /** Take the measurement away. */
  clear(): void;
  dispose(): void;
}

function dotElement(overlay: HTMLElement): HTMLElement {
  const dot = overlay.ownerDocument.createElement('div');
  dot.dataset.bimMeasureEnd = '';
  dot.setAttribute('style', [
    'position:absolute', 'left:0', 'top:0', 'pointer-events:none', 'display:none',
    `width:${END_DOT_PX}px`, `height:${END_DOT_PX}px`, 'border-radius:50%',
    `background:${LABEL_ACCENT}`, `border:2px solid ${LABEL_BG}`, 'z-index:3',
  ].join(';'));
  overlay.appendChild(dot);
  return dot;
}

function labelElement(overlay: HTMLElement): HTMLElement {
  const label = overlay.ownerDocument.createElement('div');
  label.dataset.bimMeasure = '';
  label.setAttribute('style', [
    'position:absolute', 'left:0', 'top:0', 'pointer-events:none', 'display:none',
    'padding:2px 6px', 'border-radius:4px', 'font:600 12px/1.4 system-ui,sans-serif',
    `background:${LABEL_BG}`, `color:${LABEL_FG}`,
    `border:2px solid ${LABEL_ACCENT}`, 'white-space:nowrap', 'z-index:3',
  ].join(';'));
  overlay.appendChild(label);
  return label;
}

/** Where the label goes: the middle of a length, the corner of an angle, the middle of an area. */
function labelPoint(mode: MeasureMode, points: readonly Vector3[]): Vector3 {
  if (mode === 'angle') return points[1].clone();
  const sum = points.reduce((total, point) => total.add(point), new Vector3());
  return sum.multiplyScalar(1 / points.length);
}

export function createMeasure(scene: Scene, overlay: HTMLElement): Measure {
  let mode: MeasureMode = 'length';
  let closed = false;
  const points: Vector3[] = [];
  const material = new LineBasicMaterial({ color: LINE_COLOUR, depthTest: false });
  // Room for every point and the closing one from the start. `setFromPoints`
  // writes into the buffer it made the first time and does not grow it.
  const positions = new BufferAttribute(new Float32Array((MAX_POINTS + 1) * 3), 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', positions);
  const line = new Line(geometry, material);
  line.name = 'measure';
  // Drawn after the model and through it, so it is never hidden.
  line.renderOrder = 10;
  line.visible = false;
  line.raycast = () => undefined;
  scene.add(line);

  const label = labelElement(overlay);
  const dots: HTMLElement[] = [];
  let text: string | null = null;

  const complete = () => (mode === 'area' ? closed : points.length >= NEEDED[mode]);

  const draw = () => {
    const outline = mode === 'area' && closed ? [...points, points[0]] : points;
    outline.forEach((point, index) => positions.setXYZ(index, point.x, point.y, point.z));
    positions.needsUpdate = true;
    geometry.setDrawRange(0, outline.length);
    // The sphere decides whether the line is in view. Measured once on an
    // empty line it would leave every later line culled.
    geometry.computeBoundingSphere();
    line.visible = outline.length >= 2;
    text = measureText(mode, points);
    label.textContent = text ?? '';
    while (dots.length < points.length) dots.push(dotElement(overlay));
  };

  const clear = () => {
    points.length = 0;
    closed = false;
    draw();
    label.style.display = 'none';
    dots.forEach((dot) => { dot.style.display = 'none'; });
  };

  return {
    setMode(next) {
      if (next === mode) return;
      mode = next;
      clear();
    },
    get mode() {
      return mode;
    },
    addPoint(point) {
      if (complete()) clear();
      if (mode === 'area' && points.length >= 3 && point.distanceTo(points[0]) <= CLOSE_M) {
        closed = true;
      } else if (points.length < MAX_POINTS) {
        points.push(point.clone());
      }
      draw();
    },
    get points() {
      return points;
    },
    get complete() {
      return complete();
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
      if (text === null) {
        label.style.display = 'none';
        return;
      }
      placeLabel(label, toScreen(labelPoint(mode, points).project(camera), width, height), true);
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
