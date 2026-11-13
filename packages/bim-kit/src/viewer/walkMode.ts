/**
 * Walking through the building at eye height.
 *
 * Looking at a model from outside does not tell a person what a room is like
 * to stand in. Walking puts the camera at eye height on the floor in view and
 * moves it with the arrow keys: up and down to walk forward and back, left
 * and right to turn. The mouse still looks around, because the orbit target
 * is kept a short step in front of the eye, so orbiting turns the head.
 *
 * The arrow keys are used and not W, A, S and D, which are shortcuts already.
 */

import { Vector3, type Camera } from 'three';

/** How high the eye is above the floor, in metres. */
export const EYE_HEIGHT_M = 1.6;

/** How fast a person walks, in metres per second. */
export const WALK_SPEED_M_S = 1.4;

/** How fast a person turns, in degrees per second. */
export const TURN_SPEED_DEG_S = 90;

/** How far in front of the eye the orbit target is kept, in metres. */
export const LOOK_AHEAD_M = 0.5;

/** The arrow keys held down. */
export interface WalkKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

/** The part of the orbit controls walking moves, so a test can pass a plain object. */
export interface WalkControls {
  target: Vector3;
  update: () => void;
}

/** The direction the eye looks, flattened onto the floor. */
function heading(camera: Camera, controls: WalkControls): Vector3 {
  const ahead = controls.target.clone().sub(camera.position);
  ahead.y = 0;
  if (ahead.lengthSq() === 0) ahead.set(0, 0, -1);
  return ahead.normalize();
}

/**
 * Stand at eye height above `floorY`, where the camera is now, looking
 * straight ahead in the direction it was looking.
 */
export function startWalking(camera: Camera, controls: WalkControls, floorY: number): void {
  const ahead = heading(camera, controls);
  camera.position.y = floorY + EYE_HEIGHT_M;
  controls.target.copy(camera.position).addScaledVector(ahead, LOOK_AHEAD_M);
  controls.update();
}

/** Move and turn for one frame of `seconds`, with the keys held. Answers whether anything moved. */
export function stepWalk(camera: Camera, controls: WalkControls, keys: WalkKeys, seconds: number): boolean {
  const turn = (Number(keys.left) - Number(keys.right)) * TURN_SPEED_DEG_S * (Math.PI / 180) * seconds;
  const walk = (Number(keys.forward) - Number(keys.back)) * WALK_SPEED_M_S * seconds;
  if (turn === 0 && walk === 0) return false;
  const ahead = heading(camera, controls);
  if (turn !== 0) ahead.applyAxisAngle(new Vector3(0, 1, 0), turn);
  camera.position.addScaledVector(ahead, walk);
  // The target keeps its height, so walking does not tilt the head the
  // mouse has set.
  const lift = controls.target.y - camera.position.y;
  controls.target.copy(camera.position).addScaledVector(ahead, LOOK_AHEAD_M);
  controls.target.y = camera.position.y + lift;
  controls.update();
  return true;
}

/** Which walking key an arrow key is, or null for any other key. */
export function walkKeyOf(key: string): keyof WalkKeys | null {
  const map: Record<string, keyof WalkKeys> = {
    ArrowUp: 'forward', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right',
  };
  return map[key] ?? null;
}
