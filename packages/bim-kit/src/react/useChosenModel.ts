/**
 * Which model is on screen: the host's `selected` when it gives one, the
 * person's last pick otherwise.
 *
 * The chosen model is held as the object it was when it was chosen, and not
 * looked up afresh from each listing. The canvas is keyed by that object's
 * paths, and a save that adds a GLB beside the model must not redraw the
 * model already on screen. What the page says about the model reads from
 * `current` instead, which follows the latest listing.
 */

import { useCallback, useState } from 'react';
import type { BimModel } from './assets.js';

export interface ChosenModel {
  /** The model the canvas draws. */
  chosen: BimModel | null;
  /** The chosen model as the latest listing describes it. */
  current: BimModel | null;
  /** The host selected a model the folder does not hold. */
  missing: boolean;
  choose: (model: BimModel) => void;
}

interface Pick {
  directory: string;
  model: BimModel | null;
}

export interface ChosenModelOptions {
  models: BimModel[] | null;
  directory: string;
  selected?: string;
  onSelect?: (name: string) => void;
}

/**
 * The model the host's `selected` names, pinned once it has been found.
 *
 * The pick is updated during render and not in an effect, so the model for
 * the previous name is never painted under the new one.
 */
function useSelectedModel({ models, directory, selected }: ChosenModelOptions) {
  const [pick, setPick] = useState<Pick>({ directory, model: null });
  // A model from another folder is never shown, even under the same name.
  let chosen = pick.directory === directory ? pick.model : null;
  if (selected !== undefined && chosen?.name !== selected) {
    const found = models?.find((model) => model.name === selected) ?? null;
    if (found !== pick.model) setPick({ directory, model: found });
    chosen = found;
  }
  return { chosen, setPick };
}

export function useChosenModel(options: ChosenModelOptions): ChosenModel {
  const { models, directory, selected, onSelect } = options;
  const { chosen, setPick } = useSelectedModel(options);

  const choose = useCallback((model: BimModel) => {
    onSelect?.(model.name);
    if (selected === undefined) setPick({ directory, model });
  }, [directory, onSelect, selected, setPick]);

  const current = chosen
    ? models?.find((model) => model.ifcPath === chosen.ifcPath) ?? chosen
    : null;
  // An empty `selected` is a host saying "nothing yet", and not a name.
  const missing = Boolean(selected) && models !== null && chosen === null;
  return { chosen, current, missing, choose };
}

export default useChosenModel;
