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
export {
  createGrid, gridSpan, GRID_CELL_M, GRID_MAJOR_EVERY, GRID_MIN_SPAN_M, GRID_MARGIN, GRID_DROP_M,
  type Grid,
} from './grid.js';
export {
  createFlight, ease, prefersReducedMotion, FLIGHT_MS, type Flight, type Steered,
} from './flight.js';
export {
  createViewCube, cubeViewport, directionAt, CUBE_SIZE_PX, CUBE_MARGIN_PX, CUBE_EDGE, CUBE_FACES,
  type ViewCube,
} from './viewCube.js';
export {
  setParallel, backOff, PERSPECTIVE_FOV, PARALLEL_FOV, type Orbit,
} from './projection.js';
export { createMeasure, distanceText, END_DOT_PX, type Measure } from './measure.js';
export {
  prepareRenderer, lightFromRoom, castShadows, createSection, createFinish,
  SHADOW_MAP_PX, ROOM_LIGHT, GROUND_SHADOW_OPACITY, GROUND_MARGIN, GROUND_DROP_M, type Clipped,
} from './look.js';
export { createGlow, GLOW_MARGIN_M, type Glow } from './glow.js';
export { buildField, sourceAt, planAngle, toGrid, fromGrid, CELL_M, CUT_M, BLOCKS, OPENS, SEARCH_CELLS, type Field } from './field.js';
export { createFieldSheet, type FieldSheet } from './fieldSheet.js';
export {
  frame, frameFrom, frameObject, LOOK_FROM, NEAR_PLANE, FAR_PLANE, MIN_FRAME_RADIUS_M, type Target,
} from './framing.js';
export {
  createMarkers, markerScale, markerColour, labelText, worldPerPixel, pulseFactor, PULSE_MS, PULSE_GROWTH,
  MARKER_MIN_PX, SELECTED_MARKER_MIN_PX, NO_READING_COLOUR, type MarkerSet,
} from './markers.js';
export { toScreen, LABEL_OFFSET_PX, type ScreenPoint } from './markerLabels.js';
