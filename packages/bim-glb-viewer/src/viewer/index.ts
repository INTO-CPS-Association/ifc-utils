/**
 * The three.js layer: what a model looks like and what is visible.
 *
 * Kept apart from `./react` so a consumer that draws its own interface, or none at all, never pulls React and MUI in behind it. three.js is a peer dependency of this entry point and of `./react`, and of nothing else.
 */

export { SceneView, type ObjectFacts, type PropertyTree, type ViewState } from './sceneView.js';
export { Palette, SHELL, SELECTED_COLOUR, HOVERED_COLOUR } from './appearance.js';
export {
  SHORTCUTS,
  handleKey,
  type Shortcut,
  type ShortcutContext,
} from './shortcuts.js';
export { createGizmo, cornerViewport, GIZMO_SIZE_PX, GIZMO_MARGIN_PX, type Gizmo } from './gizmo.js';
export { addOutlines } from './outline.js';
export { buildField, sourceAt, CELL_M, CUT_M, BLOCKS, OPENS, SEARCH_CELLS, type Field } from './field.js';
