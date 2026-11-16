/**
 * Empty dist/ before a build.
 *
 * tsc writes what the sources produce and never deletes. A module removed
 * from src/ kept its old output in dist/, and the package would have been
 * published with it.
 */

import { rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
