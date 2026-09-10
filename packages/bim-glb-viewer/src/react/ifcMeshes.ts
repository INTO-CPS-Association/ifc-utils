/**
 * Turning converted IFC geometry into something three.js can draw.
 *
 * `@into-cps-association/bim-ifc-converter` returns plain typed arrays and
 * imports no renderer, which is what lets it be tested where there is no
 * canvas. This is the small adapter that meets it, and it is the only file
 * that knows both sides.
 *
 * The result is shaped like a loaded GLB on purpose: one mesh per object, the
 * GlobalId in `userData`, all under one group. A viewer must not be able to
 * tell whether it is looking at geometry converted a moment ago or geometry
 * read from a file, because the same code has to work with both.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import type { Converted, ConvertedObject } from '@into-cps-association/bim-ifc-converter';

/** How transparent a colour has to be before it is drawn as transparent. */
const OPAQUE_ENOUGH = 0.99;

/**
 * One material per colour, not one per object.
 *
 * A building has thousands of objects and a handful of colours. A material per
 * object is thousands of shader programs and a slow first frame.
 */
function materialFor(cache: Map<string, MeshStandardMaterial>, colour: ConvertedObject['colour']) {
  const [r, g, b, a] = colour;
  const key = `${r},${g},${b},${a}`;
  let material = cache.get(key);
  if (!material) {
    material = new MeshStandardMaterial({
      color: new Color(r, g, b),
      metalness: 0,
      roughness: 1,
      // A wall seen from inside is the same wall. Without this a room looks
      // open where the camera has passed through a surface.
      side: DoubleSide,
      transparent: a < OPAQUE_ENOUGH,
      opacity: a,
    });
    cache.set(key, material);
  }
  return material;
}

/**
 * Build the scene contents from a conversion.
 *
 * Returns a group the caller adds to a scene and disposes like any other, so
 * the lifetime rules do not change with the source of the geometry.
 */
export function meshesFrom(converted: Converted): Group {
  const group = new Group();
  group.name = 'ifc';
  const materials = new Map<string, MeshStandardMaterial>();

  for (const object of converted.objects) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(object.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(object.normals, 3));
    geometry.setIndex(new BufferAttribute(object.indices, 1));
    // The converter gives world space vertices, so the bounds have to be
    // computed instead of inherited from a placement.
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const mesh = new Mesh(geometry, materialFor(materials, object.colour));
    mesh.name = object.name ?? object.globalId;
    // The same keys a GLB from `ifc_explorer.to_glb` carries in glTF `extras`,
    // so the resolver sees one shape whichever converter produced the model.
    mesh.userData.globalId = object.globalId;
    mesh.userData.ifcClass = object.ifcClass;
    group.add(mesh);
  }

  return group;
}
