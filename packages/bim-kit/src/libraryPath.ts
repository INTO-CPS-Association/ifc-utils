/**
 * Checking a folder a person typed, or a host read from a URL, before it is
 * used as a path inside the user's library.
 *
 * A folder arrives from places a person controls, such as the `?dir=` query
 * of the DTaaS Buildings page, and a path such as `../other-user` would list
 * a folder outside the library. Nothing here fetches, so it is tested in
 * plain Node.
 */

const UNSAFE = new Set(['', '.', '..']);

const SEPARATOR = /[/\\\0]/;

/** A segment as the server may read it, after one more round of decoding. */
function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isUnsafe(segment: string): boolean {
  const plain = decoded(segment);
  return UNSAFE.has(segment) || UNSAFE.has(plain) || SEPARATOR.test(plain);
}

/**
 * A user-supplied folder as a clean, library-relative path, or `null` when
 * it could leave the library.
 *
 * Percent-encoded dot segments and separators are caught too, because the
 * server may decode them again after this has looked at them.
 */
export function normaliseLibraryPath(raw: string | null | undefined): string | null {
  if (!raw || raw.startsWith('/') || /[\\\0]/.test(raw)) return null;
  const segments = raw.replace(/\/+$/, '').split('/');
  return segments.some(isUnsafe) ? null : segments.join('/');
}
