/**
 * Stub directories for resolvers that do not read the `exports` map.
 *
 * TypeScript's classic `node` resolution is still in use, the DTaaS client
 * being one place, and it finds a subpath by looking for a directory with a
 * package.json in it.
 *
 * The package ships ES modules only. A CommonJS build was tried and removed:
 * `tsc` turns a dynamic `import()` into `Promise.resolve().then(require(...))`,
 * which a bundler cannot split, and the whole point of loading the canvas
 * lazily is that three.js must not enter the host's main chunk. With the
 * CommonJS build in place the host's bundle grew by 640 KB and the separate
 * chunk disappeared.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

for (const [name, base] of [['react', 'react/index'], ['schema', 'schema']]) {
  mkdirSync(name, { recursive: true });
  writeFileSync(`${name}/package.json`, `${JSON.stringify({
    module: `../dist/esm/${base}.js`,
    types: `../dist/esm/${base}.d.ts`,
  }, null, 2)}\n`);
}
