/**
 * Listing one folder of the library, and forgetting a stale answer.
 *
 * A person can browse to a second folder before the first folder's listing
 * has come back. When it arrives after that, it must not overwrite what the
 * second folder found, so this tracks which path it last asked for and
 * ignores an answer for any other.
 */

import { useEffect, useState } from 'react';
import type { LibraryEntry } from './assets.js';
import { messageOf } from './libraryJson.js';

export interface FolderListing {
  entries: LibraryEntry[];
  loading: boolean;
  error: string | null;
}

const IDLE: FolderListing = { entries: [], loading: false, error: null };

/** Fetch one folder's listing, ignoring the answer if `path` has moved on by the time it arrives. */
function fetchInto(
  list: (path: string) => Promise<LibraryEntry[]>,
  path: string,
  setState: (state: FolderListing) => void,
): () => void {
  let current = true;
  list(path)
    .then((entries) => {
      if (current) setState({ entries, loading: false, error: null });
    })
    .catch((error: unknown) => {
      if (current) setState({ entries: [], loading: false, error: messageOf(error) });
    });
  return () => {
    current = false;
  };
}

/** The listing for `path`, or nothing asked when `path` is null. */
export function useFolderListing(
  list: (path: string) => Promise<LibraryEntry[]>,
  path: string | null,
): FolderListing {
  const [requestedPath, setRequestedPath] = useState(path);
  const [state, setState] = useState<FolderListing>(IDLE);

  // A path change is applied here, during render, and not through an effect:
  // it must take hold before the browser paints, or the folder just left is
  // shown, for one frame, as if it held the new folder's files.
  if (path !== requestedPath) {
    setRequestedPath(path);
    setState(path === null ? IDLE : { entries: [], loading: true, error: null });
  }

  useEffect(() => {
    if (path === null) return undefined;
    return fetchInto(list, path, setState);
  }, [list, path]);

  return state;
}

export default useFolderListing;
