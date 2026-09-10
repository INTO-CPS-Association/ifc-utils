/**
 * Every keyboard shortcut, in one table.
 *
 * The table binds the keys, builds the toolbar and writes the help, so a button and a key cannot disagree. Three lists of the same thing is a bug waiting to be filed, and this viewer had it.
 *
 * The keys follow the ProBIM Explorer, so anyone moving between the two viewers keeps their hands.
 */

import { availableScopes, type HeatScope } from '../readings.js';
import type { SceneView } from './sceneView.js';

/** What a shortcut needs from the page to do its work. */
export interface ShortcutContext {
  view: SceneView;
  /** Repaint after the shortcut has changed something. */
  refresh: () => void;
  /** Put the whole model back in shot. */
  frame: () => void;
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

const SCOPE_LABELS: Record<HeatScope, string> = {
  off: 'Off', room: 'Per Room', storey: 'Per Floor', building: 'Building Mean',
};

/** Move to the next scope the model can actually answer, so cycling never lands on one that colours nothing. */
function cycleHeat(view: SceneView): void {
  const scopes = availableScopes(view.groupings);
  const next = scopes.indexOf(view.state.heat) + 1;
  view.state.heat = scopes[next >= scopes.length ? 0 : next];
}

export const SHORTCUTS: Shortcut[] = [
  {
    key: 'm',
    label: 'Heatmap',
    icon: 'heatmap',
    run: ({ view, refresh }) => { cycleHeat(view); refresh(); },
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
