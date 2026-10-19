import type { DigitalTwinSummary } from '@into-cps-association/dtaas-sdk';

/** A twin is a building when it says so, or when it carries an IFC file. */
const isBimTwin = (dt: DigitalTwinSummary): boolean => dt.domain === 'bim'
  || dt.files.some((file) => file.toLowerCase().endsWith('.ifc'));

export default isBimTwin;
