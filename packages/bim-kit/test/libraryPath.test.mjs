/**
 * Tests for normaliseLibraryPath, the check a folder from a URL passes before
 * it is listed. Each rejected case is a way out of the library that a server
 * could still decode after the browser has.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GLOBAL_ID_PATTERN, normaliseLibraryPath } from '../dist/esm/index.js';

test('a folder inside the library is kept, without a trailing slash', () => {
  const cases = [
    ['common/models', 'common/models'],
    ['projects/aarhus/', 'projects/aarhus'],
    ['a b/[3D] c', 'a b/[3D] c'],
  ];
  for (const [raw, clean] of cases) assert.equal(normaliseLibraryPath(raw), clean, raw);
});

test('a folder that could leave the library is refused', () => {
  const cases = [
    '', '/etc', '..', '.', 'a/../b', 'a/./b', 'a//b', 'a\\b', 'projects/%2e%2e/secret',
    'a/%2E', 'a\u0000b', '..%2F..%2Fetc', 'a%2F..%2Fb', 'a%5Cb', null, undefined,
  ];
  for (const raw of cases) assert.equal(normaliseLibraryPath(raw), null, String(raw));
});

test('a folder with a character that changes the URL it is joined into is refused', () => {
  // `?` and `#` would cut the path short, and `%` would be decoded again by the server.
  const cases = ['a?b', 'models?dir=x', 'a#b', 'a/#', '100% done', 'a/%41'];
  for (const raw of cases) assert.equal(normaliseLibraryPath(raw), null, raw);
});

test('the GlobalId pattern is the one the schema and the extension share', () => {
  assert.equal(GLOBAL_ID_PATTERN.test('0_sgz7bzz4Jh2ckU1ehFe$'), true);
  assert.equal(GLOBAL_ID_PATTERN.test('0_sgz7bzz4Jh2ckU1ehFe'), false);
});
