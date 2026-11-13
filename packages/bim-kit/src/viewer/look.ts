/**
 * How the model is lit and finished: shadows, a ground, a section plane and
 * ambient occlusion.
 *
 * A plain render of a converted model reads as flat colour: two lamps light
 * every face of one colour the same, nothing sits on anything and the inside
 * of a room is hidden behind its roof. Viewers that read well (the That Open
 * Engine is the reference here) add four things, and all four are in
 * three.js itself, so this file adds no dependency:
 *
 * - a soft light from every side, from a small built-in room, so the faces of
 *   one colour still differ;
 * - shadows from the sun on the model and on a ground under it;
 * - ambient occlusion, which darkens the creases where a wall meets a slab;
 * - a horizontal cut, which opens a floor to be read like a plan.
 *
 * The parts that need a graphics context (the room light and the passes) are
 * kept thin. The arithmetic, which is what goes wrong, runs in Node.
 */

import {
  Box3,
  type Camera,
  type DirectionalLight,
  Mesh,
  type Object3D,
  PCFShadowMap,
  Plane,
  PlaneGeometry,
  PMREMGenerator,
  type Scene,
  ShadowMaterial,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** The side of the shadow map, in pixels. Larger is sharper and slower. */
export const SHADOW_MAP_PX = 2048;

/** How dark the shadow on the ground is, from 0 to 1. */
export const GROUND_SHADOW_OPACITY = 0.18;

/**
 * How far the ground reaches past the model, as a share of its size, so a
 * shadow thrown sideways at a low sun still lands on something.
 */
export const GROUND_MARGIN = 1.5;

/** How far below the lowest object the ground sits, so the two never fight for the same depth. */
export const GROUND_DROP_M = 0.01;

/**
 * How much the room light adds, on top of the lamps.
 *
 * At 1 the room and the two lamps together washed every pale surface out to
 * the same white and the roof came out a pastel of its own colour. Half of it,
 * with the ambient lamp lowered to match, keeps the colours the model was
 * authored with and still lifts the faces the sun does not reach.
 */
export const ROOM_LIGHT = 0.5;

/**
 * Let the renderer draw shadows.
 *
 * No tone mapping is set. ACES shifted every colour of the model and greyed
 * the background, and the neutral one needs three.js r162 while this package
 * accepts r160. Without one the colours are the ones the model carries.
 */
export function prepareRenderer(renderer: WebGLRenderer): void {
  renderer.shadowMap.enabled = true;
  // PCF and not PCF soft: three.js 0.186 no longer has the soft one, falls
  // back to this and warns about it on every load.
  renderer.shadowMap.type = PCFShadowMap;
}

/**
 * Light the scene from a small built-in room.
 *
 * The room is turned into an environment map once. Every standard material
 * then takes a little light from every side, which is what keeps two faces
 * of the same wall from coming out the same colour.
 */
export function lightFromRoom(renderer: WebGLRenderer, scene: Scene): () => void {
  const generator = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const target = generator.fromScene(room, 0.04);
  scene.environment = target.texture;
  // Read by three.js r163 and later. Older versions draw the room at full
  // strength, which is brighter but not wrong.
  (scene as Scene & { environmentIntensity?: number }).environmentIntensity = ROOM_LIGHT;
  room.dispose();
  generator.dispose();
  return () => {
    scene.environment = null;
    target.dispose();
  };
}

/**
 * Let the model throw and take shadows, and give it a ground to throw them on.
 *
 * The sun keeps its direction and is moved to look at the centre of the
 * model from far enough away. Its shadow camera is fitted to the model, so
 * the map is spent on the building and not on empty space: one fitted to a
 * fixed size either cuts a large building off or blurs a small one.
 *
 * Answers a function that takes the ground away again.
 */
export function castShadows(model: Object3D, sun: DirectionalLight, scene: Scene): () => void {
  model.traverse((node) => {
    const mesh = node as Mesh & { isMesh?: boolean };
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });

  const box = new Box3().setFromObject(model);
  if (box.isEmpty()) return () => undefined;
  const centre = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const radius = Math.max(size.x, size.y, size.z) / 2;

  const direction = sun.position.clone().sub(sun.target.position).normalize();
  sun.position.copy(centre).addScaledVector(direction, radius * 3);
  sun.target.position.copy(centre);
  sun.target.updateMatrixWorld();
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_PX, SHADOW_MAP_PX);
  const reach = radius * (1 + GROUND_MARGIN);
  Object.assign(sun.shadow.camera, {
    left: -reach,
    right: reach,
    top: reach,
    bottom: -reach,
    near: radius,
    far: radius * 5,
  });
  sun.shadow.camera.updateProjectionMatrix();
  // A small bias stops a face shadowing itself in stripes.
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;

  const span = Math.max(size.x, size.z) * (1 + 2 * GROUND_MARGIN);
  const ground = new Mesh(
    new PlaneGeometry(span, span),
    new ShadowMaterial({ opacity: GROUND_SHADOW_OPACITY }),
  );
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(centre.x, box.min.y - GROUND_DROP_M, centre.z);
  ground.receiveShadow = true;
  scene.add(ground);

  return () => {
    scene.remove(ground);
    ground.geometry.dispose();
    (ground.material as ShadowMaterial).dispose();
  };
}

/** The part of a renderer the section writes, so a test can pass a plain object. */
export interface Clipped {
  clippingPlanes: Plane[];
}

/**
 * A horizontal cut: everything above the height is not drawn.
 *
 * Set on the renderer and not on each material, so the heatmap, the ghost
 * and the highlight materials, which are swapped in and out, are cut the
 * same way without each having to remember to.
 */
export function createSection(renderer: Clipped) {
  // A plane keeps what is on the side its normal points to. Pointing down
  // keeps everything below the height.
  const plane = new Plane(new Vector3(0, -1, 0), 0);
  let current: number | null = null;
  return {
    /** Cut at this height in metres, or take the cut away with null. */
    set(height: number | null): void {
      if (height === current) return;
      current = height;
      if (height === null) {
        renderer.clippingPlanes = [];
        return;
      }
      plane.constant = height;
      renderer.clippingPlanes = [plane];
    },
    get height(): number | null {
      return current;
    },
    /** Cut with any set of planes, such as a horizontal and a vertical cut together. */
    setPlanes(planes: Plane[]): void {
      current = null;
      renderer.clippingPlanes = planes;
    },
  };
}

/**
 * Draw through ambient occlusion, then finish the colour.
 *
 * The occlusion pass is the one thing that makes the creases of a building
 * read. It costs a full screen pass, so a host that draws many viewers at
 * once can leave this out and call `renderer.render` instead.
 */
export function createFinish(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const occlusion = new GTAOPass(scene, camera);
  composer.addPass(occlusion);
  composer.addPass(new OutputPass());
  return {
    render: () => composer.render(),
    setSize: (width: number, height: number) => composer.setSize(width, height),
    dispose: () => {
      occlusion.dispose();
      composer.dispose();
    },
  };
}
