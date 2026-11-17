/**
 * The 3D canvas, kept in its own chunk.
 *
 * three.js is around 600 KB before the loaders, and the client already gates
 * bundle size through `yarn analyze`. Every other route is imported eagerly,
 * so this is the one that must not be: it is loaded through `React.lazy` from
 * `Bim.tsx` and reaches the browser only when someone opens a model.
 *
 * The component owns the renderer and gives it back on unmount. A WebGL
 * context is a real resource and browsers keep a small number of them, so a
 * route that leaks one on every visit stops drawing after a handful.
 *
 * What is drawn on the model comes from the manifest, through
 * `@into-cps-association/bim-kit`. This file holds no opinion about
 * what a binding looks like, which is the point of that package existing.
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, Box, CircularProgress, Typography, type Theme } from '@mui/material';
import {
  AmbientLight,
  Raycaster,
  Vector2,
  Color,
  DirectionalLight,
  Matrix4,
  Object3D,
  type Plane,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { resolveBindings } from '../resolver.js';
import type { FeedState, Reading } from '../readings.js';
import type { Binding } from '../binding.js';
import { exportGlb } from './exportGlb.js';
import { objectsOf } from './scene.js';
import {
  FAR_PLANE, NEAR_PLANE, SceneView, addOutlines, castShadows, createFieldSheet, createFinish,
  createFlight, createGizmo, createGlow, createGrid, createMarkers, createMeasure, createSection,
  createViewCube, frame, frameFrom, movedBeyond, setParallel, PARALLEL_FOV, PERSPECTIVE_FOV, BACKDROPS, startWalking, stepWalk, walkKeyOf,
  createSketch, MARKER_LAYER,
  frameObject, lightFromRoom,
  prepareRenderer, type LookFrom, type MarkerSet, type PropertyTree,
} from '../viewer/index.js';

// The same near-white the viewer this was taken from uses. A lighter one
// washes into the pale surfaces of a model and the silhouette disappears.
const BACKGROUND = 0xe9edef;
/** How strong the two lamps are. See where they are added for why. */
const AMBIENT_LIGHT = 0.25;
const SUN_LIGHT = 1.8;

const FIELD_OF_VIEW = 45;

/** How long the camera has to rest before the occlusion pass is drawn again, in milliseconds. */
const STILL_MS = 150;

/** A step of the camera smaller than this, relative to the view, is too small to see. */
const SETTLE_TOLERANCE = 2e-4;

/** How far the pointer may move between press and release and still count as a click, in pixels. */
const DRAG_PX = 4;

/**
 * How long the view keeps drawing every frame after a person did something,
 * in milliseconds: long enough for a hover, a pulse or a flight to finish.
 */
const AWAKE_MS = 1000;

/**
 * How often a view nobody touches is drawn, in milliseconds. Drawing a large
 * model every frame while nothing moves kept a core busy for nothing. Once a
 * second still catches anything that changed without saying so.
 */
const IDLE_REDRAW_MS = 1000;

/** "1 sensor", "2 sensors". Written out because "1 sensors" reads as a bug. */
function plural(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

/**
 * Put a marker on every binding the geometry can account for.
 *
 * Bindings that resolve to nothing are counted and reported instead of
 * dropped, because a manifest pointing at an object the model does not have is
 * the ordinary consequence of a re-export, and a view that silently draws four
 * markers where the manifest asked for six is worse than one that says which
 * two are missing.
 */
function addMarkers(
  model: Object3D, bindings: Binding[], radius: number, overlay: HTMLElement,
  onPick: (globalId: string) => void,
) {
  const { resolved, unresolved } = resolveBindings(bindings, objectsOf(model));
  const markers = createMarkers(model, resolved, overlay, radius, onPick);
  return { markers, placed: resolved.length, missing: unresolved };
}

/** A layer over the canvas for the marker labels, which never takes a click. */
function createOverlay(parent: HTMLElement): HTMLElement {
  const overlay = parent.ownerDocument.createElement('div');
  overlay.setAttribute('style', 'position:absolute;inset:0;overflow:hidden;pointer-events:none');
  overlay.dataset.testid = 'bim-labels';
  parent.appendChild(overlay);
  return overlay;
}

export interface BimCanvasProps {
  /**
   * Where the geometry is served from.
   *
   * A `.glb` is loaded. Anything else is treated as an IFC file and converted
   * in the browser first, which takes a moment and reports progress. The two
   * produce the same shape of scene, so nothing below this line knows which it
   * got.
   */
  url: string;
  /** True when `url` names an IFC file instead of converted geometry. */
  convert?: boolean;
  /** The bindings to draw on it. Empty when the model declares no sensors. */
  bindings?: Binding[];
  /**
   * Whether the manifest says its placements were proposed instead of
   * surveyed. A proposed position is a guess a tool made, and reporting it as
   * a fact is how a guess ends up in a report as a measurement.
   */
  proposed?: boolean;
  /** What the model says each object is, so a floor filter and a heatmap have something to group by. */
  tree?: PropertyTree;
  /** Reported so the page can say what it could not do. */
  onReport?: (message: string) => void;
  /**
   * Handed the loaded model and the camera commands, once it is ready.
   *
   * This is how a page drives the viewer: it holds the `SceneView`, changes its state, and calls `refresh`. Nothing here owns an interface.
   */
  onReady?: (handle: ViewerHandle) => void;
  /** Told which object the cursor is over, and which is selected. */
  onHover?: (globalId: string | null) => void;
  onSelect?: (globalId: string | null) => void;
  /**
   * Handed the converted geometry as a GLB, once, when `convert` was true and
   * the conversion succeeded. It is the model on its own, before any marker or
   * outline is added, so it is the same shape a GLB produced outside the
   * browser has. A host that wants to store the result so the model is not
   * reconverted on the next visit reads it here. Nothing is stored when this is
   * absent, and a host that stores it decides where, because this knows nothing
   * about where the model's files live.
   */
  onConverted?: (glb: Uint8Array) => void;
  /**
   * Handed the bytes of the IFC file when `convert` is true, as soon as they
   * arrive and before they are converted, so the page can hash the file it
   * actually loaded without downloading it a second time.
   */
  onSourceBytes?: (bytes: Uint8Array) => void;
}

/** What a page can do to the scene from outside. */
export interface ViewerHandle {
  view: SceneView;
  /** Put the whole model back in shot. */
  frame: () => void;
  /** Look from one of three axes, or from the default corner. */
  look: (from: LookFrom) => void;
  /**
   * Redraw the sheet the Per Sensor scope lays over the floor.
   *
   * Called by whatever changes a reading or a scope. It is separate from
   * `view.refresh` because that repaints the model's own objects, and the
   * sheet is beside the model and not one of them.
   */
  drawField: () => void;
  /** Put the selected object in shot. Does nothing when none is selected. */
  frameSelection?: () => void;
  /** Recolour the markers and rewrite their labels from the latest readings. */
  showReadings?: (readings: Map<string, Reading>, feed: FeedState, staleAfter?: number) => void;
}

/** Size every marker and move every label for the frame about to be drawn. */
function placeAll(markers: MarkerSet, view: SceneView, camera: PerspectiveCamera, parent: HTMLElement) {
  // A sensor on a floor the floor filter hides, or on an object a cut took
  // away, is hidden with it, label and all.
  const shown = (globalId: string) => view.isShown(globalId);
  markers.place(camera, parent.clientWidth, parent.clientHeight, view.state.selected, shown);
}

/**
 * The holder of the canvas, which also carries the colours of the marker
 * labels, taken from the host's theme so a label reads in a light and in a
 * dark theme alike.
 */
const labelColours = (theme: Theme) => ({
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  '--bim-label-bg': theme.palette.background.paper,
  '--bim-label-fg': theme.palette.text.primary,
  '--bim-label-border': theme.palette.text.secondary,
  '--bim-label-accent': theme.palette.primary.main,
}) as const;

function BimCanvas({
  url, convert = false, bindings = [], proposed = false, tree,
  onReport, onReady, onHover, onSelect, onConverted, onSourceBytes,
}: Readonly<BimCanvasProps>) {
  const holder = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    const parent = holder.current;
    if (!parent) return undefined;

    const scene = new Scene();
    scene.background = new Color(BACKGROUND);
    // Two lamps and the room light of `lightFromRoom`, and their strengths
    // matter more than they look. Too much in total clips every pale surface
    // to the same flat white, so the model reads as untextured. The room
    // light lifts the faces the sun misses, so the ambient lamp is low and
    // the sun carries the contrast between faces.
    scene.add(new AmbientLight(0xffffff, AMBIENT_LIGHT));
    const sun = new DirectionalLight(0xffffff, SUN_LIGHT);
    // Above and behind, to the left of the default corner view. The faces a
    // person sees are lit differently from each other, and the shadow of the
    // building falls towards the viewer's side, where it can be seen. From in
    // front the shadows fell behind the building and nothing showed.
    sun.position.set(-6, 10, 3);
    scene.add(sun);
    // The target is what the sun points at. It has to be in the scene for a
    // move of it to change the direction the shadows fall in.
    scene.add(sun.target);

    // 45 degrees, matching the viewer this was taken from. A wider lens bends
    // the walls of a room outwards and a building stops looking square.
    const camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, NEAR_PLANE, FAR_PLANE);
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(globalThis.devicePixelRatio);
    // The canvas is sized by CSS and drawn at the size `setSize` is given.
    // Without this it takes its CSS size from its pixel size, which on a
    // retina screen is twice the box it sits in, and the page grows sideways
    // around it until the layout breaks.
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    parent.appendChild(renderer.domElement);
    // Soft light from every side, shadows, occlusion in the creases and the
    // section plane: what makes a model read as a building and not as flat
    // colour. See `viewer/look.ts`.
    prepareRenderer(renderer);
    const dropRoomLight = lightFromRoom(renderer, scene);
    const finish = createFinish(renderer, scene, camera);
    const section = createSection(renderer);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // A change of shot asked for by a button, a key or a sensor card flies
    // there. A person who grabs the view mid-flight takes it over at once.
    const flight = createFlight(camera, controls);
    controls.addEventListener('start', () => flight.cancel());

    // The axes indicator. Built once and drawn after the model on every frame,
    // so it sits over the view instead of in it.
    const gizmo = createGizmo();
    // The view cube, bottom right: a click on a face, an edge or a corner
    // looks at the model from there.
    const cube = createViewCube();

    // Until when the view draws every frame, because a person just did something.
    let awakeUntil = 0;
    const wake = () => { awakeUntil = performance.now() + AWAKE_MS; };

    const resize = () => {
      const { clientWidth, clientHeight } = parent;
      if (clientWidth === 0 || clientHeight === 0) return;
      // `false` leaves the CSS size alone, which is what keeps the canvas
      // inside its box instead of the box growing to fit the canvas.
      renderer.setSize(clientWidth, clientHeight, false);
      finish.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(() => { resize(); wake(); });
    observer.observe(parent);
    // Anything a person does may change the picture, so the view draws every
    // frame for a moment after it. Listened for on the page and not only on
    // the canvas, since the toolbar and the cards change the view too.
    const inputs = ['pointerdown', 'pointermove', 'wheel', 'keydown', 'keyup'] as const;
    for (const name of inputs) globalThis.addEventListener(name, wake, { passive: true });

    // Torn down in the order they were set up, whatever the model turned out
    // to be, so a page that switches models does not leak a listener a visit.
    const cleanUp: Array<() => void> = [];

    const overlay = createOverlay(parent);
    // Set once a model is shown. The markers are sized and their labels moved
    // on every frame, because both follow the camera.
    let placeMarkers: (() => void) | null = null;
    // Set once a model is shown: where the cuts are, read on every frame so a
    // toggle, a move or a change of floor takes effect on the next one.
    let cutPlanes: () => Plane[] = () => [];
    let shadows = false;
    let wantsShadows = () => true;
    // The occlusion pass draws every mesh as solid, a see-through wall too,
    // so with the shell made transparent it would darken the space around
    // the walls. It is left out while the shell is see-through.
    let wantsOcclusion = () => true;
    // Set once a model is shown: the grid and the measurement follow the
    // view's state on every frame.
    let followState: (() => void) | null = null;
    // Set once a model is shown: counts the changes of what is visible, which
    // is all the shadow map depends on.
    let visibility = () => 0;
    // Set once a model is shown: changes whenever the view repaints or
    // shows something else, so a still view knows it has to be drawn again.
    let revision = () => '';
    // Set once a model is shown: the edges of every object, left out while
    // the camera moves since they double the number of things drawn.
    let showOutlines = (_shown: boolean) => undefined as void;
    let outlinesShown = true;
    let lastDraw = 0;
    let lastFull = false;
    let lastRevision = '';
    /** Draw the sensor dots over the frame just drawn. */
    const drawMarkers = () => {
      const { autoClear, background } = { autoClear: renderer.autoClear, background: scene.background };
      renderer.autoClear = false;
      scene.background = null;
      camera.layers.set(MARKER_LAYER);
      renderer.render(scene, camera);
      camera.layers.set(0);
      scene.background = background;
      renderer.autoClear = autoClear;
    };

    // Where the camera was on the last frame and when it last moved, so the
    // occlusion pass is left out while it moves and comes back when it stops.
    const lastView = new Matrix4();
    let lastFov = camera.fov;
    let stillSince = 0;
    let shadowKey = '';

    let running = true;
    const tick = () => {
      if (!running) return;
      const now = performance.now();
      flight.step(now);
      controls.update();
      placeMarkers?.();
      const cuts = cutPlanes();
      section.setPlanes(cuts);
      // The shadow map is drawn without the cut, so with a cut on, the roof
      // that is not drawn would still throw its shadow into the rooms.
      sun.castShadow = shadows && cuts.length === 0 && wantsShadows();
      followState?.();
      const key = `${sun.castShadow}|${visibility()}`;
      if (key !== shadowKey) {
        shadowKey = key;
        renderer.shadowMap.needsUpdate = true;
      }
      camera.updateMatrixWorld();
      if (movedBeyond(lastView, camera.matrixWorld) || camera.fov !== lastFov) {
        // The damping slows the camera by a share of its speed each frame, so
        // on a slow frame rate it creeps on for many seconds. Once a step is
        // too small to see, the remaining speed is dropped and the view rests.
        if (!flight.flying && !movedBeyond(lastView, camera.matrixWorld, SETTLE_TOLERANCE)) {
          controls.enableDamping = false;
          controls.update();
          controls.enableDamping = true;
          camera.updateMatrixWorld();
        }
        lastView.copy(camera.matrixWorld);
        lastFov = camera.fov;
        stillSince = now;
      }
      const still = now - stillSince > STILL_MS;
      const changed = revision();
      // Drawn when the camera moves, when a person did something lately, when
      // the view changed, when the first still frame after a move is due, and
      // once a second otherwise.
      const draw = !still || now < awakeUntil || changed !== lastRevision
        || (still && !lastFull) || now - lastDraw > IDLE_REDRAW_MS;
      if (draw) {
        if (still !== outlinesShown) {
          outlinesShown = still;
          showOutlines(still);
        }
        finish.render(still && wantsOcclusion());
        lastDraw = now;
        lastFull = still;
        lastRevision = changed;
        // The cut is in world coordinates and the axes indicator is not in
        // the world, so the indicator is drawn without it, and so are the
        // sensor dots, which have their own layer for this.
        const planes = renderer.clippingPlanes;
        renderer.clippingPlanes = [];
        drawMarkers();
        gizmo.draw(renderer, camera);
        cube.draw(renderer, camera);
        renderer.clippingPlanes = planes;
      }
      globalThis.requestAnimationFrame(tick);
    };
    tick();

    /** What the cursor is over, found by casting a ray through the pointer. */
    const pointer = new Vector2();
    const ray = new Raycaster();
    let picked: string | null = null;

    /** Put a built model in the scene, whatever produced it. */
    const show = (model: Object3D, note?: string) => {
      if (!running) return;
      scene.add(model);
      const radius = frame(camera, controls, model);
      // Set once the view exists, below: a click on a sensor's dot or label
      // picks its object and flies there, as a click on its card does.
      let pickSensor = (_globalId: string) => undefined as void;
      const { markers, placed, missing } = addMarkers(
        model, bindings, radius, overlay, (globalId) => pickSensor(globalId),
      );
      cleanUp.push(() => markers.dispose());

      // Everything the page drives the viewer through. The page owns the
      // interface and this owns the scene, and this is the only line between
      // them.
      const view = new SceneView(model as never, tree);
      visibility = () => view.visibilityRevision;
      revision = () => `${view.visibilityRevision}|${view.materialsRevision}|${cutPlanes().length}`
        + `|${renderer.clippingPlanes.map((plane) => plane.constant).join(',')}`
        + `|${view.state.backdrop}|${view.state.grid}|${measure.points.length}|${view.state.measuring}`;
      /** The lens the state asks for. Walking always looks through the ordinary one. */
      const lens = () => setParallel(camera, controls, view.state.parallel && !view.state.walking);
      /**
       * Fly to a new shot. Walking stops, since the shot is not at eye height,
       * and the lens is set first, so the shot is worked out for the lens it
       * is seen through and a change of lens cannot pull the camera away.
       */
      const flyTo = (change: () => void) => {
        view.state.walking = false;
        lens();
        flight.fly(change);
      };
      pickSensor = (globalId) => {
        wake();
        view.state.selected = globalId;
        view.refreshMaterials();
        onSelect?.(globalId);
        const mesh = view.meshes.get(globalId);
        if (mesh) flyTo(() => frameObject(camera, controls, mesh, model));
      };
      // The field's sheet lives beside the model, not in it: it is a reading
      // laid over the floor and not part of the building.
      const sheet = createFieldSheet(scene);
      cleanUp.push(() => sheet.dispose());
      // The halo sits beside the model for the same reason the sheet does: it
      // is a mark on the building and not part of it, and putting it inside
      // the model would give it the model's transform twice.
      const glow = createGlow(scene);
      view.attachGlow(glow);
      cleanUp.push(() => glow.dispose());
      // After the view has found the objects, so the outlines go on exactly
      // what is drawn and nothing else. They are children of their meshes, so
      // the teardown that walks the scene disposes them along with everything
      // else.
      addOutlines(view.meshes.values());
      const edges = [...view.meshes.values()].flatMap((mesh) =>
        mesh.children.filter((child) => child.name === 'outline'));
      showOutlines = (shown) => { for (const edge of edges) edge.visible = shown; };
      cleanUp.push(castShadows(model, sun, scene));
      shadows = true;
      const grid = createGrid(scene, model);
      cleanUp.push(() => grid.dispose());
      const measure = createMeasure(scene, overlay);
      cleanUp.push(() => measure.dispose());
      const sketch = createSketch(overlay);
      cleanUp.push(() => sketch.dispose());
      wantsShadows = () => view.state.shadows;
      wantsOcclusion = () => !view.state.transparent;
      // Walking: the arrow keys held, and whether the last frame was walking,
      // so the camera is set at eye height once, on the frame walking starts.
      const held = { forward: false, back: false, left: false, right: false };
      let wasWalking = false;
      let lastStep = performance.now();
      const letGo = () => {
        held.forward = false;
        held.back = false;
        held.left = false;
        held.right = false;
      };
      const onArrow = (down: boolean) => (event: KeyboardEvent) => {
        const which = walkKeyOf(event.key);
        if (!which || !view.state.walking) return;
        // An arrow in a search box moves the caret and not the person.
        const target = event.target as HTMLElement | null;
        if (down && target && (target.isContentEditable
          || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
        held[which] = down;
        // The page would scroll on an arrow key otherwise.
        event.preventDefault();
      };
      const arrowDown = onArrow(true);
      const arrowUp = onArrow(false);
      globalThis.addEventListener('keydown', arrowDown);
      globalThis.addEventListener('keyup', arrowUp);
      // A key let go while the window is not in front never sends its keyup,
      // and the person would keep walking.
      globalThis.addEventListener('blur', letGo);
      globalThis.document?.addEventListener('visibilitychange', letGo);
      cleanUp.push(() => {
        globalThis.removeEventListener('keydown', arrowDown);
        globalThis.removeEventListener('keyup', arrowUp);
        globalThis.removeEventListener('blur', letGo);
        globalThis.document?.removeEventListener('visibilitychange', letGo);
      });
      const walkFrame = () => {
        const now = performance.now();
        const seconds = Math.min((now - lastStep) / 1000, 0.1);
        lastStep = now;
        if (view.state.walking && !wasWalking) {
          flight.cancel();
          startWalking(camera, controls, view.floorLevel());
        }
        if (!view.state.walking && wasWalking) letGo();
        wasWalking = view.state.walking;
        // Zoom and pan would carry the eye through walls and off the floor.
        controls.enableZoom = !view.state.walking;
        controls.enablePan = !view.state.walking;
        if (view.state.walking) stepWalk(camera, controls, held, seconds);
      };
      let sketching: string | null = null;
      followState = () => {
        walkFrame();
        if (view.state.sketching !== sketching) {
          sketching = view.state.sketching;
          sketch.setTool(view.state.sketching);
        }
        const wanted = view.state.parallel && !view.state.walking ? PARALLEL_FOV : PERSPECTIVE_FOV;
        if (camera.fov !== wanted) {
          // A flight was worked out for the old lens and would pull the
          // camera back to where that lens needed it.
          flight.cancel();
          lens();
        }
        (scene.background as Color).setHex(BACKDROPS[view.state.backdrop]);
        grid.setVisible(view.state.grid);
        // Leaving the measuring mode takes the last measurement away with it,
        // and changing the mode starts a new one.
        if (view.state.measuring === null) {
          if (measure.points.length > 0) measure.clear();
        } else measure.setMode(view.state.measuring);
        measure.place(camera, parent.clientWidth, parent.clientHeight);
      };
      cutPlanes = () => view.cutPlanes();
      view.refresh();
      placeMarkers = () => placeAll(markers, view, camera, parent);
      onReady?.({
        view,
        frame: () => flyTo(() => frame(camera, controls, model)),
        look: (from) => flyTo(() => frame(camera, controls, model, from)),
        drawField: () => { sheet.draw(view); wake(); },
        frameSelection: () => {
          const mesh = view.state.selected ? view.meshes.get(view.state.selected) : undefined;
          if (mesh) flyTo(() => frameObject(camera, controls, mesh, model));
        },
        showReadings: (readings, feed, staleAfter) => { markers.showReadings(readings, feed, staleAfter); wake(); },
      });

      /** Point the ray through the pointer. */
      const aim = (event: PointerEvent) => {
        const box = parent.getBoundingClientRect();
        pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1;
        pointer.y = -((event.clientY - box.top) / box.height) * 2 + 1;
        ray.setFromCamera(pointer, camera);
      };
      /** The first visible surface under the pointer, or undefined. */
      const hitAt = (event: PointerEvent) => {
        aim(event);
        // Only what is visible: a floor filter that hides a wall must also
        // stop that wall being clicked through the floor above it.
        const hits = ray.intersectObjects([...view.meshes.values()].filter((m) => m.visible), false);
        // A cut hides what is beyond it without changing `visible`, so a hit
        // there is a click on nothing drawn.
        return hits.find((hit) => view.keeps(hit.point));
      };
      /** Which object is under the pointer, or null. */
      const at = (event: PointerEvent): string | null =>
        (hitAt(event)?.object.userData.globalId as string | undefined) ?? null;

      const move = (event: PointerEvent) => {
        // A pen stroke ends on the model, and the drawing is what the mouse
        // is doing, so nothing under it is highlighted or picked.
        if (view.state.sketching) return;
        const globalId = at(event);
        if (globalId === picked) return;
        picked = globalId;
        view.state.hovered = globalId;
        view.refreshMaterials();
        onHover?.(globalId);
      };
      // Where the button went down, so a drag that turned the view does not
      // also count as a click when the button comes up.
      const pressedAt = { x: 0, y: 0 };
      const press = (event: PointerEvent) => {
        pressedAt.x = event.clientX;
        pressedAt.y = event.clientY;
      };
      const click = (event: PointerEvent) => {
        if (view.state.sketching) return;
        if (Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) > DRAG_PX) return;
        const box = parent.getBoundingClientRect();
        const from = cube.pick(event.clientX - box.left, event.clientY - box.top, box.width, box.height);
        if (from) {
          flyTo(() => frameFrom(camera, controls, model, from));
          return;
        }
        // A sensor's dot is drawn over the walls, so it is picked before
        // whatever object lies behind it.
        if (!view.state.measuring) {
          aim(event);
          const sensor = markers.pick(ray);
          if (sensor) {
            pickSensor(sensor);
            return;
          }
        }
        if (view.state.measuring) {
          const hit = hitAt(event);
          if (hit) measure.addPoint(hit.point);
          return;
        }
        const globalId = at(event);
        view.state.selected = globalId;
        view.refreshMaterials();
        onSelect?.(globalId);
      };
      parent.addEventListener('pointermove', move);
      parent.addEventListener('pointerdown', press);
      parent.addEventListener('click', click as EventListener);
      cleanUp.push(() => {
        parent.removeEventListener('pointermove', move);
        parent.removeEventListener('pointerdown', press);
        parent.removeEventListener('click', click as EventListener);
        view.dispose();
      });

      setLoading(false);
      setProgress(null);
      const kind = proposed ? 'proposed sensor' : 'sensor';
      const sensors = bindings.length === 0 ? undefined
        : missing.length === 0
          ? `${placed} ${plural(kind, placed)} placed on the model.`
          : `${placed} of ${bindings.length} ${plural(kind, bindings.length)} placed. `
            + `${missing.length} name an object this geometry does not have.`;
      const both = [note, sensors].filter(Boolean).join(' ');
      if (both) onReport?.(both);
    };

    const failed = (what: string) => {
      if (!running) return;
      // A library's own message names internal URLs and internal state, so
      // what reaches the page is a fact about the file instead.
      setProblem(what);
      setLoading(false);
      setProgress(null);
    };

    if (convert) {
      // Loaded only here, so the WebAssembly parser, which is over a megabyte,
      // reaches a browser only when a model actually has to be converted.
      // Someone who only ever opens converted models never fetches it.
      setProgress('Reading the IFC file');
      (async () => {
        const [{ convertIfc }, { meshesFrom }] = await Promise.all([
          import('../converter.js'),
          import('./ifcMeshes.js'),
        ]);
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error(`the file returned HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (running) onSourceBytes?.(bytes);

        if (!running) return;
        setProgress('Converting');
        const converted = await convertIfc(bytes, {
          onProgress: (done) => {
            if (running && done % 250 === 0) setProgress(`Converting, ${done} objects`);
          },
        });
        const dropped = converted.failed === 0 ? ''
          : ` ${converted.failed} could not be turned into geometry.`;
        const model = meshesFrom(converted);

        // Store the geometry before the scene decorates the model. `show` adds
        // markers and outlines to it, and the stored GLB has to be the model
        // alone so it reloads as the same shape a GLB from outside the browser
        // has. The exporter is fetched only here, so a viewer that never stores
        // a conversion never pulls it in. This is best-effort: a failed export
        // leaves the drawing untouched, and the model simply reconverts next
        // time instead of loading a file that was never written.
        if (onConverted) {
          try {
            const glb = await exportGlb(model);
            if (running) onConverted(glb);
          } catch {
            // Persistence is an optimisation, not a requirement for drawing.
          }
        }

        show(model,
          `Converted in the browser: ${converted.objects.length} objects.${dropped}`);
      })().catch((error: Error) => failed(`This model could not be converted. ${error.message}`));
    } else {
      new GLTFLoader().load(
        url,
        (gltf) => show(gltf.scene),
        undefined,
        () => failed('The geometry could not be read. It may be incomplete.'),
      );
    }

    return () => {
      running = false;
      for (const undo of cleanUp) undo();
      finish.dispose();
      cube.dispose();
      dropRoomLight();
      overlay.remove();
      observer.disconnect();
      for (const name of inputs) globalThis.removeEventListener(name, wake);
      controls.dispose();
      scene.traverse((object) => {
        const mesh = object as { geometry?: { dispose: () => void }; material?: unknown };
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          (material as { dispose?: () => void } | undefined)?.dispose?.();
        }
      });
      gizmo.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      parent.removeChild(renderer.domElement);
    };
  }, [url, convert, bindings, proposed, tree, onReport, onReady, onHover, onSelect, onConverted,
    onSourceBytes]);

  return (
    <Box sx={{
      position: 'relative',
      width: '100%',
      height: '70vh',
      minHeight: 360,
      // The canvas must never decide the size of the page.
      overflow: 'hidden',
    }}
    >
      <Box
        ref={holder}
        sx={labelColours}
        data-testid="bim-canvas"
      />
      {loading && !problem && (
        <Box sx={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
        }}
        >
          <CircularProgress />
          {progress && <Typography variant="body2">{progress}</Typography>}
        </Box>
      )}
      {problem && (
        <Alert severity="error" sx={{ position: 'absolute', top: 16, left: 16, right: 16 }}>
          {problem}
        </Alert>
      )}
    </Box>
  );
}

export default BimCanvas;
