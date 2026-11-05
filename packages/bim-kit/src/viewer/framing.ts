/**
 * Putting a model, or one object of it, in shot.
 *
 * Kept apart from the canvas so the arithmetic runs in Node, where three.js
 * builds boxes and cameras without a graphics context and can be tested.
 */

import { Box3, Vector3, type Object3D, type PerspectiveCamera } from 'three';

// The limits of the depth range, in metres. They are a floor for the near
// plane and a ceiling for the far one, so a model far smaller than the ceiling
// does not pay for depth it never uses.
export const NEAR_PLANE = 0.1;
export const FAR_PLANE = 5000;

/**
 * The smallest radius an object is framed with, in metres.
 *
 * A sensor is a few centimetres across. Framed at its own size it fills the
 * view and the room around it, which is what tells a person where it is,
 * disappears.
 */
export const MIN_FRAME_RADIUS_M = 1.5;

/**
 * Where the camera sits for each named view, as a direction from the centre.
 *
 * Named instead of written into each shortcut, so adding a fourth is a line
 * here and not a change to the table of keys.
 */
export const LOOK_FROM: Record<string, [number, number, number]> = {
  top: [0, 1, 0.0001],
  front: [0, 0, 1],
  side: [1, 0, 0],
  corner: [1, 0.6, 1],
};

/** The part of the orbit controls framing touches, so a test can pass a plain object. */
export interface Target {
  target: Vector3;
  update: () => void;
}

/**
 * Move the camera to look at `centre` from `direction`, far enough away to
 * see a sphere of `radius`, with a depth range deep enough for `depth`.
 *
 * The distance is the radius over the sine of half the field of view and the
 * metre is clearance so the near face is not against the lens.
 */
function place(
  camera: PerspectiveCamera,
  controls: Target,
  centre: Vector3,
  radius: number,
  direction: Vector3,
  depth: number,
): void {
  const distance = radius / Math.sin((camera.fov * Math.PI) / 360) + 1;
  camera.position.copy(centre).add(direction.clone().normalize().multiplyScalar(distance));
  // Depth precision falls as the ratio of far to near grows and an IFC model
  // has coplanar faces everywhere a slab meets a wall. Once precision runs out
  // those faces flicker against each other, so both planes follow the model.
  // The far plane also reaches across the whole model, so framing one small
  // object does not clip the building behind it.
  camera.near = Math.max(distance / 1000, NEAR_PLANE);
  camera.far = Math.min(Math.max(distance * 10, distance + 2 * depth), FAR_PLANE);
  camera.updateProjectionMatrix();
  controls.target.copy(centre);
  controls.update();
}

/** The centre and the radius of the bounding sphere of an object, or null when it is empty. */
function sphereOf(object: Object3D): { centre: Vector3; radius: number } | null {
  const box = new Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  return {
    centre: box.getCenter(new Vector3()),
    radius: box.getSize(new Vector3()).length() / 2,
  };
}

/** Put the whole model in shot from a named direction and return its radius. */
export function frame(
  camera: PerspectiveCamera,
  controls: Target,
  model: Object3D,
  from: keyof typeof LOOK_FROM = 'corner',
): number {
  const sphere = sphereOf(model);
  if (!sphere) return 1;
  place(camera, controls, sphere.centre, sphere.radius, new Vector3(...LOOK_FROM[from]), sphere.radius);
  return sphere.radius;
}

/**
 * Put one object in shot, keeping the direction the camera already looks
 * from, so a person who turned the model to see a wall does not lose it.
 *
 * Returns false when the object is empty and nothing moved.
 */
export function frameObject(
  camera: PerspectiveCamera,
  controls: Target,
  object: Object3D,
  model: Object3D,
): boolean {
  const sphere = sphereOf(object);
  if (!sphere) return false;
  const direction = camera.position.clone().sub(controls.target);
  if (direction.lengthSq() === 0) direction.set(...LOOK_FROM.corner);
  const depth = sphereOf(model)?.radius ?? sphere.radius;
  place(camera, controls, sphere.centre, Math.max(sphere.radius, MIN_FRAME_RADIUS_M), direction, depth);
  return true;
}
