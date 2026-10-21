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
import { CHANNEL, SIMULATED_CHANNEL } from './ids.js';

/** The channels the page reads, the measured one last so that it wins. */
const CHANNELS = [SIMULATED_CHANNEL, CHANNEL] as const;

type Channel = (typeof CHANNELS)[number];

/** The latest reading per GlobalId, kept apart for each channel. */
type ByChannel = Readonly<Record<Channel, Map<string, Reading>>>;

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

/** Each bound object's latest stored value on one channel. */
function storedOn(signals: SignalsService, bindings: Binding[], channel: Channel) {
  let readings = new Map<string, Reading>();
  bindingsByTopic(bindings).forEach((targets, topic) => {
    const stored = signals.valueAt(topic, channel);
    if (stored) readings = withSample(readings, targets, stored);
  });
  return readings;
}

/** The stored values on both channels, so a card is not blank until the next sample. */
function storedReadings(signals: SignalsService, bindings: Binding[]): ByChannel {
  return {
    [SIMULATED_CHANNEL]: storedOn(signals, bindings, SIMULATED_CHANNEL),
    [CHANNEL]: storedOn(signals, bindings, CHANNEL),
  };
}

/** One map for the page: a simulated value where no measured one exists. */
function merged(byChannel: ByChannel): Map<string, Reading> {
  return new Map([...byChannel[SIMULATED_CHANNEL], ...byChannel[CHANNEL]]);
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

/**
 * The latest value per GlobalId, measured where there is one and simulated
 * otherwise, and whether the feed behind them is live.
 */
function useReadings(signals: SignalsService, bindings: Binding[]): LiveReadings {
  const topics = useMemo(() => topicsOf(bindings), [bindings]);
  const [byChannel, setByChannel] = useResetOnTopicsChange(signals, bindings, topics);
  const feed = signals.connection.use(topics);
  useEffect(() => {
    if (topics.length === 0) return undefined;
    const byTopic = bindingsByTopic(bindings);
    const stops = CHANNELS.map((channel) => signals.subscribe(topics, channel, (sample) =>
      setByChannel((previous) => ({
        ...previous,
        [channel]: withSample(previous[channel], byTopic.get(sample.signalPath) ?? [], sample),
      }))));
    return () => stops.forEach((stop) => stop());
  }, [signals, bindings, topics, setByChannel]);
  const readings = useMemo(() => merged(byChannel), [byChannel]);
  return { readings, feed };
}

export default useReadings;
