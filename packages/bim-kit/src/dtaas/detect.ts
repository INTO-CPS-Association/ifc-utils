import type { DigitalTwinSummary } from '@into-cps-association/dtaas-sdk';
import { BIM_DOMAIN } from './ids.js';

/** A twin is a building when it says so, or when it carries an IFC file. */
const isBimTwin = (dt: DigitalTwinSummary): boolean => dt.domain === BIM_DOMAIN
  || dt.files.some((file) => file.toLowerCase().endsWith('.ifc'));

export default isBimTwin;
