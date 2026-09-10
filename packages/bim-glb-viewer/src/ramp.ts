/**
 * Turning a reading into a colour.
 *
 * Blue to red is the convention for temperature, and it is also the pair most
 * often confused by the commonest form of colour blindness. So the ramp runs
 * through a light middle: cold is a deep blue, warm is an orange, and the two
 * ends differ in lightness as well as in hue. Read in greyscale, the order
 * still survives.
 *
 * Returns a plain 24 bit number, which three.js, CSS and a canvas all accept,
 * so this file needs no renderer and no colour library.
 */

/** The three stops of the ramp, cold to warm. */
export const RAMP_STOPS = { cold: 0x2b57a8, middle: 0xeceff5, warm: 0xe2733b };

function channels(colour: number): [number, number, number] {
  return [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff];
}

function mix(from: number, to: number, amount: number): number {
  const [fr, fg, fb] = channels(from);
  const [tr, tg, tb] = channels(to);
  const at = (a: number, b: number) => Math.round(a + (b - a) * amount);
  return (at(fr, tr) << 16) | (at(fg, tg) << 8) | at(fb, tb);
}

/**
 * The colour for one value on a ramp, as a 24 bit number.
 *
 * A value outside the range is clamped rather than extrapolated, so an
 * implausible reading looks like the end of the scale instead of a colour the
 * legend never showed. A range of zero width would divide by zero, and is
 * treated as a range of one, which puts everything at the warm end.
 */
export function rampColour(value: number, low: number, high: number): number {
  const span = high - low || 1;
  const t = Math.max(0, Math.min(1, (value - low) / span));
  return t < 0.5
    ? mix(RAMP_STOPS.cold, RAMP_STOPS.middle, t * 2)
    : mix(RAMP_STOPS.middle, RAMP_STOPS.warm, (t - 0.5) * 2);
}
