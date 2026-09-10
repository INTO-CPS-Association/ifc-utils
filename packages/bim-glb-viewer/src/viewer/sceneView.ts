/**
 * Holding the state of one loaded model, and applying it to the scene.
 *
 * Two invariants make everything else possible, and both were bought with bugs. `materialFor` is the only thing that decides what an object is painted with, and `refreshVisibility` is the only thing that writes `visible`. When several places wrote either one, the last to run won, and which ran last depended on the order readings arrived.
 *
 * This owns no canvas, no camera and no renderer. It takes a group of meshes and answers what each should look like, so it can be driven by React, by plain JavaScript, or by a test.
 */

import { Box3, type Group, Mesh, type Object3D, Vector3 } from 'three';

import { displayOf, objectOf, type Binding } from '../binding.js';
import {
  DEFAULT_STALE_AFTER_S, availableScopes, isLive, zoneOf, zonesOf,
  type FeedState, type HeatScope, type Reading, type Zones,
} from '../readings.js';
import { bandOf, bandsFrom, type Band } from '../storeys.js';
import { Palette, SHELL } from './appearance.js';
import { buildField, sourceAt, type Field } from './field.js';

/**
 * What the property tree says about one object.
 *
 * Every field here is written by `ifc_converter.to_metadata` for every object,
 * so none of them is optional because the generator might skip it. They are
 * optional because a tree may come from somewhere else, or not exist at all.
 */
export interface ObjectFacts {
  /** The name the authoring tool gave it, usually family:type:instance. */
  name?: string;
  ifcClass?: string;
  /** IFC's own subtype, for instance a door that is a GATE or a REVOLVING. */
  predefinedType?: string;
  storey?: string;
  room?: string;
  /** What it is cut into: the wall a window sits in, for instance. */
  host?: string;
  /** The property sets the model carries, by set name. */
  properties?: Record<string, Record<string, unknown>>;
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
  /**
   * An IFC class every member of which is highlighted, or null.
   *
   * A legend that only names colours answers "what is this colour" and not
   * "where are the columns", which is the question a person actually has in
   * front of a grey building. Picking the class in the legend answers it.
   */
  highlightedClass: string | null;
}

/** Roofs, slabs and ceilings: the lid that stops a floor being seen into. */
const LIDS = new Set(['IfcSlab', 'IfcRoof', 'IfcCovering']);

/** How far above a storey's floor a lid has to be before it counts as the lid of that floor instead of its floor. A slab's thickness puts its base slightly above the level it defines. */
const LID_MARGIN_M = 0.5;

export class SceneView {
  readonly meshes = new Map<string, Mesh>();

  readonly bands: Band[];

  private readonly palette = new Palette();

  private readonly base = new Map<string, number>();

  private readonly hiddenByHand: string[] = [];

  private zones: Zones | null = null;

  /** The zone averages in force, for anything drawing the field beside the model. */
  get heatZones(): Zones | null {
    return this.zones;
  }

  /** The grid saying which sensor's walk reaches each point of the floor. */
  field: Field | null = null;

  /** The GlobalId behind each index in the field, in the order it was fed. */
  private fieldSources: string[] = [];

  /** The bindings the field was built from, so it is rebuilt only when they change. */
  private fieldKey = '';

  state: ViewState = {
    storey: null,
    heat: 'off',
    transparent: false,
    slabsHidden: false,
    selected: null,
    hovered: null,
    hoverHighlight: true,
    highlightedClass: null,
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

  /**
   * The heat scopes worth offering for a set of bindings.
   *
   * Asked of the readings instead of of the model, because a model that
   * declares ten storeys and carries sensors on one of them can be grouped
   * by storey and gains nothing from it.
   */
  scopesFor(bindings: Binding[]): HeatScope[] {
    this.buildField(bindings);
    return availableScopes(bindings, (globalId, scope) => this.zoneFor(globalId, scope));
  }

  /**
   * The colour the model gives each class of object, for a legend to state.
   *
   * Read from the materials the model arrived with instead of from a table
   * here, because an architect assigned those colours and a legend that
   * invented its own would describe a different building.
   */
  /** How many objects of each class the model holds. */
  classCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const mesh of this.meshes.values()) {
      const ifcClass = mesh.userData.ifcClass as string | undefined;
      if (ifcClass) counts.set(ifcClass, (counts.get(ifcClass) ?? 0) + 1);
    }
    return counts;
  }

  classColours(): Map<string, string> {
    const seen = new Map<string, string>();
    for (const [globalId, mesh] of this.meshes) {
      const ifcClass = mesh.userData.ifcClass as string | undefined;
      if (!ifcClass || seen.has(ifcClass)) continue;
      const material = this.palette.baseOf(globalId);
      const colour = (Array.isArray(material) ? material[0] : material) as
        { color?: { getHexString: () => string } } | undefined;
      if (colour?.color) seen.set(ifcClass, `#${colour.color.getHexString()}`);
    }
    return new Map([...seen].sort(([a], [b]) => a.localeCompare(b)));
  }

  factsOf(globalId: string): ObjectFacts | undefined {
    return this.tree.objects?.[globalId];
  }

  /**
   * How large an object is, in metres, along each world axis.
   *
   * Measured from the geometry instead of read from the tree, because the
   * tree does not carry it and because the number a person wants when they
   * click a wall is the wall in front of them. Y is the height, since the
   * scene is Y up.
   *
   * The box is axis aligned, so a wall running at forty five degrees reports
   * the box around it instead of its length. That is a real limitation and
   * the reason this is labelled as a size instead of as dimensions.
   */
  sizeOf(globalId: string): { x: number; y: number; z: number } | undefined {
    const mesh = this.meshes.get(globalId);
    if (!mesh) return undefined;
    const box = new Box3().setFromObject(mesh);
    if (box.isEmpty()) return undefined;
    const size = box.getSize(new Vector3());
    return { x: size.x, y: size.y, z: size.z };
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
    this.buildField(bindings);
    this.zones = zonesOf(
      bindings, readings, this.state.heat,
      (globalId) => this.zoneFor(globalId), feed, staleAfter, now,
    );
  }

  /**
   * Which zone an object is in, at a scope.
   *
   * The three groupings a model can answer ask it which room or storey the
   * object is in. Per Sensor asks where the object is on the plan and which
   * sensor's walk reaches that point, which is the only one of the four that
   * says anything on a model with no rooms and one storey.
   */
  zoneFor(globalId: string, scope: HeatScope = this.state.heat): string | undefined {
    if (scope !== 'sensor') return zoneOf(scope, this.factsOf(globalId));
    if (this.field === null) return undefined;
    const mesh = this.meshes.get(globalId);
    if (!mesh) return undefined;
    const at = new Box3().setFromObject(mesh).getCenter(new Vector3());
    const index = sourceAt(this.field, at.x, at.z);
    return index < 0 ? undefined : this.fieldSources[index];
  }

  /** The zone one cell of the field belongs to, or undefined where none reaches. */
  zoneAtCell(index: number): string | undefined {
    if (this.field === null) return undefined;
    const source = this.field.owner[index];
    return source < 0 ? undefined : this.fieldSources[source];
  }

  /**
   * Rasterise the floor and flood it from the sensors.
   *
   * Rebuilt when the bindings change, which is when the sources move, and left
   * alone otherwise: the objects do not move and neither do the sensors.
   */
  buildField(bindings: Binding[]): void {
    const key = bindings.map((binding) => objectOf(binding) ?? '').join(',');
    if (key === this.fieldKey) return;
    this.fieldKey = key;
    this.fieldSources = [];
    this.field = null;
    if (bindings.length === 0) return;

    const box = new Box3();
    const sources: Vector3[] = [];
    for (const binding of bindings) {
      const globalId = objectOf(binding);
      const mesh = globalId === undefined ? undefined : this.meshes.get(globalId);
      if (!mesh || globalId === undefined) continue;
      sources.push(box.setFromObject(mesh).getCenter(new Vector3()));
      this.fieldSources.push(globalId);
    }
    // The lowest band is the floor a single storey model has, and the chosen
    // one otherwise. The cut has to be inside the storey being drawn.
    const chosen = this.state.storey;
    const band = this.bands.find((b) => b.names.includes(chosen ?? '')) ?? this.bands[0];
    this.field = buildField(this.meshes.values(), sources, band ? band.from : 0);
  }

  /** The colour a heatmap gives one object, or null when it gives none. Null covers three cases that must all leave the object in its own colour: the heatmap is off, no sensor covers the object's zone, and the readings have gone stale. A heatmap of stale values is a confident wrong answer. */
  private heatOf(globalId: string) {
    if (!this.zones) return undefined;
    const zone = this.zoneFor(globalId);
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
    // Below the cursor and below the selection, so pointing at one object
    // still says which one, and above the heatmap, since a person who asked
    // where the walls are is asking that and not what temperature they are.
    if (this.state.highlightedClass
      && mesh.userData.ifcClass === this.state.highlightedClass) {
      return this.palette.highlighted;
    }

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
