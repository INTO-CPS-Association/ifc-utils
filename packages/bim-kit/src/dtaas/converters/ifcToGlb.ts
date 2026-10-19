import type { Converter } from '@into-cps-association/dtaas-sdk';
import { convertIfc } from '../../converter.js';
import { exportGlb } from '../../react/exportGlb.js';
import { meshesFrom } from '../../react/ifcMeshes.js';

/** IFC to GLB in the browser, by the same path the Buildings page uses. */
const ifcToGlb: Converter = async ({ bytes }) => {
  const converted = await convertIfc(bytes);
  return {
    format: 'glb',
    bytes: await exportGlb(meshesFrom(converted)),
    metadata: {
      schema: converted.schema,
      objects: converted.objects.length,
      failed: converted.failed,
    },
  };
};

export default ifcToGlb;
