/**
 * What is wrong with a sensor, said in words a person can act on.
 *
 * A card that shows a number and nothing else leaves the reader to notice
 * that 92 °C is not a room temperature, that the last message was an hour
 * ago, or that what is on screen was predicted instead of measured. Each of
 * those is a different problem with a different response, so each is named
 * separately here.
 *
 * Everything below is derived from data that already arrived: the bounds come
 * from the manifest, which the converter reads out of the sensor's own
 * property set in the IFC, and the kind and the unit come from the payload.
 * Nothing here holds a threshold of its own, so a building with different
 * limits gets different alerts without a line of this file changing.
 *
 * Nothing imports a renderer, so this runs where there is no canvas.
 */

import { displayOf, type Binding } from './binding.js';
import {
  ageText, isLive, DEFAULT_STALE_AFTER_S, type FeedState, type Reading,
} from './readings.js';

/**
 * How much attention an alert asks for.
 *
 * `warn` is something to act on: the sensor is silent, or the value is
 * outside what the model says it should be. `note` is context that changes
 * how the number should be read but is not itself a fault.
 */
export type AlertLevel = 'warn' | 'note';

export interface Alert {
  level: AlertLevel;
  /** Two or three words, for a chip. */
  label: string;
  /** One sentence saying what it means and where the claim comes from. */
  detail: string;
}

/**
 * The one kind the project data schema calls a direct reading.
 *
 * Anything else is derived: an average over an interval, a prediction, the
 * output of a simulation. The word is printed as it arrived instead of being
 * mapped to a vocabulary invented here, because a publisher that starts
 * sending a new kind should show that kind instead of falling into an "other"
 * bucket nobody can interpret.
 */
export const MEASURED_KIND = 'sample';

/** The DTaaS signal channel for a value read off the instrument. */
export const MEASURED_CHANNEL = 'measured';

/**
 * Every word that means "read off the instrument". `sample` is the older
 * payload kind and stays accepted, so publishers that still send it do not
 * start raising notes.
 */
const MEASURED_WORDS: ReadonlySet<string> = new Set([MEASURED_KIND, MEASURED_CHANNEL]);

/**
 * SenML unit codes (IANA SenML Units registry, RFC 8428 and RFC 8798) and how a
 * manifest usually writes the same unit.
 *
 * A sensor that publishes SenML says `Cel` where the manifest says `°C`.
 * Both name one unit, so they are compared after this map and not as raw
 * text. Only the codes a manifest writes differently are listed. Every other
 * code is compared as it arrived.
 */
const SENML_DISPLAY_UNITS: Readonly<Record<string, string>> = {
  Cel: '°C',
  'm3/s': 'm³/s',
};

/** A unit as a person reads it: `Cel` becomes `°C`, anything unknown stays. */
export function displayUnit(unit: string): string {
  return SENML_DISPLAY_UNITS[unit] ?? unit;
}

/** How many decimals a reading is shown to. More says a precision the sensor does not have. */
const DECIMALS = 1;

/**
 * A reading as a card or a marker label prints it, such as `21.5 °C`, or
 * `Waiting` when nothing has arrived.
 *
 * The payload's own unit wins. A difference from the manifest is one of the
 * alerts, since silently trusting either is a wrong number in a building.
 */
export function valueText(binding: Binding, reading: Reading | undefined): string {
  if (reading === undefined) return 'Waiting';
  const unit = reading.unit !== undefined ? displayUnit(reading.unit) : displayOf(binding).unit;
  const value = reading.value.toFixed(DECIMALS);
  return unit ? `${value} ${unit}` : value;
}

/** The alerts that apply to one sensor, most urgent first. */
export function alertsOf(
  binding: Binding,
  reading: Reading | undefined,
  feed: FeedState,
  staleAfter = DEFAULT_STALE_AFTER_S,
  now = Date.now(),
): Alert[] {
  const alerts: Alert[] = [];

  if (!isLive(reading, feed, staleAfter, now)) {
    alerts.push({
      level: 'warn',
      label: reading === undefined ? 'Never Reported' : 'Not Reporting',
      detail: reading === undefined
        ? 'No message has arrived on this topic since the page opened.'
        : `The sensor has gone quiet: ${ageText(reading, feed, staleAfter, now)}.`,
    });
  }

  const { ramp, unit: declared } = displayOf(binding);

  // Only a current value is worth checking against the bounds. An old reading
  // that was out of range is already covered by the alert above, and saying
  // both makes the stale one look like a live excursion.
  if (reading !== undefined && ramp !== undefined
      && isLive(reading, feed, staleAfter, now)) {
    const [low, high] = ramp;
    if (reading.value < low || reading.value > high) {
      alerts.push({
        level: 'warn',
        label: reading.value > high ? 'Above Range' : 'Below Range',
        detail: `${reading.value} is outside ${low} to ${high} ${declared ?? ''}`.trim()
          + ', the range this sensor declares in the model.',
      });
    }
  }

  if (reading?.unit !== undefined && declared !== undefined
      && displayUnit(reading.unit) !== displayUnit(declared)) {
    alerts.push({
      level: 'warn',
      label: 'Unit Differs',
      detail: `The payload says ${reading.unit} and the manifest says ${declared}, `
        + 'so one of the two is wrong about what this number measures.',
    });
  }

  // The payload's own kind wins over the channel it came on, since it is the
  // more specific of the two.
  const how = reading?.kind ?? reading?.channel;
  if (how !== undefined && !MEASURED_WORDS.has(how)) {
    alerts.push({
      level: 'note',
      label: titleOf(how),
      detail: `The payload declares this value as ${how}, `
        + 'not as a measured value read off the instrument.',
    });
  }

  return alerts;
}

/** How many sensors carry at least one alert of each level. */
export function alertCounts(
  bindings: Binding[],
  readings: Map<string, Reading>,
  objectOfBinding: (binding: Binding) => string | undefined,
  feed: FeedState,
  staleAfter = DEFAULT_STALE_AFTER_S,
  now = Date.now(),
): { warn: number; note: number } {
  let warn = 0;
  let note = 0;
  for (const binding of bindings) {
    const globalId = objectOfBinding(binding);
    const alerts = alertsOf(
      binding, globalId === undefined ? undefined : readings.get(globalId),
      feed, staleAfter, now,
    );
    if (alerts.some((alert) => alert.level === 'warn')) warn += 1;
    else if (alerts.length > 0) note += 1;
  }
  return { warn, note };
}

/** A payload word shown as a label: `prediction` becomes `Prediction`. */
function titleOf(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
