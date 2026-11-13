/**
 * Views a person saves to come back to: where the camera stands and what it
 * looks at, with the floor, the lens and the cuts in force.
 *
 * Kept in the browser's own storage, one list per model, so nothing leaves
 * the person's machine. Storage that is full, blocked or holding something
 * written by another version reads as an empty list and never breaks the page.
 */

import type { ViewState } from './sceneView.js';

/** One saved view. Plain numbers and text, so it survives JSON both ways. */
export interface SavedView {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  storey: string | null;
  parallel: boolean;
  sectioned: boolean;
  vertical: 'x' | 'z' | null;
  heightShift: number;
  depthShift: number;
}

/** The part of `localStorage` used, so a test can pass a plain object. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The most views kept per model, so the list stays something a person can read. */
export const MAX_SAVED_VIEWS = 20;

const triple = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Whether a value read back from storage is a saved view this version can use. */
export function isSavedView(value: unknown): value is SavedView {
  const view = value as Partial<SavedView> | null;
  return !!view
    && typeof view.name === 'string' && view.name.trim() !== ''
    && triple(view.position) && triple(view.target)
    && (view.storey === null || typeof view.storey === 'string')
    && typeof view.parallel === 'boolean' && typeof view.sectioned === 'boolean'
    && (view.vertical === null || view.vertical === 'x' || view.vertical === 'z')
    && typeof view.heightShift === 'number' && typeof view.depthShift === 'number';
}

/** The first "View n" not taken yet. */
export function nextViewName(views: readonly SavedView[]): string {
  const taken = new Set(views.map((view) => view.name));
  let n = views.length + 1;
  while (taken.has(`View ${n}`)) n += 1;
  return `View ${n}`;
}

/** A saved view of the camera and the state as they are now. */
export function snapshot(
  name: string,
  position: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  state: Pick<ViewState, 'storey' | 'parallel' | 'sectioned' | 'vertical' | 'heightShift' | 'depthShift'>,
): SavedView {
  return {
    name,
    position: [position.x, position.y, position.z],
    target: [target.x, target.y, target.z],
    storey: state.storey,
    parallel: state.parallel,
    sectioned: state.sectioned,
    vertical: state.vertical,
    heightShift: state.heightShift,
    depthShift: state.depthShift,
  };
}

export interface ViewStore {
  list(): SavedView[];
  /** Add a view, or replace the one of the same name, and answer the list. */
  save(view: SavedView): SavedView[];
  remove(name: string): SavedView[];
}

export function createViewStore(storage: KeyValueStore | undefined, key: string): ViewStore {
  const read = (): SavedView[] => {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(key) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter(isSavedView) : [];
    } catch {
      return [];
    }
  };
  const write = (views: SavedView[]): SavedView[] => {
    try {
      storage?.setItem(key, JSON.stringify(views));
    } catch {
      // Full or blocked storage: the view is kept for this visit only.
    }
    return views;
  };
  return {
    list: read,
    save(view) {
      const others = read().filter((existing) => existing.name !== view.name);
      return write([...others, view].slice(-MAX_SAVED_VIEWS));
    },
    remove(name) {
      return write(read().filter((view) => view.name !== name));
    },
  };
}
