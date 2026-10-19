import type { EncodingPreset } from '@into-cps-association/dtaas-sdk';

/** A colour scale on the measured value, the encoding both presets share. */
const coldWarm = (domain: [number, number]) => ({
  type: 'colorScale' as const,
  domain,
  scheme: 'bim.cold-warm',
  channel: 'measured' as const,
  clamp: true,
});

const presets: EncodingPreset[] = [
  {
    id: 'bim.thermal-comfort',
    label: 'Thermal comfort',
    description: 'Colours each room by its measured temperature, from 18 to 26 °C.',
    substrate: 'aec',
    encodings: [{ target: '*/temperature', encoding: coldWarm([18, 26]) }],
  },
  {
    id: 'bim.co2',
    label: 'CO₂',
    description: 'Colours each room by its measured CO₂, from 400 to 1400 ppm.',
    substrate: 'aec',
    encodings: [{ target: '*/co2', encoding: coldWarm([400, 1400]) }],
  },
];

export default presets;
