/**
 * The sensor markers: a dot on each bound object, with its name and value.
 *
 * A marker used to be a sphere sized as a share of the model. On a building
 * of sixty metres seen whole it was a few pixels of grey and the selected
 * one could not be told from the rest. A marker now has a smallest size in
 * pixels, so it stays visible however far away the camera is and the
 * selected one is larger, in the selection colour and labelled in bold.
 */

import {
  Box3, Mesh, MeshBasicMaterial, SphereGeometry, Vector3,
  type Object3D, type PerspectiveCamera,
} from 'three';
import { valueText } from '../alerts.js';
import { displayOf, idOf, objectOf, type Binding } from '../binding.js';
import { rampColour } from '../ramp.js';
import { isLive, DEFAULT_STALE_AFTER_S, type FeedState, type Reading } from '../readings.js';
import { SELECTED_COLOUR } from './appearance.js';
import { createLabel, placeLabel, styleLabel, toScreen } from './markerLabels.js';

/** Pixels across a marker at its smallest. */
export const MARKER_MIN_PX = 14;
/** Pixels across the selected marker at its smallest, so the one a person picked stands out. */
export const SELECTED_MARKER_MIN_PX = 24;
/**
 * The colour of a sensor with no current reading. Off the ramp, so it cannot
 * be mistaken for a value and the same grey the card uses for a stale one.
 */
export const NO_READING_COLOUR = 0x9aa3ad;
/** A dark ring around every dot, so a pale value still shows against a pale wall. */
const RING_COLOUR = 0x1f2933;
const RING_SCALE = 1.3;
/** A marker is at least this share of the model, so it grows with a large building seen close. */
const MARKER_SHARE_OF_MODEL = 0.006;
const MIN_RADIUS_M = 0.05;

/** The size of one screen pixel, in metres, at `distance` from the camera. */
export function worldPerPixel(distance: number, fovDegrees: number, heightPx: number): number {
  if (heightPx <= 0) return 0;
  return (2 * distance * Math.tan((fovDegrees * Math.PI) / 360)) / heightPx;
}

/**
 * The scale a marker of `radius` metres needs to be at least `minPx` pixels
 * across. Never below 1, so a marker seen close keeps its own size.
 */
export function markerScale(
  radius: number, distance: number, fovDegrees: number, heightPx: number, minPx: number,
): number {
  const wanted = (minPx / 2) * worldPerPixel(distance, fovDegrees, heightPx);
  return Math.max(1, wanted / radius);
}

/** A marker's colour: its value on the ramp while current, grey otherwise. */
export function markerColour(
  binding: Binding, reading: Reading | undefined, feed: FeedState,
  staleAfter = DEFAULT_STALE_AFTER_S, now = Date.now(),
): number {
  const ramp = displayOf(binding).ramp;
  if (!ramp || !reading || !isLive(reading, feed, staleAfter, now)) return NO_READING_COLOUR;
  return rampColour(reading.value, ramp[0], ramp[1]);
}

/** The text of a marker's label: its short tag and its value. */
export function labelText(binding: Binding, reading: Reading | undefined): string {
  return `${idOf(binding)}  ${valueText(binding, reading)}`;
}

interface Marker {
  binding: Binding;
  globalId: string | undefined;
  dot: Mesh<SphereGeometry, MeshBasicMaterial>;
  ring: Mesh<SphereGeometry, MeshBasicMaterial>;
  label: HTMLElement;
  live: boolean;
  /** The colour of the latest reading, kept so a marker no longer selected gets it back. */
  colour: number;
}

/** What the canvas does with the markers once they are built. */
export interface MarkerSet {
  readonly count: number;
  /** Recolour the dots and rewrite the labels from the latest readings. */
  showReadings: (readings: Map<string, Reading>, feed: FeedState, staleAfter?: number) => void;
  /** Size the dots and move the labels for this frame. `shown` says whether a sensor's object is visible. */
  place: (
    camera: PerspectiveCamera, width: number, height: number,
    selected: string | null, shown: (globalId: string) => boolean,
  ) => void;
  dispose: () => void;
}

/** One dot, its ring and its label, at the centre of its object. */
function buildMarker(
  model: Object3D, binding: Binding, node: Object3D, shape: SphereGeometry, overlay: HTMLElement,
): Marker {
  // Drawn over the geometry they sit on, or a sensor inside a wall is
  // invisible from outside, which defeats the purpose of a marker. The ring is
  // drawn first and the dot over it.
  const ring = new Mesh(shape, new MeshBasicMaterial({ color: RING_COLOUR, depthTest: false }));
  const dot = new Mesh(shape, new MeshBasicMaterial({ color: NO_READING_COLOUR, depthTest: false }));
  ring.renderOrder = 2;
  dot.renderOrder = 3;
  dot.name = `marker:${idOf(binding)}`;
  const at = new Box3().setFromObject(node).getCenter(new Vector3());
  dot.position.copy(at);
  ring.position.copy(at);
  model.add(ring, dot);
  const label = createLabel(overlay.ownerDocument, binding.label);
  label.textContent = labelText(binding, undefined);
  overlay.appendChild(label);
  return {
    binding, globalId: objectOf(binding), dot, ring, label, live: false, colour: NO_READING_COLOUR,
  };
}

/** Take one marker's latest reading into its colour and its label. */
function readMarker(
  marker: Marker, readings: Map<string, Reading>, feed: FeedState, staleAfter: number,
): void {
  const reading = marker.globalId ? readings.get(marker.globalId) : undefined;
  marker.live = isLive(reading, feed, staleAfter);
  marker.colour = markerColour(marker.binding, reading, feed, staleAfter);
  marker.label.textContent = labelText(marker.binding, reading);
}

function disposeMarker(marker: Marker): void {
  marker.label.remove();
  marker.dot.material.dispose();
  marker.ring.material.dispose();
}

/** Size, colour and label one marker for this frame. */
function placeOne(
  marker: Marker, radius: number, camera: PerspectiveCamera,
  size: { width: number; height: number }, selected: boolean, shown: boolean,
): void {
  const where = marker.dot.getWorldPosition(new Vector3());
  const minPx = selected ? SELECTED_MARKER_MIN_PX : MARKER_MIN_PX;
  const scale = markerScale(radius, camera.position.distanceTo(where), camera.fov, size.height, minPx);
  marker.dot.scale.setScalar(scale);
  marker.ring.scale.setScalar(scale * RING_SCALE);
  marker.dot.visible = shown;
  marker.ring.visible = shown;
  marker.dot.material.color.setHex(selected ? SELECTED_COLOUR : marker.colour);
  styleLabel(marker.label, selected, marker.live);
  placeLabel(marker.label, toScreen(where.project(camera), size.width, size.height), shown);
}

/**
 * Put a marker on every resolved binding, inside `model`, with its label in
 * `overlay`. `modelRadius` sets the size a marker has when seen close.
 */
export function createMarkers(
  model: Object3D,
  resolved: ReadonlyArray<{ binding: Binding; object: { node: Object3D } }>,
  overlay: HTMLElement,
  modelRadius: number,
): MarkerSet {
  const radius = Math.max(modelRadius * MARKER_SHARE_OF_MODEL, MIN_RADIUS_M);
  const shape = new SphereGeometry(radius, 16, 12);
  const markers = resolved.map(({ binding, object }) => buildMarker(model, binding, object.node, shape, overlay));
  return {
    count: markers.length,
    showReadings(readings, feed, staleAfter = DEFAULT_STALE_AFTER_S) {
      for (const marker of markers) readMarker(marker, readings, feed, staleAfter);
    },
    place(camera, width, height, selected, shown) {
      // The labels are projected with the camera of this frame and not the
      // one the last render left behind, or they trail the model as it turns.
      camera.updateMatrixWorld();
      for (const marker of markers) {
        const id = marker.globalId;
        placeOne(marker, radius, camera, { width, height }, id !== undefined && id === selected,
          id === undefined || shown(id));
      }
    },
    dispose() {
      for (const marker of markers) disposeMarker(marker);
      shape.dispose();
    },
  };
}
