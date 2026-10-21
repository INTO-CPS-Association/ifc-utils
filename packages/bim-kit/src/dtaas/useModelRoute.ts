import { useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { normaliseLibraryPath } from '../libraryPath.js';
import { BIM_ROOT } from './ids.js';

export interface ModelRoute {
  /** The folder to show, or `null` when `?dir=` could leave the library. */
  readonly directory: string | null;
  /** The raw `?dir=` value when it was rejected. */
  readonly rejected?: string;
  /** The model named by the `models/:model` route, when there is one. */
  readonly model?: string;
  selectModel(name: string): void;
  selectDirectory(path: string): void;
}

/** `/` stays readable in the query, and everything else is encoded. */
const withDir = (path: string, directory: string) => (
  `${path}?dir=${encodeURIComponent(directory).replace(/%2F/g, '/')}`
);

/** The two navigation actions, kept apart so each hook stays short. */
function useSelectors(directory: string | null) {
  const navigate = useNavigate();
  const selectModel = useCallback((name: string) => {
    if (directory !== null) {
      navigate(withDir(`${BIM_ROOT}/models/${encodeURIComponent(name)}`, directory));
    }
  }, [directory, navigate]);
  const selectDirectory = useCallback(
    (path: string) => navigate(withDir(BIM_ROOT, path)),
    [navigate],
  );
  return { selectModel, selectDirectory };
}

/**
 * The folder and model the URL names, so a model on screen can be bookmarked
 * and shared. `fallback` is the folder shown when the URL names none.
 */
function useModelRoute(fallback: string): ModelRoute {
  const { model } = useParams();
  const [search] = useSearchParams();
  const raw = search.get('dir') || fallback;
  const directory = normaliseLibraryPath(raw);
  const { selectModel, selectDirectory } = useSelectors(directory);
  return {
    directory,
    rejected: directory === null ? raw : undefined,
    model,
    selectModel,
    selectDirectory,
  };
}

export default useModelRoute;
