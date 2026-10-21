/**
 * Migrating a bim-kit manifest to a `visualisation.json` library asset.
 *
 * The manifest and the asset agree on almost nothing structurally: a manifest
 * groups a sensor with the object it sits on, while an asset groups the
 * transport, the anchors and the encodings each in their own list. This is
 * the one place that translation happens, so a manifest can still be read
 * and edited on its own terms upstream.
 *
 * It sits in the DTaaS entry point and not in `./schema`, because the asset
 * type comes from the SDK, and a consumer of `./schema` outside DTaaS should
 * not need the SDK's types to compile.
 */

import type { VisualisationAsset } from '@into-cps-association/dtaas-sdk';
import { displayOf, objectOf, topicOf, type Binding } from '../binding.js';
import type { Manifest } from '../schema.js';
import {
  ANCHOR_KIND,
  BIM_DOMAIN,
  CHANNEL,
  COLOR_SCHEME,
  SUBSTRATE_ADAPTER,
} from './ids.js';

const SUBSTRATE_ID = 'building';
const SCHEMA_VERSION = '1.0';

export interface MigrateOptions {
  /** `visualisation.json` name. */
  readonly name: string;
  /** MQTT broker the live topics are served from, e.g. `wss://host/ws`. */
  readonly brokerUrl: string;
}

export interface Skipped {
  readonly binding: Binding;
  readonly reason: string;
}

export interface MigrateResult {
  readonly asset: VisualisationAsset;
  /** Bindings with no live topic or no GlobalId, returned so none is lost. */
  readonly skipped: Skipped[];
}

type Anchor = VisualisationAsset['anchors'][number];

interface Anchored {
  readonly binding: Binding;
  readonly anchor: Anchor;
}

/**
 * One binding, sorted into what it can still become.
 *
 * A binding needs both a GlobalId (what an `ifc-guid` anchor refers to) and a
 * live topic (what it anchors) to reach the building substrate. A binding
 * missing either is reported with its reason.
 */
function classify(
  binding: Binding,
): { anchor: Anchored } | { skipped: Skipped } {
  const globalId = objectOf(binding);
  if (globalId === undefined) {
    return {
      skipped: { binding, reason: 'no GlobalId: ifc-guid anchors need one' },
    };
  }

  const topic = topicOf(binding);
  if (topic === undefined) {
    return {
      skipped: {
        binding,
        reason: 'no live topic: history-only bindings have nothing to anchor',
      },
    };
  }

  const anchor = { signalPath: topic, kind: ANCHOR_KIND, ref: globalId };
  return { anchor: { binding, anchor } };
}

function partition(bindings: Binding[]): {
  anchored: Anchored[];
  skipped: Skipped[];
} {
  const anchored: Anchored[] = [];
  const skipped: Skipped[] = [];

  bindings.forEach((binding) => {
    const outcome = classify(binding);
    if ('anchor' in outcome) anchored.push(outcome.anchor);
    else skipped.push(outcome.skipped);
  });

  return { anchored, skipped };
}

/** One mqtt transport naming every live topic once, or none when nothing is live. */
function transportsFor(
  topics: string[],
  brokerUrl: string,
): VisualisationAsset['transports'] {
  if (topics.length === 0) return [];
  return [{ adapter: 'mqtt', url: brokerUrl, topics, channel: CHANNEL }];
}

/** One colour-scale encoding per topic. The first binding on a shared topic wins. */
function encodingsFor(anchored: Anchored[]): VisualisationAsset['encodings'] {
  const bindingByTopic = new Map<string, Binding>();
  anchored.forEach(({ binding, anchor }) => {
    if (!bindingByTopic.has(anchor.signalPath)) {
      bindingByTopic.set(anchor.signalPath, binding);
    }
  });

  return [...bindingByTopic.entries()].map(([topic, binding]) => {
    const { ramp } = displayOf(binding);
    return {
      target: topic,
      substrate: SUBSTRATE_ID,
      encoding: {
        type: 'colorScale' as const,
        domain: ramp ?? [0, 1],
        scheme: COLOR_SCHEME,
        channel: CHANNEL,
        clamp: true,
      },
    };
  });
}

/**
 * Turn a validated manifest into a `visualisation.json` asset for the SDK.
 *
 * A binding with no GlobalId or no live topic cannot anchor a marker on the
 * building substrate, so it comes back in `skipped` instead of vanishing:
 * the person who wrote the manifest decides whether that was intended.
 */
export function manifestToVisualisation(
  manifest: Manifest,
  options: MigrateOptions,
): MigrateResult {
  const { anchored, skipped } = partition(manifest.bindings);
  const topics = [...new Set(anchored.map(({ anchor }) => anchor.signalPath))];

  const asset: VisualisationAsset = {
    schemaVersion: SCHEMA_VERSION,
    name: options.name,
    domain: BIM_DOMAIN,
    layout: { type: 'single', panes: [SUBSTRATE_ID] },
    substrates: {
      [SUBSTRATE_ID]: {
        adapter: SUBSTRATE_ADAPTER,
        source: manifest.model.geometry ?? manifest.model.source,
      },
    },
    transports: transportsFor(topics, options.brokerUrl),
    anchors: anchored.map(({ anchor }) => anchor),
    encodings: encodingsFor(anchored),
  };

  return { asset, skipped };
}
