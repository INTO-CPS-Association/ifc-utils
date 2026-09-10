/**
 * Holding the state of one loaded model, and applying it to the scene.
 *
 * Two invariants make everything else possible, and both were bought with bugs. `materialFor` is the only thing that decides what an object is painted with, and `refreshVisibility` is the only thing that writes `visible`. When several places wrote either one, the last to run won, and which ran last depended on the order readings arrived.
 *
 * This owns no canvas, no camera and no renderer. It takes a group of meshes and answers what each should look like, so it can be driven by React, by plain JavaScript, or by a test.
 */

import { Box3, type Group, Mesh, type Object3D } from 'three';

import { displayOf, objectOf, type Binding } from '../binding.js';
import {
  DEFAULT_STALE_AFTER_S, isLive, zoneOf, zonesOf,
  type FeedState, type HeatScope, type Reading, type Zones,
} from '../readings.js';
import { bandOf, bandsFrom, type Band } from '../storeys.js';
import { Palette, SHELL } from './appearance.js';

/** What the property tree says about one object. */
export interface ObjectFacts {
  ifcClass?: string;
  storey?: string;
  room?: string;
}

/** The property tree, as `ifc_converter.to_metadata` writes it. */
export interface PropertyTree {
  storeys?: Array<{ name: string }>;
  rooms?: Array<{ name: string }>;
  objects?: Record<string, ObjectFacts>;
}

/** What a person has switched on. */
export interface ViewState {
  storey: string | null;
  heat: HeatScope;
  transparent: boolean;
  slabsHidden: boolean;
  selected: string | null;
  hovered: string | null;
  hoverHighlight: boolean;
}

/** Roofs, slabs and ceilings: the lid that stops a floor being seen into. */
const LIDS = new Set(['IfcSlab', 'IfcRoof', 'IfcCovering']);

/** How far above a storey's floor a lid has to be before it counts as the lid of that floor rather than its floor. A slab's thickness puts its base slightly above the level it defines. */
const LID_MARGIN_M = 0.5;

export class SceneView {
  readonly meshes = new Map<string, Mesh>();

  readonly bands: Band[];

  private readonly palette = new Palette();

  private readonly base = new Map<string, number>();

  private readonly hiddenByHand: string[] = [];

  private zones: Zones | null = null;

  state: ViewState = {
    storey: null,
    heat: 'off',
    transparent: false,
    slabsHidden: false,
    selected: null,
    hovered: null,
    hoverHighlight: true,
  };

  constructor(model: Group, private readonly tree: PropertyTree = {}) {
    const box = new Box3();
    model.traverse((node: Object3D) => {
      const mesh = node as Mesh & { isMesh?: boolean };
      if (!mesh.isMesh) return;
      const globalId = mesh.userData.globalId as string | undefined;
      if (!globalId) return;
      this.meshes.set(globalId, mesh);
      this.palette.remember(globalId, mesh);
      box.setFromObject(mesh);
      if (Number.isFinite(box.min.y)) this.base.set(globalId, box.min.y);
    });

    this.bands = bandsFrom(
      (tree.storeys ?? []).map((storey) => storey.name),
      [...this.base].flatMap(([globalId, base]) => {
        const storey = tree.objects?.[globalId]?.storey;
        return storey ? [{ storey, base }] : [];
      }),
    );
  }

  /** The floors a person can choose, one entry per distinct band. */
  get storeys(): string[] {
    return this.bands.map((band) => band.names[0]);
  }

  /** Whether the model can be grouped by room, and by storey. */
  get groupings(): { rooms: boolean; storeys: boolean } {
    return { rooms: (this.tree.rooms ?? []).length > 0, storeys: this.bands.length > 0 };
  }

  factsOf(globalId: string): ObjectFacts | undefined {
    return this.tree.objects?.[globalId];
  }

  /**
   * Take in the readings and work out the zone averages.
   *
   * Called on every message, so it does the arithmetic and nothing else. The
   * repaint is a separate call, which lets a caller batch a burst of messages
   * into one.
   */
  applyReadings(
    bindings: Binding[],
    readings: Map<string, Reading>,
    feed: FeedState,
    staleAfter = DEFAULT_STALE_AFTER_S,
    now = Date.now(),
  ): void {
    this.zones = zonesOf(
      bindings, readings, this.state.heat,
      (globalId) => this.factsOf(globalId), feed, staleAfter, now,
    );
  }

  /** The colour a heatmap gives one object, or null when it gives none. Null covers three cases that must all leave the object in its own colour: the heatmap is off, no sensor covers the object's zone, and the readings have gone stale. A heatmap of stale values is a confident wrong answer. */
  private heatOf(globalId: string) {
    if (!this.zones) return undefined;
    const zone = zoneOf(this.state.heat, this.factsOf(globalId));
    if (zone === undefined) return undefined;
    const mean = this.zones.meanByZone.get(zone);
    if (mean === undefined) return undefined;
    return this.palette.heatOf(mean, this.zones.low, this.zones.high);
  }

  /** The one decision about what an object is painted with. */
  private materialFor(globalId: string, mesh: Mesh) {
    if (globalId === this.state.selected) return this.palette.selected;
    // Only while hover highlighting is on. Reading a heatmap with a colour
    // following the cursor is unreadable.
    if (this.state.hoverHighlight && globalId === this.state.hovered) return this.palette.hovered;

    const heat = this.heatOf(globalId);
    const base = heat ?? this.palette.baseOf(globalId);
    const ifcClass = mesh.userData.ifcClass as string | undefined;
    if (this.state.transparent && ifcClass && SHELL.has(ifcClass)) {
      return this.palette.ghostOf(base);
    }
    return base;
  }

  /** Paint everything. Called by anything that changes appearance. */
  refreshMaterials(): void {
    for (const [globalId, mesh] of this.meshes) {
      const material = this.materialFor(globalId, mesh);
      if (material) mesh.material = material;
    }
  }

  /**
   * The one place `visible` is written.
   *
   * Three things hide an object and they have to agree: the chosen floor, the lid toggle, and anything hidden by hand. Each writing separately meant the floor filter could bring back a slab the lid toggle had just removed.
   */
  refreshVisibility(): void {
    const band = this.state.storey ? bandOf(this.bands, this.state.storey) : undefined;
    const box = new Box3();

    for (const [globalId, mesh] of this.meshes) {
      let visible = true;

      if (band) {
        box.setFromObject(mesh);
        visible = box.max.y > band.from && box.min.y < band.to;
      }

      if (visible && this.state.slabsHidden) {
        const ifcClass = mesh.userData.ifcClass as string | undefined;
        if (ifcClass && LIDS.has(ifcClass)) {
          // Only the lid above comes off. Hiding every slab takes the floor
          // as well, which leaves the furniture standing on nothing.
          if (!band) visible = false;
          else {
            box.setFromObject(mesh);
            visible = !(box.min.y > band.from + LID_MARGIN_M);
          }
        }
      }

      if (visible && this.hiddenByHand.includes(globalId)) visible = false;
      mesh.visible = visible;
    }
  }

  /** Both, for the common case of a state change that affects both. */
  refresh(): void {
    this.refreshVisibility();
    this.refreshMaterials();
  }

  /** Hide one object, so a person can look past it. */
  hide(globalId: string): void {
    if (!this.meshes.has(globalId) || this.hiddenByHand.includes(globalId)) return;
    this.hiddenByHand.push(globalId);
    this.refreshVisibility();
  }

  /** Bring back the last object hidden, so they come back in the order they went. */
  restoreLastHidden(): void {
    if (this.hiddenByHand.pop()) this.refreshVisibility();
  }

  /** Undo every toggle, so a model reads as it did when it opened. */
  reset(): void {
    this.hiddenByHand.length = 0;
    this.state = {
      ...this.state,
      storey: null,
      heat: 'off',
      transparent: false,
      slabsHidden: false,
      selected: null,
      hovered: null,
    };
    this.zones = null;
    this.refresh();
  }

  /** Which sensors are currently worth colouring by, for a legend to state. */
  liveCount(
    bindings: Binding[],
    readings: Map<string, Reading>,
    feed: FeedState,
    staleAfter = DEFAULT_STALE_AFTER_S,
    now = Date.now(),
  ): number {
    return bindings.filter((binding) => {
      const globalId = objectOf(binding);
      return globalId !== undefined
        && isLive(readings.get(globalId), feed, staleAfter, now)
        && displayOf(binding).ramp !== undefined;
    }).length;
  }

  dispose(): void {
    this.palette.dispose();
    this.meshes.clear();
  }
}
