/**
 * Whether the model on screen is the file its manifest was written for.
 *
 * The manifest records the SHA-256 of the IFC file. When the page converts
 * that file here, the canvas hands over the bytes it fetched and they are
 * hashed as they are, so the check costs no second download. When the page
 * draws stored geometry, the IFC file is not otherwise fetched, so it is
 * fetched once for the check, since the hash of the geometry would never
 * equal the hash of the IFC file it was made from.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { compareSource, sha256Hex, UNKNOWN_HASH, type SourceCheck } from '../sourceHash.js';
import { fileUrl, tooLargeToConvert, type BimModel } from './assets.js';

/** The hash of one model's IFC file, or why there is none. */
type Digest = { model: BimModel; hex: string } | { model: BimModel; failed: string };

/** Hash bytes and report the result for one model. */
function digestFor(model: BimModel, bytes: Uint8Array): Promise<Digest> {
  return sha256Hex(bytes)
    .then((hex) => ({ model, hex }))
    .catch((error: Error) => ({ model, failed: error.message }));
}

/** Fetch a model's IFC file and hash it. */
async function fetchDigest(model: BimModel, libraryUrl: string): Promise<Digest> {
  try {
    const response = await fetch(fileUrl(libraryUrl, model.ifcPath), { credentials: 'include' });
    if (!response.ok) return { model, failed: `the IFC file returned HTTP ${response.status}` };
    return await digestFor(model, new Uint8Array(await response.arrayBuffer()));
  } catch (error) {
    return { model, failed: (error as Error).message };
  }
}

/** The result shown for a manifest hash and the digest of the file, if any. */
function resultOf(expected: string, model: BimModel, digest: Digest | null): SourceCheck {
  if (expected === UNKNOWN_HASH) return { state: 'unknown' };
  if (tooLargeToConvert(model)) {
    return { state: 'unchecked', reason: 'the IFC file is too large to read in the browser' };
  }
  if (digest === null || digest.model !== model) return { state: 'pending' };
  if ('failed' in digest) return { state: 'unchecked', reason: digest.failed };
  return compareSource(expected, digest.hex);
}

/**
 * Compare the manifest's `source_sha256` with the model's IFC file.
 *
 * Returns the result, null while no manifest applies and the callback the
 * canvas hands the IFC bytes to when it converts the model here.
 */
export function useSourceCheck(
  model: BimModel | null,
  libraryUrl: string,
  expected: string | null,
): { check: SourceCheck | null; onSourceBytes: (bytes: Uint8Array) => void } {
  const [digest, setDigest] = useState<Digest | null>(null);
  const current = useRef(model);
  current.current = model;
  const compares = expected !== null && expected !== UNKNOWN_HASH;

  useEffect(() => {
    // Only stored geometry needs the file fetched. A model converted here
    // reaches `onSourceBytes` with the bytes the canvas already has.
    if (!model?.geometryPath || !compares || tooLargeToConvert(model)) return undefined;
    let live = true;
    void fetchDigest(model, libraryUrl).then((found) => { if (live) setDigest(found); });
    return () => { live = false; };
  }, [model, libraryUrl, compares]);

  const onSourceBytes = useCallback((bytes: Uint8Array) => {
    const model = current.current;
    // Hashed at once, because the converter may take the buffer over.
    if (model) void digestFor(model, bytes).then((found) => {
      if (current.current === found.model) setDigest(found);
    });
  }, []);

  const check = model === null || expected === null ? null : resultOf(expected, model, digest);
  return { check, onSourceBytes };
}
