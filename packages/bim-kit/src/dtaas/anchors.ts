import type { AnchorKindSpec } from '@into-cps-association/dtaas-sdk';
import { GLOBAL_ID_PATTERN } from '../binding.js';
import { ANCHOR_KIND, SUBSTRATE_ADAPTER } from './ids.js';

/** A signal anchored to one IFC object, named by its GlobalId. */
const anchorKinds: AnchorKindSpec[] = [
  {
    kind: ANCHOR_KIND,
    substrates: [SUBSTRATE_ADAPTER],
    label: 'IFC GlobalId',
    validateRef: (ref) => GLOBAL_ID_PATTERN.test(ref),
    resolve: (anchor, adapter) => adapter.resolve(anchor),
  },
];

export default anchorKinds;
