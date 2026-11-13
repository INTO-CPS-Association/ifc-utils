/**
 * Holding the state of one loaded model, and applying it to the scene.
 *
 * Two invariants make everything else possible, and both were bought with bugs. `materialFor` is the only thing that decides what an object is painted with, and `refreshVisibility` is the only thing that writes `visible`. When several places wrote either one, the last to run won, and which ran last depended on the order readings arrived.
 *
 * This owns no canvas, no camera and no renderer. It takes a group of meshes and answers what each should look like, so it can be driven by React, by plain JavaScript, or by a test.
 */

import { Box3, type Group, Mesh, type Object3D, Plane, Vector3 } from 'three';

import { displayOf, objectOf, type Binding } from '../binding.js';
import {
  DEFAULT_STALE_AFTER_S, availableScopes, isLive, zoneOf, zonesOf,
  type FeedState, type HeatScope, type Reading, type Zones,
} from '../readings.js';
import { bandOf, bandsFrom, FLOOR_MARGIN_M, type Band } from '../storeys.js';
import { type Glow } from './glow.js';
import { Palette, SHELL, CLASS_COLOURS, type ModelStyle } from './appearance.js';
import { buildField, sourceAt, CUT_M, OUTSIDE, type Field } from './field.js';
import type { MeasureMode } from './measure.js';
import type { TreeEntry } from './modelTree.js';
import type { SketchTool } from './sketch.js';

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
  /** Whether the floor in view is cut at chest height, so it reads as a plan. */
  sectioned: boolean;
  /** Whether the grid of metres under the model is drawn. */
  grid: boolean;
  /** The one object shown alone, or null when everything is shown. */
  isolated: string | null;
  /** What a click measures instead of selecting, or null when it selects. */
  measuring: MeasureMode | null;
  /** Whether the view draws with parallel lines, for reading plans and elevations. */
  parallel: boolean;
  /** Whether the sun throws shadows. */
  shadows: boolean;
  /** A vertical cut through the middle of the model, across the X or the Z axis, or none. */
  vertical: 'x' | 'z' | null;
  /** How far the horizontal cut is moved from chest height, in metres. */
  heightShift: number;
  /** How far the vertical cut is moved from the middle of the model, in metres. */
  depthShift: number;
  /** What the model is painted with, before any heatmap, highlight or ghost. */
  style: ModelStyle;
  /** The background behind the model. */
  backdrop: Backdrop;
  /** Whether the camera walks at eye height instead of orbiting. */
  walking: boolean;
  /** The tool drawing on the view, or null when the mouse drives the model. */
  sketching: SketchTool | null;
}

/** The backgrounds a person can choose. */
export type Backdrop = 'light' | 'dim' | 'slate' | 'ink';

/** The colour of each background, the light one the colour the viewer always had. */
export const BACKDROPS: Record<Backdrop, number> = {
  light: 0xe9edef,
  dim: 0xc5ccd1,
  slate: 0x56636b,
  ink: 0x1d2327,
};

/** How far one press of j or k moves a cut, in metres. */
export const CUT_STEP_M = 0.25;

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
    sectioned: false,
    grid: true,
    isolated: null,
    measuring: null,
    parallel: false,
    shadows: true,
    vertical: null,
    heightShift: 0,
    depthShift: 0,
    style: 'shaded',
    backdrop: 'light',
    walking: false,
    sketching: null,
  };

  /** The middle of the model, where a vertical cut starts. */
  private readonly middle = new Vector3();

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
    const whole = new Box3().setFromObject(model);
    if (!whole.isEmpty()) whole.getCenter(this.middle);

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
    if (this.state.style === 'classes') {
      const order = [...this.classCounts().keys()].sort();
      return new Map(order.map((ifcClass, index) => [
        ifcClass, `#${CLASS_COLOURS[index % CLASS_COLOURS.length].toString(16).padStart(6, '0')}`,
      ]));
    }
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

  /**
   * Every object as the model tree lists it: its name and class from the
   * property tree when it has one, from the geometry otherwise, and the floor
   * its band puts it on.
   */
  entries(): TreeEntry[] {
    return [...this.meshes].map(([globalId, mesh]) => {
      const facts = this.factsOf(globalId);
      const ifcClass = facts?.ifcClass ?? (mesh.userData.ifcClass as string | undefined) ?? 'IfcProduct';
      const base = this.base.get(globalId);
      const band = base === undefined ? undefined
        : this.bands.find((candidate) => base >= candidate.from && base < candidate.to);
      const values = Object.values(facts?.properties ?? {})
        .flatMap((set) => Object.values(set ?? {}))
        .map((value) => String(value));
      return {
        globalId,
        name: facts?.name ?? (mesh.name || globalId),
        ifcClass,
        storey: facts?.storey ?? band?.names[0] ?? null,
        values,
      };
    });
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
    // The storey is part of the key, not only the bindings. The cut runs
    // 1.2 m above the floor of the storey in force, and the cut is what
    // decides which objects are walls, so a field built for the ground floor
    // describes the ground floor and nothing else. Leaving it out is why the
    // heatmap only ever worked on the first level.
    const key = [this.state.storey, ...bindings.map((b) => objectOf(b) ?? '')].join(',');
    if (key === this.fieldKey) return;
    this.fieldKey = key;
    this.fieldSources = [];
    this.field = null;
    if (bindings.length === 0) return;

    // The lowest band is the floor a single storey model has, and the chosen
    // one otherwise. The cut has to be inside the storey being drawn.
    const band = this.state.storey ? bandOf(this.bands, this.state.storey) : undefined;
    const floor = band ?? this.bands[0];

    const box = new Box3();
    const sources: Vector3[] = [];
    for (const binding of bindings) {
      const globalId = objectOf(binding);
      const mesh = globalId === undefined ? undefined : this.meshes.get(globalId);
      if (!mesh || globalId === undefined) continue;
      const at = box.setFromObject(mesh).getCenter(new Vector3());
      // A sensor on the ground floor says nothing about the floor above it.
      // Without this, every sensor in the building was flooded onto whichever
      // plan was on screen, so the second storey showed the first one's heat.
      // With no floor chosen the whole building is on screen at once, and
      // every sensor belongs to what is drawn.
      if (band && (at.y <= band.from || at.y >= band.to)) continue;
      sources.push(at);
      this.fieldSources.push(globalId);
    }
    this.field = buildField(this.meshes.values(), sources, floor ? floor.from : 0);
  }

  /** The colour a heatmap gives one object, or null when it gives none. Null covers three cases that must all leave the object in its own colour: the heatmap is off, no sensor covers the object's zone, and the readings have gone stale. A heatmap of stale values is a confident wrong answer. */
  private heatOf(globalId: string) {
    if (!this.zones) return undefined;
    // Per Sensor colours an object by the sensor that reaches its centre. A
    // slab or a roof spans every room, so that would paint the whole floor as
    // one sensor's room. The field sheet shows the split over the floor.
    const ifcClass = this.meshes.get(globalId)?.userData.ifcClass as string | undefined;
    // The Building Mean painted the whole site, and Per Sensor painted it in
    // the colour of whichever sensor reached its centre.
    if (ifcClass && OUTSIDE.has(ifcClass)) return undefined;
    if (this.state.heat === 'sensor' && ifcClass && LIDS.has(ifcClass)) return undefined;
    const zone = this.zoneFor(globalId);
    if (zone === undefined) return undefined;
    const mean = this.zones.meanByZone.get(zone);
    if (mean === undefined) return undefined;
    return this.palette.heatOf(mean, this.zones.low, this.zones.high);
  }

  /** The sorted classes of the model, so each keeps its colour in the colour by class style. */
  private classOrder: string[] | null = null;

  /** What an object is painted with in the style in force, before heat, highlight or ghost. */
  private styled(globalId: string, mesh: Mesh) {
    const own = this.palette.baseOf(globalId);
    switch (this.state.style) {
      case 'mono':
        return this.palette.mono;
      case 'wireframe':
        return this.palette.wireOf(own);
      case 'classes': {
        this.classOrder ??= [...this.classCounts().keys()].sort();
        return this.palette.classAt(this.classOrder.indexOf(String(mesh.userData.ifcClass ?? '')));
      }
      default:
        return own;
    }
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
    const base = heat ?? this.styled(globalId, mesh);
    const ifcClass = mesh.userData.ifcClass as string | undefined;
    if (this.state.transparent && ifcClass && SHELL.has(ifcClass)) {
      return this.palette.ghostOf(base);
    }
    return base;
  }

  /**
   * Lend this view a halo to put around the selected object.
   *
   * The halo lives in the scene and the scene belongs to whatever draws, so
   * it is handed in instead of made here. What this owns is the decision of
   * when it is on, which belongs beside the rest of the appearance rules.
   */
  attachGlow(glow: Glow | null): void {
    this.glow = glow;
    this.refreshMaterials();
  }

  private glow: Glow | null = null;

  /** Paint everything. Called by anything that changes appearance. */
  refreshMaterials(): void {
    for (const [globalId, mesh] of this.meshes) {
      const material = this.materialFor(globalId, mesh);
      if (material) mesh.material = material;
    }

    if (this.glow === null) return;
    const selected = this.state.selected === null
      ? undefined
      : this.meshes.get(this.state.selected);
    // A halo around an object the floor filter has hidden is a glow around
    // nothing, on a floor the object is not even on.
    if (selected?.visible) this.glow.show(selected);
    else this.glow.hide();
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
      // Isolating shows the one object whatever the floor and the lid say,
      // since a person who asked to see it alone asked to see it.
      if (this.state.isolated !== null) visible = globalId === this.state.isolated;
      mesh.visible = visible;
    }
  }

  /**
   * Where the section cuts, in metres, or null when it is off.
   *
   * At chest height above the floor in view, the same height the heatmap's
   * plan is cut at (`field.ts`), so a doorway reads as a gap and a desk does
   * not, and the section and the plan show the same rooms. With no floor
   * chosen it cuts the lowest one, since a cut through the whole building at
   * one height says nothing about the floors above it.
   */
  cutHeight(): number | null {
    if (!this.state.sectioned) return null;
    const band = this.state.storey ? bandOf(this.bands, this.state.storey) : undefined;
    const floor = band ?? this.bands[0];
    if (floor) return floor.from + CUT_M + this.state.heightShift;
    // A model without storeys is cut above the lowest wall, since walls stand
    // on the floor. The lowest object is often the terrain or a foundation a
    // metre down, and a cut above that shows only the stubs of the walls.
    const walls = [...this.base].filter(([globalId]) =>
      String(this.meshes.get(globalId)?.userData.ifcClass ?? '').startsWith('IfcWall'));
    const bases = (walls.length > 0 ? walls : [...this.base]).map(([, base]) => base);
    const lowest = Math.min(...bases);
    return Number.isFinite(lowest) ? lowest + CUT_M + this.state.heightShift : null;
  }

  /**
   * The height of the floor in view, where a person stands and the heat
   * sheet lies: the base of the lowest wall on the chosen floor, or on the
   * lowest floor when none is chosen.
   *
   * The walls and not the floor band, because a band starts below its own
   * floor slab: on an upper floor the band's edge is the underside of the
   * slab, and a sheet laid there was hidden inside it.
   */
  floorLevel(): number {
    const band = this.state.storey ? bandOf(this.bands, this.state.storey) : undefined;
    const floor = band ?? this.bands[0];
    const isWall = (globalId: string) =>
      String(this.meshes.get(globalId)?.userData.ifcClass ?? '').startsWith('IfcWall');
    const inFloor = (base: number) => !floor || (base >= floor.from && base < floor.to);
    const walls = [...this.base].filter(([globalId, base]) => isWall(globalId) && inFloor(base));
    if (walls.length > 0) return Math.min(...walls.map(([, base]) => base));
    if (floor) return floor.from + FLOOR_MARGIN_M;
    const lowest = Math.min(...this.base.values());
    return Number.isFinite(lowest) ? lowest : 0;
  }

  /**
   * Every cut in force, as planes that keep what is on their positive side.
   *
   * The horizontal one keeps what is below it and the vertical one what is
   * on the near side of the middle of the model, so a cut along X shows the
   * building as a long section and one along Z as a cross section.
   */
  cutPlanes(): Plane[] {
    const planes: Plane[] = [];
    const height = this.cutHeight();
    if (height !== null) planes.push(new Plane(new Vector3(0, -1, 0), height));
    const { vertical, depthShift } = this.state;
    if (vertical === 'x') planes.push(new Plane(new Vector3(-1, 0, 0), this.middle.x + depthShift));
    if (vertical === 'z') planes.push(new Plane(new Vector3(0, 0, -1), this.middle.z + depthShift));
    return planes;
  }

  /** The box around each object, measured once, since the objects do not move. */
  private readonly boxes = new Map<string, Box3>();

  /**
   * Whether an object is drawn: visible and, when a cut is in force, with some
   * part of it on the kept side. A wall the plan cut runs through is still
   * drawn up to the cut, so its sensor stays. A sensor on an object a cut took
   * away entirely is not labelled over the empty space where it was.
   */
  isShown(globalId: string): boolean {
    const mesh = this.meshes.get(globalId);
    if (!mesh) return true;
    if (!mesh.visible) return false;
    const planes = this.cutPlanes();
    if (planes.length === 0) return true;
    let box = this.boxes.get(globalId);
    if (!box) {
      box = new Box3().setFromObject(mesh);
      this.boxes.set(globalId, box);
    }
    const { min, max } = box;
    // The corner of the box farthest along each plane's normal is the one
    // most on the kept side. If even that one is beyond the plane, all of it is.
    return planes.every((plane) => plane.distanceToPoint(new Vector3(
      plane.normal.x >= 0 ? max.x : min.x,
      plane.normal.y >= 0 ? max.y : min.y,
      plane.normal.z >= 0 ? max.z : min.z,
    )) >= 0);
  }

  /** Whether a point is on the kept side of every cut, so a click there lands on something drawn. */
  keeps(point: Vector3): boolean {
    return this.cutPlanes().every((plane) => plane.distanceToPoint(point) >= 0);
  }

  /** Move the vertical cut when there is one, the horizontal one otherwise, by `steps` steps. */
  shiftCut(steps: number): void {
    if (this.state.vertical !== null) this.state.depthShift += steps * CUT_STEP_M;
    else if (this.state.sectioned) this.state.heightShift += steps * CUT_STEP_M;
  }

  /**
   * Show the selected object alone, or everything again.
   *
   * With nothing selected and nothing isolated there is nothing to show
   * alone, so it does nothing.
   */
  toggleIsolation(): void {
    this.state.isolated = this.state.isolated === null ? this.state.selected : null;
    this.refreshVisibility();
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
      sectioned: false,
      grid: true,
      isolated: null,
      measuring: null,
      parallel: false,
      shadows: true,
      vertical: null,
      heightShift: 0,
      depthShift: 0,
      style: 'shaded',
      backdrop: 'light',
      walking: false,
      sketching: null,
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
