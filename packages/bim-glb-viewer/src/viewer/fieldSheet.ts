/**
 * The field drawn as a sheet over the floor.
 *
 * A colour on a wall says "somewhere around here". A sheet over the space says
 * where it is warm and where it is cool, and it reads at a glance because the
 * eye follows an area instead of reading thirty surfaces. The building keeps
 * its own colours underneath, so the model stays the thing being looked at.
 *
 * One canvas the size of the grid, one texel per cell. Cells inside a wall and
 * cells no sensor reaches are left transparent, so the sheet stops at the walls
 * instead of covering them.
 */

import {
  CanvasTexture,
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Scene,
} from 'three';

import { rampColour } from '../ramp.js';
import type { SceneView } from './sceneView.js';

/** How much of the floor the sheet hides. Enough to read, not enough to obscure. */
const OPACITY = 0.5;

/** How far above the floor it sits, so it does not fight the slab for the same pixels. */
const ABOVE_FLOOR_M = 0.02;

export interface FieldSheet {
  /** Draw it, or hide it when the view has nothing to show. */
  draw: (view: SceneView) => void;
  dispose: () => void;
}

export function createFieldSheet(scene: Scene): FieldSheet {
  let mesh: Mesh | null = null;
  let canvas: HTMLCanvasElement | null = null;
  const colour = new Color();

  const clear = () => {
    if (!mesh) return;
    scene.remove(mesh);
    mesh.geometry.dispose();
    const material = mesh.material as MeshBasicMaterial;
    material.map?.dispose();
    material.dispose();
    mesh = null;
    canvas = null;
  };

  return {
    draw(view) {
      const field = view.field;
      const zones = view.heatZones;
      if (view.state.heat !== 'sensor' || field === null || zones === null) {
        if (mesh) mesh.visible = false;
        return;
      }

      // Rebuilt when the grid changes shape, which is when the model changes.
      if (mesh === null || canvas === null || canvas.width !== field.nx) {
        clear();
        canvas = globalThis.document?.createElement('canvas') ?? null;
        if (canvas === null) return;
        canvas.width = field.nx;
        canvas.height = field.nz;
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        mesh = new Mesh(
          new PlaneGeometry(field.nx * field.cell, field.nz * field.cell),
          new MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: OPACITY,
            // Over the floor without hiding what stands on it, and exempt from
            // the storey clipping so it is not cut in half at its own level.
            depthWrite: false,
            clippingPlanes: [],
          }),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.renderOrder = 1;
        scene.add(mesh);
      }

      const pen = canvas.getContext('2d');
      if (!pen || !mesh) return;
      const image = pen.createImageData(field.nx, field.nz);

      for (let i = 0; i < field.owner.length; i += 1) {
        const zone = view.zoneAtCell(i);
        if (zone === undefined) continue;
        const mean = zones.meanByZone.get(zone);
        if (mean === undefined) continue;
        colour.setHex(rampColour(mean, zones.low, zones.high));
        // The canvas rows run the other way from the grid, which counts up in Z.
        const row = field.nz - 1 - Math.floor(i / field.nx);
        const at = (row * field.nx + (i % field.nx)) * 4;
        image.data[at] = Math.round(colour.r * 255);
        image.data[at + 1] = Math.round(colour.g * 255);
        image.data[at + 2] = Math.round(colour.b * 255);
        image.data[at + 3] = 255;
      }
      pen.putImageData(image, 0, 0);
      (mesh.material as MeshBasicMaterial).map!.needsUpdate = true;

      mesh.position.set(
        field.minX + (field.nx * field.cell) / 2,
        field.floorY + ABOVE_FLOOR_M,
        field.minZ + (field.nz * field.cell) / 2,
      );
      mesh.visible = true;
    },

    dispose: clear,
  };
}
