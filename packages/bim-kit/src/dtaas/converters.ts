import type { ConverterSpec } from '@into-cps-association/dtaas-sdk';

/**
 * IFC to GLB, loaded only when the host converts, so the IFC parser and
 * three.js never enter a bundle that does not convert.
 */
const converters: ConverterSpec[] = [
  {
    id: 'bim.ifc-to-glb',
    from: ['.ifc'],
    to: 'glb',
    load: () => import('./converters/ifcToGlb.js'),
  },
];

export default converters;
