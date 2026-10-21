import type { EncodingPreset } from '@into-cps-association/dtaas-sdk';
import { CHANNEL, COLOR_SCHEME, SUBSTRATE_ADAPTER } from '../ids.js';

/** A colour scale on the measured value, the encoding both presets share. */
const coldWarm = (domain: [number, number]) => ({
  type: 'colorScale' as const,
  domain,
  scheme: COLOR_SCHEME,
  channel: CHANNEL,
  clamp: true,
});

const presets: EncodingPreset[] = [
  {
    id: 'bim.thermal-comfort',
    label: 'Thermal comfort',
    description: 'Colours each room by its measured temperature, from 18 to 26 °C.',
    substrate: SUBSTRATE_ADAPTER,
    encodings: [{ target: '*/temperature', encoding: coldWarm([18, 26]) }],
  },
  {
    id: 'bim.co2',
    label: 'CO₂',
    description: 'Colours each room by its measured CO₂, from 400 to 1400 ppm.',
    substrate: SUBSTRATE_ADAPTER,
    encodings: [{ target: '*/co2', encoding: coldWarm([400, 1400]) }],
  },
];

export default presets;
