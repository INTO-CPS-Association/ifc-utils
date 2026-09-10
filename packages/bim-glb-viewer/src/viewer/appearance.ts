/**
 * What every object is painted with, decided in one place.

 * Four things want to change how an object looks: the heatmap, the transparency toggle, the selection and the hover, over the model's own colour underneath all of them. When each wrote to `material` separately the last to run won, and the last to run was the heatmap, which reset every object on every reading. A transparency that lasted a second and a half is what this exists to prevent.
 *
 * So nothing else assigns a material. This decides, and `refresh` applies.
 */

import { Color, DoubleSide, Mesh, MeshStandardMaterial, type Material } from 'three';

import { rampColour } from '../ramp.js';

/** Yellow, at half opacity. Taken from the ProBIM Explorer, so a person moving between the two viewers reads the same signal. */
export const SELECTED_COLOUR = 0xffff00;

/** Pale blue, at half opacity. Also ProBIM's. */
export const HOVERED_COLOUR = 0xa3f1ff;

/** How much of a wall is left when the model is made see-through. */
const GHOST_OPACITY = 0.14;

/** The shell of a building: what makes it opaque from outside. Sensors and the equipment they sit on are never here, because they are what a person is trying to see. */
export const SHELL = new Set([
  'IfcWall', 'IfcWallStandardCase', 'IfcSlab', 'IfcRoof', 'IfcCurtainWall',
  'IfcPlate', 'IfcMember', 'IfcCovering', 'IfcWindow', 'IfcDoor', 'IfcRailing',
]);

function highlight(colour: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(colour),
    transparent: true,
    opacity: 0.5,
    side: DoubleSide,
  });
}

/**
 * Every material this decides between, made once.
 *
 * A material is a compiled shader program. Cloning one per object per frame allocates thousands a second on a ten thousand object model, which is the difference between a viewer and a slideshow.
 */
export class Palette {
  readonly selected = highlight(SELECTED_COLOUR);

  readonly hovered = highlight(HOVERED_COLOUR);

  /** The material each object arrived with, so it can be given back. */
  private readonly base = new Map<string, Material | Material[]>();

  private readonly heat = new Map<number, MeshStandardMaterial>();

  private readonly ghosts = new Map<Material, MeshStandardMaterial>();

  remember(globalId: string, mesh: Mesh): void {
    this.base.set(globalId, mesh.material);
  }

  baseOf(globalId: string): Material | Material[] | undefined {
    return this.base.get(globalId);
  }

  /** One material per colour of the ramp, not one per object. */
  heatOf(value: number, low: number, high: number): MeshStandardMaterial {
    const colour = rampColour(value, low, high);
    let material = this.heat.get(colour);
    if (!material) {
      material = new MeshStandardMaterial({
        color: colour, metalness: 0, roughness: 1, side: DoubleSide,
      });
      this.heat.set(colour, material);
    }
    return material;
  }

  /** A see-through copy of a material, made once and kept. */
  ghostOf(material: Material | Material[] | undefined): Material | Material[] | undefined {
    if (!material || Array.isArray(material)) return material;
    let ghost = this.ghosts.get(material);
    if (!ghost) {
      ghost = (material as MeshStandardMaterial).clone();
      ghost.transparent = true;
      ghost.opacity = GHOST_OPACITY;
      // Without this a see-through wall still hides what is behind it, because
      // it writes depth while drawing almost nothing.
      ghost.depthWrite = false;
      this.ghosts.set(material, ghost);
    }
    return ghost;
  }

  dispose(): void {
    this.selected.dispose();
    this.hovered.dispose();
    for (const material of this.heat.values()) material.dispose();
    for (const material of this.ghosts.values()) material.dispose();
    this.heat.clear();
    this.ghosts.clear();
    this.base.clear();
  }
}
