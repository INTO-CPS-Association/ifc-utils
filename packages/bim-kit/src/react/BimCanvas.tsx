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
  createViewCube, frame, frameFrom, setParallel, BACKDROPS,
  frameObject, lightFromRoom,
  prepareRenderer, snapshot, type MarkerSet, type PropertyTree, type SavedView,
} from '../viewer/index.js';

// The same near-white the viewer this was taken from uses. A lighter one
// washes into the pale surfaces of a model and the silhouette disappears.
const BACKGROUND = 0xe9edef;
/** How strong the two lamps are. See where they are added for why. */
const AMBIENT_LIGHT = 0.25;
const SUN_LIGHT = 1.8;

const FIELD_OF_VIEW = 45;

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
function addMarkers(model: Object3D, bindings: Binding[], radius: number, overlay: HTMLElement) {
  const { resolved, unresolved } = resolveBindings(bindings, objectsOf(model));
  const markers = createMarkers(model, resolved, overlay, radius);
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
  look: (from: 'top' | 'front' | 'side' | 'corner') => void;
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
  /** The view on screen, under a name, to save and come back to. */
  captureView?: (name: string) => SavedView;
  /** Put back the floor, lens and cuts of a saved view and fly to its camera. */
  showView?: (saved: SavedView) => void;
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
    const observer = new ResizeObserver(resize);
    observer.observe(parent);

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
    // Set once a model is shown: the grid and the measurement follow the
    // view's state on every frame.
    let followState: (() => void) | null = null;

    let running = true;
    const tick = () => {
      if (!running) return;
      flight.step(performance.now());
      controls.update();
      placeMarkers?.();
      const cuts = cutPlanes();
      section.setPlanes(cuts);
      // The shadow map is drawn without the cut, so with a cut on, the roof
      // that is not drawn would still throw its shadow into the rooms.
      sun.castShadow = shadows && cuts.length === 0 && wantsShadows();
      followState?.();
      finish.render();
      // The cut is in world coordinates and the axes indicator is not in the
      // world, so the indicator is drawn without it.
      const planes = renderer.clippingPlanes;
      renderer.clippingPlanes = [];
      gizmo.draw(renderer, camera);
      cube.draw(renderer, camera);
      renderer.clippingPlanes = planes;
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
      const { markers, placed, missing } = addMarkers(model, bindings, radius, overlay);
      cleanUp.push(() => markers.dispose());

      // Everything the page drives the viewer through. The page owns the
      // interface and this owns the scene, and this is the only line between
      // them.
      const view = new SceneView(model as never, tree);
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
      cleanUp.push(castShadows(model, sun, scene));
      shadows = true;
      const grid = createGrid(scene, model);
      cleanUp.push(() => grid.dispose());
      const measure = createMeasure(scene, overlay);
      cleanUp.push(() => measure.dispose());
      wantsShadows = () => view.state.shadows;
      followState = () => {
        setParallel(camera, controls, view.state.parallel);
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
        frame: () => flight.fly(() => frame(camera, controls, model)),
        look: (from) => flight.fly(() => frame(camera, controls, model, from)),
        drawField: () => sheet.draw(view),
        frameSelection: () => {
          const mesh = view.state.selected ? view.meshes.get(view.state.selected) : undefined;
          if (mesh) flight.fly(() => frameObject(camera, controls, mesh, model));
        },
        showReadings: (readings, feed, staleAfter) => markers.showReadings(readings, feed, staleAfter),
        captureView: (name) => snapshot(name, camera.position, controls.target, view.state),
        showView: (saved) => {
          const { name: _name, position, target, ...state } = saved;
          Object.assign(view.state, state);
          view.refresh();
          // The lens first, so the flight ends where the view was saved and
          // the next frame finds the lens already right.
          setParallel(camera, controls, saved.parallel);
          flight.fly(() => {
            camera.position.set(...position);
            controls.target.set(...target);
            controls.update();
          });
        },
      });

      /** The first visible surface under the pointer, or undefined. */
      const hitAt = (event: PointerEvent) => {
        const box = parent.getBoundingClientRect();
        pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1;
        pointer.y = -((event.clientY - box.top) / box.height) * 2 + 1;
        ray.setFromCamera(pointer, camera);
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
        const globalId = at(event);
        if (globalId === picked) return;
        picked = globalId;
        view.state.hovered = globalId;
        view.refreshMaterials();
        onHover?.(globalId);
      };
      const click = (event: PointerEvent) => {
        const box = parent.getBoundingClientRect();
        const from = cube.pick(event.clientX - box.left, event.clientY - box.top, box.width, box.height);
        if (from) {
          flight.fly(() => frameFrom(camera, controls, model, from));
          return;
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
      parent.addEventListener('click', click as EventListener);
      cleanUp.push(() => {
        parent.removeEventListener('pointermove', move);
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
