/**
 * Live readings for the Buildings page, from the host's signals service.
 *
 * The page opens no connection of its own. A binding's MQTT topic is the
 * signal path the host serves it under, so the kit asks the host for those
 * paths and draws what comes back, which is how `BuildingModels` has always
 * expected readings to arrive.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Sampled, SignalsService } from '@into-cps-association/dtaas-sdk';
import { objectOf, type Binding } from '../binding.js';
import type { FeedState, Reading } from '../readings.js';
import { bindingsByTopic, topicsOf } from '../resolver.js';
import { CHANNEL } from './ids.js';

export interface LiveReadings {
  readonly readings: Map<string, Reading>;
  readonly feed: FeedState;
}

/** `previous` with one sample written onto every object its topic is bound to. */
function withSample(
  previous: Map<string, Reading>,
  targets: readonly Binding[],
  { value, ts }: Sampled,
): Map<string, Reading> {
  if (typeof value !== 'number' || targets.length === 0) return previous;
  const next = new Map(previous);
  targets.forEach((binding) => {
    const globalId = objectOf(binding);
    if (globalId !== undefined) next.set(globalId, { value, receivedAt: ts });
  });
  return next;
}

/** Each bound object's latest stored value, so a card is not blank until the next sample. */
function storedReadings(signals: SignalsService, bindings: Binding[]): Map<string, Reading> {
  let readings = new Map<string, Reading>();
  bindingsByTopic(bindings).forEach((targets, topic) => {
    const stored = signals.valueAt(topic, CHANNEL);
    if (stored) readings = withSample(readings, targets, stored);
  });
  return readings;
}

/**
 * The readings, started again from the store when the bound topics change.
 *
 * The reset happens during render and not in the subscribing effect, which
 * is the pattern React's documentation gives for state that must reset when
 * a prop changes (https://react.dev/learn/you-might-not-need-an-effect).
 * `topics` changes with `bindings`, so every new subscription starts here.
 */
function useResetOnTopicsChange(signals: SignalsService, bindings: Binding[], topics: string[]) {
  const [readings, setReadings] = useState(() => storedReadings(signals, bindings));
  const [seen, setSeen] = useState({ signals, topics });
  if (seen.signals !== signals || seen.topics !== topics) {
    setSeen({ signals, topics });
    setReadings(storedReadings(signals, bindings));
  }
  return [readings, setReadings] as const;
}

/** The latest measured value per GlobalId, and whether the feed behind them is live. */
function useReadings(signals: SignalsService, bindings: Binding[]): LiveReadings {
  const topics = useMemo(() => topicsOf(bindings), [bindings]);
  const [readings, setReadings] = useResetOnTopicsChange(signals, bindings, topics);
  const feed = signals.connection.use(topics);
  useEffect(() => {
    if (topics.length === 0) return undefined;
    const byTopic = bindingsByTopic(bindings);
    return signals.subscribe(topics, CHANNEL, (sample) => setReadings(
      (previous) => withSample(previous, byTopic.get(sample.signalPath) ?? [], sample),
    ));
  }, [signals, bindings, topics, setReadings]);
  return { readings, feed };
}

export default useReadings;
