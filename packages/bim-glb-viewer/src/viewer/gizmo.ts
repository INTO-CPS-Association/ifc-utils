/**
 * The axes indicator in the corner of the view.
 *
 * A building drawn on a plain background gives a person nothing to tell which
 * way is up until they recognise a roof, and a model that arrives rotated
 * looks like a building seen from an odd angle rather than like a bug. This
 * repository had exactly that: one converter laid every model on its side and
 * it went unnoticed, because nothing on screen said which axis was which.
 *
 * It is drawn as a second scene into a corner of the same canvas rather than
 * as an object in the model, so it keeps its size whatever the zoom and never
 * ends up inside a wall. It carries no state of its own: it is pointed at the
 * main camera's direction on every frame and holds nothing that has to be kept
 * in step.
 */

import {
  ArrowHelper,
  CanvasTexture,
  OrthographicCamera,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  type Camera,
  type Texture,
  type WebGLRenderer,
} from 'three';

/** The side of the square it is drawn into, in CSS pixels. */
export const GIZMO_SIZE_PX = 88;

/** The gap between that square and the edges of the view, in CSS pixels. */
export const GIZMO_MARGIN_PX = 12;

/**
 * The three axis colours, the convention every 3D tool uses: X red, Y green,
 * Z blue. Using anything else here would make a person read the wrong axis,
 * which is worse than showing no axes at all.
 */
const AXES = [
  { direction: new Vector3(1, 0, 0), colour: 0xd94a4a, label: 'X' },
  { direction: new Vector3(0, 1, 0), colour: 0x4aa84a, label: 'Y' },
  { direction: new Vector3(0, 0, 1), colour: 0x4a7ad9, label: 'Z' },
];

/** How far the little camera sits from the axes, in the gizmo's own units. */
const CAMERA_DISTANCE = 4;

/** The half-width the orthographic camera sees, so the arrows fill the square. */
const HALF_EXTENT = 1.45;

/**
 * Where the square goes, in the coordinates `setViewport` wants.
 *
 * Bottom left, because a WebGL viewport counts from the bottom and because the
 * toolbar and the floor picker are above the canvas. Pure, so the placement is
 * tested without a graphics context.
 */
export function cornerViewport(
  width: number,
  height: number,
  size = GIZMO_SIZE_PX,
  margin = GIZMO_MARGIN_PX,
): { x: number; y: number; side: number } {
  // On a view smaller than the gizmo plus its margins, shrink rather than
  // draw outside it. A narrow panel is a real case and a gizmo hanging off
  // the edge looks like a rendering fault.
  const side = Math.max(0, Math.min(size, width - 2 * margin, height - 2 * margin));
  return { x: margin, y: margin, side };
}

/** One axis letter, drawn on a canvas and hung at the tip of its arrow. */
function label(text: string, colour: number): Sprite | null {
  const canvas = globalThis.document?.createElement('canvas');
  // A renderer without a document is a headless test. The arrows carry the
  // colour convention on their own, so a missing letter is a smaller loss
  // than a thrown error.
  if (!canvas) return null;
  canvas.width = 64;
  canvas.height = 64;
  const pen = canvas.getContext('2d');
  if (!pen) return null;

  pen.fillStyle = `#${colour.toString(16).padStart(6, '0')}`;
  pen.font = 'bold 44px system-ui, sans-serif';
  pen.textAlign = 'center';
  pen.textBaseline = 'middle';
  pen.fillText(text, 32, 34);

  const texture = new CanvasTexture(canvas);
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.setScalar(0.44);
  return sprite;
}

export interface Gizmo {
  /** Draw it into the corner of a view already rendered. */
  draw: (renderer: WebGLRenderer, camera: Camera) => void;
  /** Give back the textures and geometries. */
  dispose: () => void;
}

/**
 * Build the indicator.
 *
 * Called once per viewer. Everything it allocates is returned to the driver
 * by `dispose`, because a page that switches models several times would
 * otherwise keep one of these per model.
 */
export function createGizmo(): Gizmo {
  const scene = new Scene();
  const camera = new OrthographicCamera(
    -HALF_EXTENT, HALF_EXTENT, HALF_EXTENT, -HALF_EXTENT, 0.1, 100,
  );
  const textures: Texture[] = [];

  for (const axis of AXES) {
    const arrow = new ArrowHelper(axis.direction, new Vector3(), 1, axis.colour, 0.28, 0.16);
    scene.add(arrow);

    const letter = label(axis.label, axis.colour);
    if (letter) {
      letter.position.copy(axis.direction).multiplyScalar(1.3);
      scene.add(letter);
      const map = (letter.material as SpriteMaterial).map;
      if (map) textures.push(map);
    }
  }

  const direction = new Vector3();
  const size = new Vector2();

  return {
    draw(renderer, main) {
      renderer.getSize(size);
      const { x, y, side } = cornerViewport(size.x, size.y);
      if (side <= 0) return;

      // The gizmo shows the same rotation as the view, so its camera sits
      // opposite the direction the main camera looks, at a fixed distance.
      main.getWorldDirection(direction);
      camera.position.copy(direction).multiplyScalar(-CAMERA_DISTANCE);
      camera.up.copy(main.up);
      camera.lookAt(0, 0, 0);

      // Draw over what is already there without wiping it: no colour clear,
      // a depth clear so the arrows are not hidden by the building behind
      // them, and a scissor so nothing spills outside the square.
      const wasAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setScissorTest(true);
      renderer.setViewport(x, y, side, side);
      renderer.setScissor(x, y, side, side);
      renderer.clearDepth();
      renderer.render(scene, camera);

      // Put the renderer back exactly as it was found, or the next frame of
      // the model draws into this corner.
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.x, size.y);
      renderer.autoClear = wasAutoClear;
    },

    dispose() {
      for (const texture of textures) texture.dispose();
      scene.traverse((node) => {
        const it = node as { dispose?: () => void; material?: { dispose?: () => void } };
        it.dispose?.();
        it.material?.dispose?.();
      });
      scene.clear();
    },
  };
}
