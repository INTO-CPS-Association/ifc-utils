/**
 * Turning a selector into the object it names.
 *
 * The manifest says which object a reading belongs to; this answers what that
 * object actually is in a loaded model. It is the second half of step 1 in
 * the sequence DTaaS issue 1762 proposes, and like the schema it renders
 * nothing and imports no 3D library, so it can be tested in jsdom where WebGL
 * does not exist.
 *
 * The scene is passed in as a plain list rather than as a three.js object, so
 * this file has no opinion about what draws the model. That is the point of
 * the manifest being the load-bearing piece: swap the renderer and this does
 * not change.
 */

import type { Binding, Selector } from './binding.js';

/**
 * One object of a loaded model, reduced to what a selector can match on.
 *
 * Whatever loads the geometry produces these. A GLB written by
 * `ifc_explorer.to_glb` carries `globalId` in glTF `extras` on every node,
 * which is where the first field comes from.
 */
export interface SceneObject {
  globalId?: string;
  nodeName?: string;
  expressId?: number;
}

export interface Resolved<T extends SceneObject> {
  binding: Binding;
  object: T;
}

export interface Unresolved {
  binding: Binding;
  /** Why it did not resolve, in words a person can act on. */
  reason: string;
}

export interface ResolveResult<T extends SceneObject> {
  resolved: Resolved<T>[];
  unresolved: Unresolved[];
}

/**
 * Match every binding against the scene.
 *
 * Bindings that fail are returned rather than dropped. A manifest pointing at
 * an object the geometry does not have is the ordinary consequence of a model
 * being re-exported, and a viewer that silently draws four markers where the
 * manifest asked for six is worse than one that says which two are missing.
 *
 * The lookups are built once, so a manifest with forty bindings against a
 * model with ten thousand objects is forty lookups and not four hundred
 * thousand comparisons.
 */
export function resolveBindings<T extends SceneObject>(
  bindings: Binding[],
  objects: T[],
): ResolveResult<T> {
  const byGlobalId = new Map<string, T>();
  const byNodeName = new Map<string, T[]>();
  const byExpressId = new Map<number, T>();

  for (const object of objects) {
    if (object.globalId !== undefined && !byGlobalId.has(object.globalId)) {
      byGlobalId.set(object.globalId, object);
    }
    if (object.nodeName !== undefined) {
      const seen = byNodeName.get(object.nodeName) ?? [];
      seen.push(object);
      byNodeName.set(object.nodeName, seen);
    }
    if (object.expressId !== undefined && !byExpressId.has(object.expressId)) {
      byExpressId.set(object.expressId, object);
    }
  }

  const resolved: Resolved<T>[] = [];
  const unresolved: Unresolved[] = [];

  for (const binding of bindings) {
    const outcome = resolveOne(binding.selector, byGlobalId, byNodeName, byExpressId);
    if ('object' in outcome) resolved.push({ binding, object: outcome.object });
    else unresolved.push({ binding, reason: outcome.reason });
  }

  return { resolved, unresolved };
}

function resolveOne<T extends SceneObject>(
  selector: Selector,
  byGlobalId: Map<string, T>,
  byNodeName: Map<string, T[]>,
  byExpressId: Map<number, T>,
): { object: T } | { reason: string } {
  if (selector.globalId !== undefined) {
    const object = byGlobalId.get(selector.globalId);
    return object
      ? { object }
      : { reason: `no object carries GlobalId ${selector.globalId}. The model may `
                + 'have been re-exported, which changes every GlobalId in it.' };
  }

  if (selector.nodeName !== undefined) {
    const found = byNodeName.get(selector.nodeName) ?? [];
    if (found.length === 0) {
      return { reason: `no object is named ${selector.nodeName}.` };
    }
    // A name is not an identifier. Two objects sharing one means the binding
    // does not say which, and picking either would be a guess presented as a
    // fact.
    if (found.length > 1) {
      return { reason: `${found.length} objects are named ${selector.nodeName}, so `
                     + 'this does not name one. Use a globalId.' };
    }
    return { object: found[0] };
  }

  if (selector.expressId !== undefined) {
    const object = byExpressId.get(selector.expressId);
    return object
      ? { object }
      : { reason: `no object has express id ${selector.expressId}. An express id is `
                + 'a position in one file and does not survive a re-export.' };
  }

  // The schema refuses an empty selector, so this is only reachable if a
  // caller built one by hand.
  return { reason: 'the selector names nothing.' };
}

/**
 * The MQTT topics a set of bindings needs, without duplicates.
 *
 * Subscribing twice to one topic delivers every message twice, and a binding
 * with no live source is history-only and contributes nothing here.
 */
export function topicsOf(bindings: Binding[]): string[] {
  const topics = new Set<string>();
  for (const binding of bindings) {
    const topic = binding.source.live?.topic;
    if (topic !== undefined) topics.add(topic);
  }
  return [...topics];
}

/**
 * Which binding a message on a topic belongs to.
 *
 * Built once and reused, because this is asked on every message. Two bindings
 * on one topic is legal, since two markers can show the same sensor.
 */
export function bindingsByTopic(bindings: Binding[]): Map<string, Binding[]> {
  const index = new Map<string, Binding[]>();
  for (const binding of bindings) {
    const topic = binding.source.live?.topic;
    if (topic === undefined) continue;
    const seen = index.get(topic) ?? [];
    seen.push(binding);
    index.set(topic, seen);
  }
  return index;
}
