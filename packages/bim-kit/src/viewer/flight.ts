/**
 * Moving the camera to a new shot smoothly instead of in one jump.
 *
 * A jump loses the person: after picking a sensor in a list they see a
 * different building and have to work out where they are. A short flight
 * keeps the way from one shot to the other on screen.
 *
 * The framing functions decide where the camera ends up and stay as they are.
 * A flight runs one of them, reads where it put the camera, puts the camera
 * back and then moves it there over a few hundred milliseconds. A person who
 * asked their system to reduce motion gets the jump.
 */

import { type Camera, type Matrix4, Vector3 } from 'three';

/** How long a flight takes, in milliseconds. */
export const FLIGHT_MS = 600;

/** Ease in and out, so the camera neither lurches off nor stops dead. */
export function ease(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

/** The part of the orbit controls a flight moves, so a test can pass a plain object. */
export interface Steered {
  target: Vector3;
  update: () => void;
}

export interface Flight {
  /** Run `change`, which moves the camera, and fly there instead of jumping. */
  fly(change: () => void, now?: number): void;
  /** Move the camera for this frame. Answers whether a flight is still under way. */
  step(now: number): boolean;
  /** Stop where the camera is, for a person who grabbed the view mid-flight. */
  cancel(): void;
  readonly flying: boolean;
}

/** Whether the person asked their system to reduce motion. */
export function prefersReducedMotion(): boolean {
  return typeof globalThis.matchMedia === 'function'
    && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createFlight(
  camera: Camera,
  controls: Steered,
  durationMs = FLIGHT_MS,
  reduced = prefersReducedMotion(),
): Flight {
  let start = 0;
  let active = false;
  const from = { position: new Vector3(), target: new Vector3() };
  const to = { position: new Vector3(), target: new Vector3() };

  const put = (position: Vector3, target: Vector3) => {
    camera.position.copy(position);
    controls.target.copy(target);
    controls.update();
  };

  return {
    fly(change, now = performance.now()) {
      from.position.copy(camera.position);
      from.target.copy(controls.target);
      change();
      if (reduced || durationMs <= 0) {
        active = false;
        return;
      }
      to.position.copy(camera.position);
      to.target.copy(controls.target);
      // Already there: any flight under way stops too, since this shot replaces it.
      if (from.position.equals(to.position) && from.target.equals(to.target)) {
        active = false;
        return;
      }
      // Back to where it was, so the first frame of the flight starts there.
      put(from.position, from.target);
      start = now;
      active = true;
    },
    step(now) {
      if (!active) return false;
      const t = ease((now - start) / durationMs);
      put(
        from.position.clone().lerp(to.position, t),
        from.target.clone().lerp(to.target, t),
      );
      if (t >= 1) active = false;
      return active;
    },
    cancel() {
      active = false;
    },
    get flying() {
      return active;
    },
  };
}

/**
 * Whether the camera moved by more than a person could see. The damping of
 * the orbit controls keeps moving the camera by ever smaller amounts for
 * seconds after a drag, and an exact comparison would keep the view drawing
 * every frame all that time.
 */
export function movedBeyond(before: Matrix4, after: Matrix4, tolerance = 1e-5): boolean {
  const a = before.elements;
  const b = after.elements;
  for (let i = 0; i < 16; i += 1) {
    if (Math.abs(a[i] - b[i]) > tolerance * (1 + Math.abs(b[i]))) return true;
  }
  return false;
}
