/**
 * The DTaaS entry point: `import { extension } from '@into-cps-association/bim-kit/dtaas'`.
 *
 * The only object the DTaaS client imports from this package. It declares the
 * Buildings page, its navigation entry, its configuration, and what the kit
 * adds to the client's common visualisation core: the IFC GlobalId anchor,
 * the IFC to GLB converter, the encoding presets and the room and storey
 * scopes. The page is loaded lazily, so the client's main bundle carries the
 * declaration and not the viewer.
 *
 * Kept apart from `./react`, which knows nothing about DTaaS and keeps
 * working in any React application.
 */

import { lazy } from 'react';
import ApartmentIcon from '@mui/icons-material/Apartment';
import { defineExtension } from '@into-cps-association/dtaas-sdk';
import anchorKinds from './anchors.js';
import configSchema from './config.js';
import converters from './converters.js';
import isBimTwin from './detect.js';
import { BIM_EXTENSION_ID, BIM_ROOT } from './ids.js';
import presets from './presets/index.js';
import scopes from './scopes.js';

const BuildingsPage = lazy(() => import('./pages/BuildingsPage.js'));

export const extension = defineExtension({
  id: BIM_EXTENSION_ID,
  name: 'Buildings',
  // The package version, checked by a test so the two cannot drift apart.
  version: '0.2.0',
  sdk: 1,
  routes: [
    { path: '', element: BuildingsPage },
    { path: 'models/:model', element: BuildingsPage },
  ],
  navigation: [{ label: 'Buildings', path: BIM_ROOT, icon: ApartmentIcon, order: 20 }],
  config: { schema: configSchema },
  setup: (host) => {
    // Parsed once here, so a bad setting fails at start-up and not on first visit.
    host.config(configSchema);
    host.logger.info('bim ready');
  },
  visualisation: {
    detect: isBimTwin,
    anchorKinds,
    converters,
    presets,
    scopes,
  },
});

export { BIM_EXTENSION_ID, BIM_ROOT } from './ids.js';
export { default as configSchema, type BimConfig } from './config.js';
export {
  manifestToVisualisation,
  type MigrateOptions,
  type MigrateResult,
  type Skipped,
} from './migrate.js';

export default extension;
