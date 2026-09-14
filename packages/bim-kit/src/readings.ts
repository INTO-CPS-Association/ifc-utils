/**
 * What a viewer knows about a reading: how old it is, and what it averages to.
 *
 * A stale number shown as current is worse than no number at all. It is the
 * difference between a demonstration and something a person can act on, so
 * every reading carries when it arrived and every answer here depends on that.
 *
 * Nothing imports a renderer. A caller supplies the readings and the zone each
 * belongs to, and gets back numbers, so this runs where there is no canvas.
 */

import { displayOf, objectOf, type Binding } from './binding.js';

/** A value that arrived, and when. */
export interface Reading {
  value: number;
  /** Milliseconds since the epoch, as `Date.now()` gives them. */
  receivedAt: number;
  /** The unit the payload itself declared, when it declared one. */
  unit?: string;
  /**
   * What the payload calls this value: a sample read off the instrument, an
   * average over an interval, a prediction, the output of a simulation. The
   * word is carried through as it arrived, so a viewer can say which of those
   * a number is instead of presenting all four as a measurement.
   */
  kind?: string;
}

/** Whether the transport is connected, which no age can tell on its own. */
export type FeedState = 'live' | 'connecting' | 'down';

/** How old a reading may be before it stops counting as current, in seconds. */
export const DEFAULT_STALE_AFTER_S = 30;

/** Under this many seconds an age reads better in seconds than in minutes. */
const MINUTES_ABOVE_S = 90;

/** How long ago a reading arrived, in seconds, or null when none has. */
export function ageOf(reading: Reading | undefined, now = Date.now()): number | null {
  if (!reading) return null;
  return (now - reading.receivedAt) / 1000;
}

/**
 * Whether a reading counts as current.
 *
 * Both halves matter. A recent reading on a dead connection is a number nobody
 * can date, and a live connection with nothing arriving is silence.
 */
export function isLive(
  reading: Reading | undefined,
  feed: FeedState,
  staleAfter = DEFAULT_STALE_AFTER_S,
  now = Date.now(),
): boolean {
  const age = ageOf(reading, now);
  return feed === 'live' && age !== null && age <= staleAfter;
}

/** The line under a value that says how old it is, in words. */
export function ageText(
  reading: Reading | undefined,
  feed: FeedState,
  staleAfter = DEFAULT_STALE_AFTER_S,
  now = Date.now(),
): string {
  const age = ageOf(reading, now);
  if (age === null) return 'no message yet';

  const seconds = Math.max(0, Math.round(age));
  const when = seconds < MINUTES_ABOVE_S
    ? `${seconds} s ago`
    : `${Math.round(seconds / 60)} min ago`;
  return isLive(reading, feed, staleAfter, now)
    ? `updated ${when}`
    : `last message ${when}, not live`;
}

/** What a heatmap averages over. */
export type HeatScope = 'off' | 'sensor' | 'room' | 'storey' | 'building';

/** The order the scopes are offered in, coarsest last. */
export const ALL_SCOPES: HeatScope[] = ['off', 'sensor', 'room', 'storey', 'building'];

/** Which zone an object belongs to, at one scope. */
export function zoneOf(
  scope: HeatScope,
  where: { room?: string; storey?: string } | undefined,
): string | undefined {
  if (scope === 'building') return 'building';
  if (scope === 'room') return where?.room;
  if (scope === 'storey') return where?.storey;
  return undefined;
}

/**
 * The scopes worth offering, given where the sensors actually are.
 *
 * The question is not whether the model declares storeys. It is whether the
 * sensors sit on more than one. A scope that puts every sensor in the same
 * group paints the whole model one colour, which is the building mean under
 * another name, and cycling should never land on it. One model here declares
 * ten storeys and has all ten of its sensors on one of them, so asking the
 * model instead of the readings offered a scope that showed nothing.
 *
 * Off and Building are always offered. Building is one group by definition,
 * and that is its meaning instead of a failure of it.
 */
export function availableScopes(
  bindings: Binding[],
  zoneAt: (globalId: string, scope: HeatScope) => string | undefined,
): HeatScope[] {
  return ALL_SCOPES.filter((scope) => {
    if (scope === 'off' || scope === 'building') return true;
    const groups = new Set<string>();
    for (const binding of bindings) {
      const globalId = objectOf(binding);
      const zone = globalId === undefined ? undefined : zoneAt(globalId, scope);
      if (zone !== undefined) groups.add(zone);
    }
    return groups.size > 1;
  });
}

export interface Zones {
  /** The mean reading in each zone. */
  meanByZone: Map<string, number>;
  /** The range the colours span, from the manifest and not from the readings. */
  low: number;
  high: number;
  /** How many readings were current enough to count. */
  counted: number;
}

/**
 * Average the current readings by zone.
 *
 * The range comes from the manifest instead of from the readings, so a colour
 * means the same temperature from one minute to the next. A range that
 * rescaled itself would make a steady building look like a changing one.
 *
 * Returns null when nothing is current, which is what makes the colouring
 * disappear when a broker stops instead of freeze on its last values.
 */
export function zonesOf(
  bindings: Binding[],
  readings: Map<string, Reading>,
  scope: HeatScope,
  zoneAt: (globalId: string) => string | undefined,
  feed: FeedState,
  staleAfter = DEFAULT_STALE_AFTER_S,
  now = Date.now(),
): Zones | null {
  if (scope === 'off') return null;

  const totals = new Map<string, { total: number; count: number }>();
  let counted = 0;
  let range: [number, number] | undefined;

  for (const binding of bindings) {
    const globalId = objectOf(binding);
    if (!globalId) continue;
    const reading = readings.get(globalId);
    if (!isLive(reading, feed, staleAfter, now) || reading === undefined) continue;

    const zone = zoneAt(globalId);
    if (zone === undefined) continue;

    range ??= displayOf(binding).ramp;
    // Several sensors in one zone average, which is what a zone reading is.
    const seen = totals.get(zone) ?? { total: 0, count: 0 };
    totals.set(zone, { total: seen.total + reading.value, count: seen.count + 1 });
    counted += 1;
  }

  if (counted === 0) return null;

  const meanByZone = new Map<string, number>();
  for (const [zone, { total, count }] of totals) meanByZone.set(zone, total / count);

  const [low, high] = range ?? [0, 100];
  return { meanByZone, low, high, counted };
}
