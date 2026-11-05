/**
 * Tests for comparing a manifest's source_sha256 with the model file.
 *
 * The digest is Web Crypto, which Node offers as the browser does, so the
 * hash computed here is the one the page computes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { compareSource, sha256Hex, UNKNOWN_HASH } from '../dist/esm/index.js';

const ABC = new TextEncoder().encode('abc');
// The SHA-256 of "abc", from FIPS 180-2, appendix B.1.
const ABC_HASH = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

test('the digest is the SHA-256 of the bytes, in lowercase hexadecimal', async () => {
  assert.equal(await sha256Hex(ABC), ABC_HASH);
});

test('the digest of a view into a larger buffer covers the view only', async () => {
  const larger = new Uint8Array([9, 9, ...ABC, 9]);
  assert.equal(await sha256Hex(larger.subarray(2, 5)), ABC_HASH);
});

test('the digest of a large file matches the hash the Python converter writes', async () => {
  const bytes = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
  assert.equal(await sha256Hex(bytes), createHash('sha256').update(bytes).digest('hex'));
});

test('a runtime with no Web Crypto digest is reported, not ignored', async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  try {
    await assert.rejects(sha256Hex(ABC), /secure/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', saved);
  }
});

test('the same hash is a match', () => {
  assert.deepEqual(compareSource(ABC_HASH, ABC_HASH), { state: 'match', actual: ABC_HASH });
});

test('a hash written in capitals still matches', () => {
  assert.equal(compareSource(ABC_HASH.toUpperCase(), ABC_HASH).state, 'match');
});

test('a different hash is a mismatch that names both', () => {
  const other = '0'.repeat(64);
  assert.deepEqual(compareSource(other, ABC_HASH), {
    state: 'mismatch', expected: other, actual: ABC_HASH,
  });
});

test('unknown in the manifest compares nothing', () => {
  assert.deepEqual(compareSource(UNKNOWN_HASH, ABC_HASH), { state: 'unknown' });
});
