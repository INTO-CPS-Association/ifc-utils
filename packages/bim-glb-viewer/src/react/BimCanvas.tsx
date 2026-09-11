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
 * `@into-cps-association/bim-glb-viewer`. This file holds no opinion about
 * what a binding looks like, which is the point of that package existing.
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import {
  AmbientLight,
  Box3,
  Raycaster,
  Vector2,
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { idOf } from '../binding.js';
import { resolveBindings } from '../resolver.js';
import type { Binding } from '../binding.js';
import { objectsOf } from './scene.js';
import {
  SceneView, addOutlines, createFieldSheet, createGizmo, createGlow, type PropertyTree,
} from '../viewer/index.js';

// The same near-white the viewer this was taken from uses. A lighter one
// washes into the pale surfaces of a model and the silhouette disappears.
const BACKGROUND = 0xe9edef;
/** How strong the two lamps are. See where they are added for why. */
const AMBIENT_LIGHT = 0.75;
const SUN_LIGHT = 0.9;

const FIELD_OF_VIEW = 45;

const NEAR_PLANE = 0.1;
const FAR_PLANE = 5000;

// A marker is a fraction of the model, so it is the same size on a substation
// and on a sixty metre building.
const MARKER_SHARE_OF_MODEL = 0.006;

/**
 * The colour of a sensor that has not reported.
 *
 * Deliberately off the ramp, so it cannot be mistaken for a value. Grey is the
 * same thing the card beside it says when it greys a stale reading.
 */
const NO_READING_COLOUR = 0x9aa3ad;

/**
 * Where the camera sits for each named view, as a direction from the centre.
 *
 * Named instead of written into each shortcut, so adding a fourth is a line
 * here and not a change to the table of keys.
 */
const LOOK_FROM: Record<string, [number, number, number]> = {
  top: [0, 1, 0.0001],
  front: [0, 0, 1],
  side: [1, 0, 0],
  corner: [1, 0.6, 1],
};

/**
 * Put the whole model in shot.
 *
 * The distance is the radius of the bounding sphere over the sine of half the
 * field of view, which frames the model whatever its size. The metre is
 * clearance so the near face is not against the lens.
 */
function frame(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  model: Object3D,
  from: keyof typeof LOOK_FROM = 'corner',
) {
  const box = new Box3().setFromObject(model);
  if (box.isEmpty()) return 1;

  const centre = box.getCenter(new Vector3());
  const radius = box.getSize(new Vector3()).length() / 2;
  const distance = radius / Math.sin((camera.fov * Math.PI) / 360) + 1;

  camera.position.copy(centre)
    .add(new Vector3(...LOOK_FROM[from]).normalize().multiplyScalar(distance));
  camera.near = Math.max(distance / 1000, NEAR_PLANE);
  camera.far = Math.max(distance * 10, FAR_PLANE);
  camera.updateProjectionMatrix();
  controls.target.copy(centre);
  controls.update();
  return radius;
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
/** "1 sensor", "2 sensors". Written out because "1 sensors" reads as a bug. */
function plural(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

function addMarkers(model: Object3D, bindings: Binding[], radius: number) {
  const { resolved, unresolved } = resolveBindings(bindings, objectsOf(model));
  const size = Math.max(radius * MARKER_SHARE_OF_MODEL, 0.05);
  const shape = new SphereGeometry(size, 16, 12);
  const at = new Vector3();

  for (const { binding, object } of resolved) {
    // A marker is drawn in a colour that is not on the ramp at all. It used to
    // sit at the cold end of the binding's own ramp, which reads as a
    // measurement: a blue dot on a temperature ramp says four degrees, while
    // the card beside it said no message had ever arrived. One of the two was
    // lying and it was the dot.
    //
    // It stays this colour, because nothing recolours a marker yet: the
    // readings repaint the objects and not the spheres. When the transport
    // exists, this is where a marker starts following its own value.
    const marker = new Mesh(shape, new MeshBasicMaterial({
      color: NO_READING_COLOUR,
      // Drawn over the geometry it sits on, or a sensor inside a wall is
      // invisible from outside, which defeats the purpose of a marker.
      depthTest: false,
    }));
    marker.renderOrder = 2;
    marker.name = `marker:${idOf(binding)}`;
    new Box3().setFromObject(object.node).getCenter(at);
    marker.position.copy(at);
    model.add(marker);
  }

  return { placed: resolved.length, missing: unresolved };
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
}

function BimCanvas({
  url, convert = false, bindings = [], proposed = false, tree,
  onReport, onReady, onHover, onSelect,
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
    // Two lamps, and their strengths matter more than they look. At 2 each the
    // sum clips every pale surface to white: a window frame, a plastered wall
    // and a ceiling all came out the same flat white, so the model read as
    // untextured instead of as lit. These are the values the viewer this was
    // taken from uses, and they leave the light ones distinguishable.
    scene.add(new AmbientLight(0xffffff, AMBIENT_LIGHT));
    const sun = new DirectionalLight(0xffffff, SUN_LIGHT);
    // Above, to one side and in front, so the three faces of a box are lit
    // differently and an edge is visible without an outline.
    sun.position.set(5, 10, 7);
    scene.add(sun);

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

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // The axes indicator. Built once and drawn after the model on every frame,
    // so it sits over the view instead of in it.
    const gizmo = createGizmo();

    const resize = () => {
      const { clientWidth, clientHeight } = parent;
      if (clientWidth === 0 || clientHeight === 0) return;
      // `false` leaves the CSS size alone, which is what keeps the canvas
      // inside its box instead of the box growing to fit the canvas.
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);

    // Torn down in the order they were set up, whatever the model turned out
    // to be, so a page that switches models does not leak a listener a visit.
    const cleanUp: Array<() => void> = [];

    let running = true;
    const tick = () => {
      if (!running) return;
      controls.update();
      renderer.render(scene, camera);
      gizmo.draw(renderer, camera);
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
      const { placed, missing } = addMarkers(model, bindings, radius);

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
      view.refresh();
      onReady?.({
        view,
        frame: () => frame(camera, controls, model),
        look: (from) => frame(camera, controls, model, from),
        drawField: () => sheet.draw(view),
      });

      /** Which object is under the pointer, or null. */
      const at = (event: PointerEvent): string | null => {
        const box = parent.getBoundingClientRect();
        pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1;
        pointer.y = -((event.clientY - box.top) / box.height) * 2 + 1;
        ray.setFromCamera(pointer, camera);
        // Only what is visible: a floor filter that hides a wall must also
        // stop that wall being clicked through the floor above it.
        const hits = ray.intersectObjects([...view.meshes.values()].filter((m) => m.visible), false);
        return (hits[0]?.object.userData.globalId as string | undefined) ?? null;
      };

      const move = (event: PointerEvent) => {
        const globalId = at(event);
        if (globalId === picked) return;
        picked = globalId;
        view.state.hovered = globalId;
        view.refreshMaterials();
        onHover?.(globalId);
      };
      const click = (event: PointerEvent) => {
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
          import('@into-cps-association/bim-ifc-converter'),
          import('./ifcMeshes.js'),
        ]);
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error(`the file returned HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());

        if (!running) return;
        setProgress('Converting');
        const converted = await convertIfc(bytes, {
          onProgress: (done) => {
            if (running && done % 250 === 0) setProgress(`Converting, ${done} objects`);
          },
        });
        const dropped = converted.failed === 0 ? ''
          : ` ${converted.failed} could not be turned into geometry.`;
        show(meshesFrom(converted),
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
  }, [url, convert, bindings, proposed, tree, onReport, onReady, onHover, onSelect]);

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
        sx={{ width: '100%', height: '100%', overflow: 'hidden' }}
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
