/**
 * The view cube in the corner of the view.
 *
 * A cube turned with the model, with its faces named. A click on the middle
 * of a face looks at the model from that side, a click near an edge looks
 * from between the two faces, and near a corner from between three. That is
 * twenty six directions from one control, and the cube's own turn always says
 * which side of the building is in front.
 *
 * Drawn like the axes indicator, as a second scene into a corner of the same
 * canvas: bottom right, since the indicator holds bottom left.
 */

import {
  BoxGeometry,
  CanvasTexture,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Raycaster,
  SRGBColorSpace,
  Scene,
  Vector2,
  Vector3,
  type Camera,
  type Material,
  type WebGLRenderer,
} from 'three';

/** The side of the square the cube is drawn into, in CSS pixels. */
export const CUBE_SIZE_PX = 96;

/** The gap between that square and the edges of the view, in CSS pixels. */
export const CUBE_MARGIN_PX = 12;

/**
 * How close to an edge of a face a click has to be, in the cube's own units
 * where a face runs from -0.5 to 0.5, to count as the edge and not the face.
 */
export const CUBE_EDGE = 0.3;

/** The faces in the order BoxGeometry gives them materials: +x, -x, +y, -y, +z, -z. */
export const CUBE_FACES = ['Right', 'Left', 'Top', 'Bottom', 'Front', 'Back'];

const CAMERA_DISTANCE = 4;
const HALF_EXTENT = 1.05;

/** Where the square goes, in CSS pixels from the top left, and in the units `setViewport` wants. */
export function cubeViewport(width: number, height: number, size = CUBE_SIZE_PX, margin = CUBE_MARGIN_PX) {
  const side = Math.max(0, Math.min(size, width - 2 * margin, height - 2 * margin));
  const left = width - margin - side;
  const top = height - margin - side;
  // WebGL counts from the bottom, the page from the top.
  return { left, top, side, x: left, y: margin };
}

/**
 * The direction to look from, for a point on the surface of the unit cube.
 *
 * Each axis on which the point is near the surface adds that side: the middle
 * of the top face gives straight down from above, the top front edge gives
 * from above and in front, a corner gives an isometric view.
 */
export function directionAt(point: { x: number; y: number; z: number }, edge = CUBE_EDGE): Vector3 {
  const near = (value: number) => (Math.abs(value) > edge ? Math.sign(value) : 0);
  return new Vector3(near(point.x), near(point.y), near(point.z));
}

function faceTexture(text: string): CanvasTexture | null {
  const canvas = globalThis.document?.createElement('canvas');
  if (!canvas) return null;
  canvas.width = 128;
  canvas.height = 128;
  const pen = canvas.getContext('2d');
  if (!pen) return null;
  pen.fillStyle = '#f4f6f7';
  pen.fillRect(0, 0, 128, 128);
  pen.fillStyle = '#1f3a46';
  pen.font = '700 30px system-ui, sans-serif';
  pen.textAlign = 'center';
  pen.textBaseline = 'middle';
  pen.fillText(text, 64, 66);
  const texture = new CanvasTexture(canvas);
  // Painted in sRGB like the page. Read as linear, the dark letters came out
  // a pale grey that could not be read on the pale face.
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export interface ViewCube {
  /** Draw it into the bottom right corner of a view already rendered. */
  draw(renderer: WebGLRenderer, camera: Camera): void;
  /**
   * The direction to look from for a click at `x`, `y` CSS pixels in a view
   * `width` by `height`, or null when the click is not on the cube.
   */
  pick(x: number, y: number, width: number, height: number): Vector3 | null;
  dispose(): void;
}

export function createViewCube(): ViewCube {
  const scene = new Scene();
  const camera = new OrthographicCamera(
    -HALF_EXTENT, HALF_EXTENT, HALF_EXTENT, -HALF_EXTENT, 0.1, 100,
  );
  const materials: Material[] = CUBE_FACES.map((name) => {
    const map = faceTexture(name);
    return new MeshBasicMaterial({ color: map ? 0xffffff : 0xf4f6f7, map });
  });
  const geometry = new BoxGeometry(1, 1, 1);
  const cube = new Mesh(geometry, materials);
  scene.add(cube);
  const edges = new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial({ color: 0x8a9aa4 }));
  scene.add(edges);

  const direction = new Vector3();
  const size = new Vector2();
  const ray = new Raycaster();

  const aim = (main: Camera) => {
    main.getWorldDirection(direction);
    camera.position.copy(direction).multiplyScalar(-CAMERA_DISTANCE);
    camera.up.copy(main.up);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
  };

  // Kept from the last draw, so a click is read against the cube as drawn.
  let lastMain: Camera | null = null;

  return {
    draw(renderer, main) {
      renderer.getSize(size);
      const { x, y, side } = cubeViewport(size.x, size.y);
      if (side <= 0) return;
      aim(main);
      lastMain = main;
      const wasAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setScissorTest(true);
      renderer.setViewport(x, y, side, side);
      renderer.setScissor(x, y, side, side);
      renderer.clearDepth();
      renderer.render(scene, camera);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.x, size.y);
      renderer.autoClear = wasAutoClear;
    },

    pick(px, py, width, height) {
      const { left, top, side } = cubeViewport(width, height);
      if (side <= 0 || px < left || px > left + side || py < top || py > top + side) return null;
      if (lastMain) aim(lastMain);
      const ndc = new Vector2(((px - left) / side) * 2 - 1, -(((py - top) / side) * 2 - 1));
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(cube, false)[0];
      return hit ? directionAt(hit.point) : null;
    },

    dispose() {
      for (const material of materials) {
        (material as MeshBasicMaterial).map?.dispose();
        material.dispose();
      }
      geometry.dispose();
      edges.geometry.dispose();
      (edges.material as Material).dispose();
      scene.clear();
    },
  };
}
