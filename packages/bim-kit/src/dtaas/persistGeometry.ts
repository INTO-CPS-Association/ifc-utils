import type { HostServices } from '@into-cps-association/dtaas-sdk';
import type { BimModel } from '../react/assets.js';

/**
 * Stores a browser conversion beside its IFC file, so the next visit loads it
 * instead of converting again. A failure is logged and passed on, so the page
 * can say the model will convert again next time.
 *
 * It never replaces a file. A geometry made outside the browser is better than
 * one made in it, and an administrator may have placed one since the page
 * listed the folder.
 */
const persistGeometry = (host: HostServices, directory: string) => async (
  model: BimModel,
  glb: Uint8Array,
): Promise<void> => {
  try {
    await host.contents.put(`${directory}/${model.name}.glb`, glb, {
      mimeType: 'model/gltf-binary',
      overwrite: false,
    });
  } catch (error) {
    host.logger.warn('bim: could not store converted geometry', model.name, error);
    throw error;
  }
};

export default persistGeometry;
