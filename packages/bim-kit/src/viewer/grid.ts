/**
 * A grid of metres under the model.
 *
 * It gives a building a scale a person can read without measuring: one line
 * a metre, a stronger one every five. Laid just under the lowest object, so it
 * never cuts through a slab, and sized to the model with a margin, so the
 * shadow and the edges of the site still sit on it.
 */

import { Box3, Color, GridHelper, type Object3D, type Scene, Vector3 } from 'three';

/** The side of one cell, in metres. */
export const GRID_CELL_M = 1;

/** A stronger line every this many cells. */
export const GRID_MAJOR_EVERY = 5;

/** The smallest grid drawn, in metres, so a single object still sits on a few cells. */
export const GRID_MIN_SPAN_M = 10;

/** How far the grid reaches past the model, as a share of its size. */
export const GRID_MARGIN = 0.5;

/** How far below the lowest object the grid sits, below the shadow ground. */
export const GRID_DROP_M = 0.02;

// Close to the background, so the grid reads as paper and not as a cage.
const MINOR_COLOUR = new Color(0xc9d1d6);
const MAJOR_COLOUR = new Color(0xa3afb7);

/**
 * The side of the grid for a model of this size, in metres.
 *
 * Rounded up to whole major cells, so the stronger lines meet at the edge and
 * the grid has no half square at its border.
 */
export function gridSpan(size: { x: number; z: number }): number {
  const wanted = Math.max(size.x, size.z) * (1 + 2 * GRID_MARGIN);
  const major = GRID_CELL_M * GRID_MAJOR_EVERY;
  return Math.max(GRID_MIN_SPAN_M, Math.ceil(wanted / major) * major);
}

export interface Grid {
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** Lay a grid under `model` in `scene`. Answers nothing to draw for an empty model. */
export function createGrid(scene: Scene, model: Object3D): Grid {
  const box = new Box3().setFromObject(model);
  if (box.isEmpty()) return { setVisible: () => undefined, dispose: () => undefined };
  const size = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());
  const span = gridSpan(size);

  const minor = new GridHelper(span, span / GRID_CELL_M, MINOR_COLOUR, MINOR_COLOUR);
  const major = new GridHelper(
    span, span / (GRID_CELL_M * GRID_MAJOR_EVERY), MAJOR_COLOUR, MAJOR_COLOUR,
  );
  const lines = [minor, major];
  for (const helper of lines) {
    helper.name = 'grid';
    helper.position.set(centre.x, box.min.y - GRID_DROP_M, centre.z);
    // Never in the way of a click, and never throwing a shadow.
    helper.raycast = () => undefined;
    scene.add(helper);
  }

  return {
    setVisible(visible) {
      for (const helper of lines) helper.visible = visible;
    },
    dispose() {
      for (const helper of lines) {
        scene.remove(helper);
        helper.geometry.dispose();
        (helper.material as { dispose: () => void }).dispose();
      }
    },
  };
}
