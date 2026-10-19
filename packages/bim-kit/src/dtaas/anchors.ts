import type { AnchorKindSpec } from '@into-cps-association/dtaas-sdk';
import { GLOBAL_ID_PATTERN } from '../binding.js';

/** A signal anchored to one IFC object, named by its GlobalId. */
const anchorKinds: AnchorKindSpec[] = [
  {
    kind: 'ifc-guid',
    substrates: ['aec'],
    label: 'IFC GlobalId',
    validateRef: (ref) => GLOBAL_ID_PATTERN.test(ref),
    resolve: (anchor, adapter) => adapter.resolve(anchor),
  },
];

export default anchorKinds;
