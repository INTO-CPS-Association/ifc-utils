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

// Separators and NUL could leave the library. `?` and `#` would end the path
// part of the URL it is joined into, and `%` would let the server decode a
// segment into something this never looked at, so all are refused outright
// instead of decoded and checked.
const FORBIDDEN = /[/\\\0?#%]/;

function isUnsafe(segment: string): boolean {
  return UNSAFE.has(segment) || FORBIDDEN.test(segment);
}

/**
 * A user-supplied folder as a clean, library-relative path, or `null` when
 * it could leave the library.
 *
 * A folder holding `%`, `?` or `#` is refused as a whole, so a
 * percent-encoded dot segment or separator never reaches the server.
 */
export function normaliseLibraryPath(raw: string | null | undefined): string | null {
  if (!raw || raw.startsWith('/') || /[\\\0]/.test(raw)) return null;
  const segments = raw.replace(/\/+$/, '').split('/');
  return segments.some(isUnsafe) ? null : segments.join('/');
}
