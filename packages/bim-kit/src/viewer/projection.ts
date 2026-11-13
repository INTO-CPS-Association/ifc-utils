/**
 * Switching between a perspective view and a view with parallel lines.
 *
 * A plan or an elevation is read with parallel lines: a wall seen square on
 * shows its true length and two walls of the same height look the same height
 * however far apart they are. Instead of a second, orthographic camera, which
 * every sizing and framing function here would then have to handle, the lens
 * narrows to a degree and a half and the camera backs off by as much as the
 * lens narrowed. What is in shot stays the same size and the lines are
 * parallel to within a fraction of a pixel.
 */

import type { PerspectiveCamera, Vector3 } from 'three';

/** The lens of the ordinary view, in degrees. */
export const PERSPECTIVE_FOV = 45;

/** The lens of the parallel view, in degrees. Narrow enough that the lines read as parallel. */
export const PARALLEL_FOV = 1.5;

/** How much farther the camera has to be with lens `to` to see what lens `from` saw. */
export function backOff(from: number, to: number): number {
  return Math.tan((from * Math.PI) / 360) / Math.tan((to * Math.PI) / 360);
}

/** The part of the orbit controls this touches, so a test can pass a plain object. */
export interface Orbit {
  target: Vector3;
  update: () => void;
}

/**
 * Turn the parallel view on or off, keeping the same thing in shot.
 *
 * The camera moves along the line it looks down and the depth range grows or
 * shrinks with the distance, so nothing near the target is clipped.
 */
export function setParallel(camera: PerspectiveCamera, controls: Orbit, parallel: boolean): void {
  const wanted = parallel ? PARALLEL_FOV : PERSPECTIVE_FOV;
  if (camera.fov === wanted) return;
  const factor = backOff(camera.fov, wanted);
  const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor);
  camera.position.copy(controls.target).add(offset);
  camera.near *= factor;
  camera.far *= factor;
  camera.fov = wanted;
  camera.updateProjectionMatrix();
  controls.update();
}
