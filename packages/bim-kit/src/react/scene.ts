/**
 * Reading a loaded glTF scene as the binding resolver wants to see it.
 *
 * The resolver in `@into-cps-association/bim-kit` takes a plain list of
 * objects and knows nothing about three.js, which is what lets it be tested in
 * jsdom where WebGL does not exist. This is the small adapter that produces
 * that list, and it is the only file in the route that knows both sides.
 *
 * A GLB written by `ifc_explorer.to_glb` carries `globalId` in glTF `extras`
 * on every node, which is where the identity comes from. The binding key is
 * the IFC GlobalId, as DTaaS issue 1762 asks, because it survives a re-export
 * and a mesh name does not.
 */

import type { Object3D } from 'three';
import type { SceneObject } from '../resolver.js';

/** One drawable object, with the identity a selector can match on. */
export interface BimObject extends SceneObject {
  node: Object3D;
}

interface GltfExtras {
  globalId?: string;
  ifcClass?: string;
  predefinedType?: string;
}

/**
 * Every object of a loaded model, flattened.
 *
 * Objects with no `globalId` are still returned: a GLB from somewhere else may
 * carry only names, and the resolver accepts a `nodeName` selector for exactly
 * that case.
 */
export function objectsOf(root: Object3D): BimObject[] {
  const found: BimObject[] = [];
  root.traverse((node) => {
    const mesh = node as Object3D & { isMesh?: boolean };
    if (!mesh.isMesh) return;
    const extras = (node.userData ?? {}) as GltfExtras;
    found.push({
      node,
      globalId: extras.globalId,
      nodeName: node.name || undefined,
    });
  });
  return found;
}
