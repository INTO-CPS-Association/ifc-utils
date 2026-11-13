/**
 * Every keyboard shortcut, in one table.
 *
 * The table binds the keys, builds the toolbar and writes the help, so a button and a key cannot disagree. Three lists of the same thing is a bug waiting to be filed, and this viewer had it.
 *
 * The keys follow the ProBIM Explorer, so anyone moving between the two viewers keeps their hands.
 */

import { type HeatScope } from '../readings.js';
import type { Binding } from '../binding.js';
import type { Backdrop, SceneView } from './sceneView.js';
import type { ModelStyle } from './appearance.js';
import type { SketchTool } from './sketch.js';
import type { MeasureMode } from './measure.js';

/** What a shortcut needs from the page to do its work. */
export interface ShortcutContext {
  view: SceneView;
  /** The bindings in force, which is what decides the scopes worth cycling. */
  bindings: Binding[];
  /** Repaint after the shortcut has changed something. */
  refresh: () => void;
  /** Put the whole model back in shot. */
  frame: () => void;
  /** Put the selected object in shot. Does nothing when none is selected. */
  frameSelection: () => void;
  /** Look from one of the six axes, or from the default corner. */
  look: (from: 'top' | 'front' | 'side' | 'corner') => void;
  /** What the cursor is over, so it can be hidden. */
  hovered: () => string | null;
  toggleHelp: () => void;
  toggleFullscreen: () => void;
}

export interface Shortcut {
  key: string;
  label: string;
  /** The name of an icon the page draws. Kept as a name so this file draws nothing. */
  icon: string;
  run: (context: ShortcutContext) => void;
  /** Whether the toggle is currently on. An entry without this is an action and never lights up. */
  on?: (view: SceneView) => boolean;
  /** What the toggle is currently set to, for a button that has more than two states. */
  badge?: (view: SceneView) => string | undefined;
}

const SKETCH_LABELS: Record<SketchTool, string> = {
  pen: 'Pen',
  arrow: 'Arrow',
  box: 'Box',
};

const STYLE_LABELS: Record<ModelStyle, string> = {
  shaded: 'Shaded',
  mono: 'Single Colour',
  classes: 'By Class',
  wireframe: 'Wireframe',
};

const BACKDROP_LABELS: Record<Backdrop, string> = {
  light: 'Light',
  dim: 'Dim',
  slate: 'Slate',
  ink: 'Ink',
};

const MEASURE_LABELS: Record<MeasureMode, string> = {
  length: 'Length',
  area: 'Area',
  angle: 'Angle',
};

const SCOPE_LABELS: Record<HeatScope, string> = {
  off: 'Off',
  sensor: 'Per Sensor',
  room: 'Per Room',
  storey: 'Per Floor',
  building: 'Building Mean',
};

/** Move to the next scope the model can actually answer, so cycling never lands on one that colours nothing. */
function cycleHeat(view: SceneView, bindings: Binding[]): void {
  const scopes = view.scopesFor(bindings);
  const next = scopes.indexOf(view.state.heat) + 1;
  view.state.heat = scopes[next >= scopes.length ? 0 : next];
}

export const SHORTCUTS: Shortcut[] = [
  {
    key: 'm',
    label: 'Heatmap',
    icon: 'heatmap',
    run: ({ view, bindings, refresh }) => { cycleHeat(view, bindings); refresh(); },
    on: (view) => view.state.heat !== 'off',
    badge: (view) => SCOPE_LABELS[view.state.heat],
  },
  {
    key: 't',
    label: 'Transparency',
    icon: 'transparency',
    run: ({ view, refresh }) => { view.state.transparent = !view.state.transparent; refresh(); },
    on: (view) => view.state.transparent,
  },
  {
    key: 'b',
    label: 'Hide Slabs, Roofs And Ceilings',
    icon: 'slabs',
    run: ({ view, refresh }) => { view.state.slabsHidden = !view.state.slabsHidden; refresh(); },
    on: (view) => view.state.slabsHidden,
  },
  {
    key: 'x',
    label: 'Cut The Floor At Chest Height',
    icon: 'section',
    run: ({ view, refresh }) => { view.state.sectioned = !view.state.sectioned; refresh(); },
    on: (view) => view.state.sectioned,
  },
  {
    key: 'v',
    label: 'Vertical Section',
    icon: 'vertical',
    run: ({ view, refresh }) => {
      const order = [null, 'x', 'z'] as const;
      view.state.vertical = order[(order.indexOf(view.state.vertical) + 1) % order.length];
      view.state.depthShift = 0;
      refresh();
    },
    on: (view) => view.state.vertical !== null,
    badge: (view) => (view.state.vertical === null ? undefined : `Along ${view.state.vertical.toUpperCase()}`),
  },
  {
    key: 'j',
    label: 'Move The Cut Back',
    icon: 'cutBack',
    run: ({ view, refresh }) => { view.shiftCut(-1); refresh(); },
  },
  {
    key: 'k',
    label: 'Move The Cut Forward',
    icon: 'cutForward',
    run: ({ view, refresh }) => { view.shiftCut(1); refresh(); },
  },
  {
    key: 'g',
    label: 'Grid',
    icon: 'grid',
    run: ({ view, refresh }) => { view.state.grid = !view.state.grid; refresh(); },
    on: (view) => view.state.grid,
  },
  {
    key: 'i',
    label: 'Show The Selection Alone',
    icon: 'isolate',
    run: ({ view, refresh }) => { view.toggleIsolation(); refresh(); },
    on: (view) => view.state.isolated !== null,
  },
  {
    key: 'd',
    label: 'Measure A Length, An Area Or An Angle',
    icon: 'measure',
    run: ({ view, refresh }) => {
      const order = [null, 'length', 'area', 'angle'] as const;
      view.state.measuring = order[(order.indexOf(view.state.measuring) + 1) % order.length];
      refresh();
    },
    on: (view) => view.state.measuring !== null,
    badge: (view) => (view.state.measuring === null ? undefined : MEASURE_LABELS[view.state.measuring]),
  },
  {
    key: 'o',
    label: 'Parallel View, For Plans And Elevations',
    icon: 'parallel',
    run: ({ view, refresh }) => { view.state.parallel = !view.state.parallel; refresh(); },
    on: (view) => view.state.parallel,
  },
  {
    key: 'l',
    label: 'Shadows',
    icon: 'shadows',
    run: ({ view, refresh }) => { view.state.shadows = !view.state.shadows; refresh(); },
    on: (view) => view.state.shadows,
  },
  {
    key: 'u',
    label: 'Walk Through, With The Arrow Keys',
    icon: 'walk',
    run: ({ view, refresh }) => { view.state.walking = !view.state.walking; refresh(); },
    on: (view) => view.state.walking,
  },
  {
    key: 'n',
    label: 'Draw On The View',
    icon: 'sketch',
    run: ({ view, refresh }) => {
      const order = [null, 'pen', 'arrow', 'box'] as const;
      view.state.sketching = order[(order.indexOf(view.state.sketching) + 1) % order.length];
      refresh();
    },
    on: (view) => view.state.sketching !== null,
    badge: (view) => (view.state.sketching === null ? undefined : SKETCH_LABELS[view.state.sketching]),
  },
  {
    key: 'y',
    label: 'Style',
    icon: 'style',
    run: ({ view, refresh }) => {
      const order = ['shaded', 'mono', 'classes', 'wireframe'] as const;
      view.state.style = order[(order.indexOf(view.state.style) + 1) % order.length];
      refresh();
    },
    on: (view) => view.state.style !== 'shaded',
    badge: (view) => STYLE_LABELS[view.state.style],
  },
  {
    key: 'z',
    label: 'Background',
    icon: 'backdrop',
    run: ({ view, refresh }) => {
      const order = ['light', 'dim', 'slate', 'ink'] as const;
      view.state.backdrop = order[(order.indexOf(view.state.backdrop) + 1) % order.length];
      refresh();
    },
    on: (view) => view.state.backdrop !== 'light',
    badge: (view) => BACKDROP_LABELS[view.state.backdrop],
  },
  {
    key: 'h',
    label: 'Hover Highlight',
    icon: 'hover',
    run: ({ view, refresh }) => {
      view.state.hoverHighlight = !view.state.hoverHighlight;
      refresh();
    },
    on: (view) => view.state.hoverHighlight,
  },
  {
    key: 'q',
    label: 'Hide What Is Under The Cursor',
    icon: 'hide',
    run: ({ view, hovered, refresh }) => {
      const globalId = hovered();
      if (globalId) view.hide(globalId);
      refresh();
    },
  },
  {
    key: 'w',
    label: 'Bring Back The Last Hidden',
    icon: 'restore',
    run: ({ view, refresh }) => { view.restoreLastHidden(); refresh(); },
  },
  { key: '1', label: 'Look From Above', icon: 'top', run: ({ look }) => look('top') },
  { key: '2', label: 'Look From The Front', icon: 'front', run: ({ look }) => look('front') },
  { key: '3', label: 'Look From The Side', icon: 'side', run: ({ look }) => look('side') },
  { key: 'f', label: 'Fit The Whole Model', icon: 'fit', run: ({ frame }) => frame() },
  {
    key: 's',
    label: 'Frame The Selection',
    icon: 'focus',
    run: ({ frameSelection }) => frameSelection(),
  },
  {
    key: 'r',
    label: 'Reset Everything',
    icon: 'reset',
    run: ({ view, refresh, look }) => { view.reset(); look('corner'); refresh(); },
  },
  { key: 'a', label: 'Fullscreen', icon: 'fullscreen', run: ({ toggleFullscreen }) => toggleFullscreen() },
  { key: '?', label: 'Shortcuts', icon: 'help', run: ({ toggleHelp }) => toggleHelp() },
];

/**
 * Run whatever a key press means, or nothing.
 *
 * Ignored while a person is typing, because a viewer that swallows the letter `t` from a search box is a viewer nobody can search in.
 */
export function handleKey(event: KeyboardEvent, context: ShortcutContext): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const target = event.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
    return false;
  }

  const shortcut = SHORTCUTS.find((entry) => entry.key === event.key.toLowerCase());
  if (!shortcut) return false;
  shortcut.run(context);
  return true;
}
