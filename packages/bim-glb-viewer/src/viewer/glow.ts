/**
 * A halo around the object a person just clicked.
 *
 * The selection used to be the object repainted translucent yellow, which
 * works on a wall and fails on the thing most worth clicking: an 85 mm wall
 * thermostat repainted yellow is an 85 mm yellow speck, and on a floor of
 * furniture and pipework nobody can find it. The same failure is written up
 * in `appearance.ts` for the legend highlight.
 *
 * So the selection also gets a halo: the object's own geometry, drawn a
 * little larger, inside out, and added to the light already there. It follows
 * the shape of whatever was picked instead of being a marker floating beside
 * it, which is the shape of thing this project already tried and removed.
 *
 * One mesh and one material for the whole session. The geometry is borrowed
 * from whichever object is selected and never copied, so selecting is a
 * matrix and a pointer.
 */

import {
  AdditiveBlending,
  BackSide,
  Box3,
  BufferGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from 'three';

import { SELECTED_COLOUR } from './appearance.js';

/**
 * How far the halo stands off the object, in metres.
 *
 * A margin in world units instead of a scale factor, because a factor that
 * makes a thermostat visible turns a wall into a second wall. Six centimetres
 * is a ring a person sees across a room and does not read as geometry.
 */
export const GLOW_MARGIN_M = 0.06;

/** Bright enough to find, dim enough that the object stays the thing being looked at. */
const GLOW_OPACITY = 0.55;

/** An object smaller than this in every direction is treated as a point, to avoid dividing by zero. */
const MIN_SIZE_M = 0.001;

export interface Glow {
  /** Put the halo around this object. */
  show(mesh: Mesh): void;
  hide(): void;
  dispose(): void;
}

/**
 * Add the halo to a scene, hidden until something is selected.
 *
 * Additive blending, so the halo brightens what is behind it instead of
 * hiding it, and no depth write, so it never occludes the object it is
 * pointing at. The back side is drawn because the halo is a shell around the
 * object: its front faces are behind the object and would be wasted.
 */
export function createGlow(scene: Object3D): Glow {
  const material = new MeshBasicMaterial({
    color: SELECTED_COLOUR,
    transparent: true,
    opacity: GLOW_OPACITY,
    blending: AdditiveBlending,
    depthWrite: false,
    side: BackSide,
  });

  // The halo borrows the selected object's geometry and owns only this one,
  // which is what it holds while nothing is selected. Keeping them apart is
  // what stops `dispose` from deleting a mesh of the model.
  const empty = new BufferGeometry();
  const halo = new Mesh(empty, material);
  halo.visible = false;
  halo.matrixAutoUpdate = false;
  // Drawn after the model, so the blend has the building underneath it.
  halo.renderOrder = 1;
  scene.add(halo);

  const box = new Box3();
  const size = new Vector3();
  const centre = new Vector3();
  const scale = new Matrix4();
  const toCentre = new Matrix4();
  const fromCentre = new Matrix4();

  return {
    show(mesh: Mesh): void {
      mesh.updateWorldMatrix(true, false);
      box.setFromObject(mesh).getSize(size);

      // One factor for all three axes, worked out from the largest dimension.
      // A factor per axis would be tighter, but it only holds while the object
      // is axis aligned, and an IFC model is full of objects that are not.
      const largest = Math.max(size.x, size.y, size.z, MIN_SIZE_M);
      const factor = (largest + 2 * GLOW_MARGIN_M) / largest;

      // Grown about the geometry's own centre, so the halo stays centred on
      // the object instead of sliding away from the model origin.
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      mesh.geometry.boundingBox?.getCenter(centre);

      halo.geometry = mesh.geometry;
      halo.matrix
        .copy(mesh.matrixWorld)
        .multiply(fromCentre.makeTranslation(centre.x, centre.y, centre.z))
        .multiply(scale.makeScale(factor, factor, factor))
        .multiply(toCentre.makeTranslation(-centre.x, -centre.y, -centre.z));
      halo.visible = true;
    },

    hide(): void {
      halo.visible = false;
      // The geometry belongs to the model, so it is let go instead of
      // disposed: disposing it here would delete the object's own mesh.
      halo.geometry = empty;
    },

    dispose(): void {
      scene.remove(halo);
      halo.geometry = empty;
      empty.dispose();
      material.dispose();
    },
  };
}
