/**
 * The React entry point.
 *
 * Kept apart from the package root so a consumer that only wants the manifest
 * logic, a Node script or a test in jsdom, never pulls React, MUI or three.js
 * in behind it. Those three are peer dependencies of this entry point and of
 * nothing else.
 */

export { BuildingModels, type BuildingModelsProps } from './BuildingModels.js';
export { ClassLegend, HeatLegend, type HeatLegendProps } from './Legend.js';
export { SensorCards, type SensorCardsProps } from './SensorCards.js';
export { FloorPicker, type FloorPickerProps } from './FloorPicker.js';
export { Toolbar, type ToolbarProps } from './Toolbar.js';
export { ObjectPanel, type ObjectPanelProps } from './ObjectPanel.js';
export { HelpPanel, type HelpPanelProps } from './HelpPanel.js';

// `BimCanvas` is deliberately not re-exported here. `BuildingModels` reaches
// it through a dynamic import so three.js lands in its own chunk, and a static
// re-export from this file undoes that: the host's main bundle grew by 640 KB
// and the separate chunk vanished. A consumer that genuinely wants the canvas
// alone imports it from its own path.
export type { BimCanvasProps } from './BimCanvas.js';
export {
  MODELS_DIRECTORY,
  contentsUrl,
  fileUrl,
  formatSize,
  pairModels,
  readIfcName,
  readableName,
  uniqueNames,
  type BimModel,
  type LibraryEntry,
} from './assets.js';
export { objectsOf, type BimObject } from './scene.js';
