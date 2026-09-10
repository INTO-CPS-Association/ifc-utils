/**
 * A thin line along the edges of every object.
 *
 * Without it a building is a field of grey boxes that touch, and where one
 * wall ends and the next begins is invisible: a corridor reads as one solid
 * mass, and a door in a wall reads as a slightly different shade. The line is
 * what makes the shapes separable, and it does far more for legibility than
 * any change of colour, because the colours come from the model and most
 * models paint a whole discipline the same.
 *
 * It is drawn as a child of each mesh rather than as a separate pass, so it
 * inherits the mesh's transform, its visibility, and its disposal. A floor
 * filter that hides a wall hides the wall's outline with it, at no cost here.
 */

import {
  BufferGeometry,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  type Mesh,
} from 'three';

/**
 * The colour and weight of the line.
 *
 * A desaturated blue-grey at low opacity, so it reads as a shadow in the
 * crease between two surfaces rather than as an ink outline over the model.
 * These are the values of the viewer this package was taken from, kept so the
 * two draw the same building the same way.
 */
const OUTLINE_COLOUR = 0x33525f;
const OUTLINE_OPACITY = 0.4;

/**
 * Draw the outlines.
 *
 * One material for all of them, because a material is a compiled shader and a
 * building has thousands of objects. The geometries cannot be shared: each one
 * is the edges of its own shape.
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
