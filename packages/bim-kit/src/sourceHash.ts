/**
 * Checking that a model file is the one its manifest was written for.
 *
 * A manifest records the SHA-256 of the IFC file its bindings were read from.
 * A re-export keeps the file name and changes every GlobalId inside, so the
 * hash is the one fact that tells a stale manifest from a current one. The
 * schema checks only that the field is well formed and this compares it.
 *
 * Web Crypto is a global of the browser and of Node, so this file imports
 * nothing and stays in the core entry point.
 */

/** The word a manifest uses when its converter could not hash the source. */
export const UNKNOWN_HASH = 'unknown';

/** What comparing a manifest's hash with a model file found. */
export type SourceCheck =
  | { state: 'match'; actual: string }
  | { state: 'mismatch'; expected: string; actual: string }
  | { state: 'unknown' }
  | { state: 'pending' }
  | { state: 'unchecked'; reason: string };

/**
 * The SHA-256 of some bytes, as 64 lowercase hexadecimal characters.
 *
 * Throws when the runtime offers no Web Crypto digest, which a browser does
 * only in a secure context (HTTPS or localhost), so the caller can say why
 * nothing was compared.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('this browser offers no SHA-256 outside a secure (HTTPS) page');
  // Copied into a plain ArrayBuffer, because a view into a larger or shared
  // buffer is not accepted by every runtime.
  const digest = await subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Compare the hash a manifest records with the hash of the file loaded.
 *
 * `unknown` in the manifest means its converter could not hash the source,
 * so there is nothing to compare and the result says so. The case of the
 * hexadecimal digits is ignored, since a hash written by hand may be in
 * capitals.
 */
export function compareSource(expected: string, actual: string): SourceCheck {
  if (expected === UNKNOWN_HASH) return { state: 'unknown' };
  const wanted = expected.toLowerCase();
  const found = actual.toLowerCase();
  return wanted === found
    ? { state: 'match', actual: found }
    : { state: 'mismatch', expected: wanted, actual: found };
}
