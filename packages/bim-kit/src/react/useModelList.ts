/**
 * The models in one folder of the library, named from their own files.
 *
 * The folder can change while its listing is in flight, when a person picks
 * another one. The answer for the folder left behind must never replace the
 * new folder's models, so every answer is tied to the folder it was asked
 * about and an answer for any other folder is not shown.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  contentsUrl,
  pairModels,
  readIfcName,
  uniqueNames,
  type BimModel,
  type LibraryEntry,
} from './assets.js';
import { fetchJson, messageOf, type Problem } from './libraryJson.js';

export type ListFolder = (directory: string) => Promise<LibraryEntry[]>;

export interface ModelList {
  /** Null while the folder is being listed. */
  models: BimModel[] | null;
  problem: Problem | null;
  /** List the folder again, after something has been written to it. */
  reload: () => void;
}

interface Listing {
  /** Which library and folder this answer is for. */
  key: string;
  models: BimModel[] | null;
  problem: Problem | null;
}

type Found = Omit<Listing, 'key'>;

const UNLISTED: Found = { models: null, problem: null };

/**
 * The folder's entries, from the host's `list` when it gives one.
 *
 * The fetched listing is never taken from the browser cache: Jupyter sends
 * it with Last-Modified and no Cache-Control, so a listing read again after
 * a save could miss the file just written.
 */
async function listEntries(
  libraryUrl: string,
  directory: string,
  list: ListFolder | undefined,
): Promise<LibraryEntry[]> {
  if (list) return list(directory);
  const listing = await fetchJson<{ content?: LibraryEntry[] }>(
    contentsUrl(libraryUrl, directory),
    { cache: 'no-store' },
  );
  return listing.content ?? [];
}

/**
 * The models named from the start of each IFC file, read in parallel. A name
 * that cannot be read leaves the file name in place, so this never fails.
 */
async function titled(libraryUrl: string, entries: LibraryEntry[]): Promise<BimModel[]> {
  const ifcs = entries.filter((entry) => entry.name.toLowerCase().endsWith('.ifc'));
  const found = await Promise.all(ifcs.map((entry) => readIfcName(libraryUrl, entry.path)));
  const names = new Map(ifcs.map((entry, i) => [entry.name, found[i]]));
  return pairModels(entries, uniqueNames(names));
}

/**
 * List one folder into `publish`, until the returned function is called.
 *
 * The models are published under their file names first, so the menu is
 * usable while the names are read, then again under the names the files give.
 */
function startListing(
  libraryUrl: string,
  directory: string,
  list: ListFolder | undefined,
  publish: (found: Found) => void,
): () => void {
  let current = true;
  const post = (models: BimModel[], problem: Problem | null = null) => {
    if (current) publish({ models, problem });
  };
  listEntries(libraryUrl, directory, list)
    .then((entries) => {
      post(pairModels(entries));
      return titled(libraryUrl, entries).then((models) => post(models));
    })
    .catch((error: unknown) => post([], {
      summary: 'The shared library could not be listed.',
      detail: messageOf(error),
    }));
  return () => {
    current = false;
  };
}

/**
 * The models in `directory`.
 *
 * `list` is read when a listing starts and is not a dependency, so a host
 * that passes a new function on every render, as it does on every reading,
 * does not list the folder and read every IFC file again each time.
 */
export function useModelList(libraryUrl: string, directory: string, list?: ListFolder): ModelList {
  const [reloads, setReloads] = useState(0);
  const [listing, setListing] = useState<Listing>({ key: '', ...UNLISTED });
  const lister = useRef(list);
  useEffect(() => {
    lister.current = list;
  });
  const key = `${libraryUrl}\n${directory}`;

  useEffect(() => {
    if (!libraryUrl) return undefined;
    const publish = (found: Found) => setListing({ key, ...found });
    return startListing(libraryUrl, directory, lister.current, publish);
  }, [libraryUrl, directory, key, reloads]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);
  const shown = listing.key === key ? listing : UNLISTED;
  return { models: shown.models, problem: shown.problem, reload };
}

export default useModelList;
