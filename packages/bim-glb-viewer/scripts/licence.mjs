/**
 * Put the repository's licence into the package before it is packed.
 *
 * npm builds a tarball from the package directory alone, so a published
 * package needs the licence beside it. Keeping a second copy checked in is how
 * two licences come to disagree, so it is copied at pack time and ignored by
 * git.
 */
import { copyFileSync } from 'node:fs';

copyFileSync(new URL('../../../LICENSE.md', import.meta.url), 'LICENSE.md');
