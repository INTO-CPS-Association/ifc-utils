/** The extension's id, which is also its `REACT_APP_EXT_BIM_*` config prefix. */
export const BIM_EXTENSION_ID = 'bim';

/** The absolute mount point. The SDK requires navigation to stay under it. */
export const BIM_ROOT = `/${BIM_EXTENSION_ID}`;

/**
 * The twin domain a building declares in its description front-matter. It
 * reads the same as the extension id, but it is part of the twin's contract
 * and not the extension's, so the two can change apart.
 */
export const BIM_DOMAIN = 'bim';

/** The anchor kind that names an IFC object by its GlobalId. */
export const ANCHOR_KIND = 'ifc-guid';

/** The substrate adapter that draws a building model in the common core. */
export const SUBSTRATE_ADAPTER = 'aec';

/** The colour scheme the building encodings share. */
export const COLOR_SCHEME = 'bim.cold-warm';

/** The signal channel a sensor's measured value arrives on. */
export const CHANNEL = 'measured' as const;
