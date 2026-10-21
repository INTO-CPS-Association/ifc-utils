/**
 * Serialise a loaded model to the bytes of a binary glTF.
 *
 * `GLTFExporter` is fetched dynamically, so it enters a bundle only when a
 * conversion actually has to be stored, and not on every page that draws a
 * model. The canvas uses this to store a conversion, and the DTaaS
 * extension's IFC to GLB converter uses it to produce one.
 */

import type { Object3D } from 'three';

/**
 * The subset of three's `GLTFExporter` this file uses.
 *
 * Typed here instead of importing the class, so the dynamic import keeps the
 * exporter out of the static module graph.
 */
type GltfExporter = {
  parse(
    input: Object3D,
    onDone: (result: ArrayBuffer | object) => void,
    onError: (error: unknown) => void,
    options: { binary?: boolean; onlyVisible?: boolean },
  ): void;
};

/**
 * `binary: true` asks for a GLB, which arrives as an `ArrayBuffer`.
 * `onlyVisible: false` keeps every object, so a model exported while a floor
 * filter hides part of it still stores the whole building.
 */
export async function exportGlb(model: Object3D): Promise<Uint8Array> {
  const { GLTFExporter } = (await import('three/examples/jsm/exporters/GLTFExporter.js')) as {
    GLTFExporter: new () => GltfExporter;
  };

  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      model,
      (result) => resolve(new Uint8Array(result as ArrayBuffer)),
      (error) => reject(
        error instanceof Error ? error : new Error('the geometry could not be exported'),
      ),
      { binary: true, onlyVisible: false },
    );
  });
}

export default exportGlb;
