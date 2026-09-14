/**
 * A thin line along the edges of every object.
 *
 * Without it a building is a field of grey boxes that touch and a corridor
 * reads as one solid mass. Most exporters paint a whole discipline one colour,
 * so the line does more for legibility than any change of colour can.
 *
 * Drawn as a child of each mesh, so it inherits the transform, the visibility
 * and the disposal: hiding a wall hides its outline at no cost here.
 */

import {
  BufferGeometry,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  type Mesh,
} from 'three';

/** A desaturated blue-grey at low opacity, so it reads as a shadow in a crease and not as ink over the model. */
const OUTLINE_COLOUR = 0x33525f;
const OUTLINE_OPACITY = 0.4;

/**
 * Draw the outlines.
 *
 * One material for all of them, because a material is a compiled shader and a
 * building has thousands of objects. The geometries cannot be shared.
 *
 * The meshes are read into a list first. Adding a child while traversing the
 * thing being traversed walks into what was just added.
 */
export function addOutlines(meshes: Iterable<Mesh>): void {
  const material = new LineBasicMaterial({
    color: OUTLINE_COLOUR,
    opacity: OUTLINE_OPACITY,
    transparent: true,
  });

  for (const mesh of [...meshes]) {
    const geometry = mesh.geometry as BufferGeometry | undefined;
    if (!geometry) continue;
    const outline = new LineSegments(new EdgesGeometry(geometry), material);
    // Named so anything walking the scene can tell an outline from a model
    // object without guessing from its type.
    outline.name = 'outline';
    mesh.add(outline);
  }
}
