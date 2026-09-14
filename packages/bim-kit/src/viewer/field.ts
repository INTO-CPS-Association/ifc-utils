/**
 * Which sensor reaches each point of a floor, as a grid.
 *
 * The other groupings a heatmap offers ask the model which room or storey an
 * object is in. A model that declares no `IfcSpace` and draws one storey
 * answers the same thing for every object, so a dozen readings average into
 * one colour over everything and the picture says nothing.
 *
 * Straight-line distance to the nearest sensor is wrong for a different
 * reason: it goes through walls. A sensor in one office colours the office
 * next door, which is separated from it by two hundred millimetres of drywall
 * and shares no air with it.
 *
 * So the floor is rasterised and the field spreads by walking. Cells inside a
 * wall are blocked, cells inside a door are opened again because a doorway is
 * how air moves between rooms, and every sensor floods outwards at once. A
 * sensor fills its own room and stops at the walls.
 *
 * The idea of a grid over the plan instead of a colour per object comes from
 * ProBIM's `ExportHeatmap`, which samples a floor into cells and scores each.
 *
 * It approximates. An object blocks by its bounding box, so a wall at an angle
 * blocks more than it should, and every model this was built against is
 * orthogonal.
 */

import { Box3, Vector3, type Mesh } from 'three';

/** How wide a cell is, in metres. A doorway is about 0.9 m, so this fits three. */
export const CELL_M = 0.25;

/** How far above the floor the plan is cut. Chest height: above the furniture and below the lintels, so a doorway reads as a gap and a desk does not. */
export const CUT_M = 1.2;

/** What stops the field. Furniture is not here: air moves over a desk. */
export const BLOCKS = new Set([
  'IfcWall', 'IfcWallStandardCase', 'IfcColumn', 'IfcCurtainWall',
]);

/** What opens it again, because a doorway is how one room reaches the next. */
export const OPENS = new Set(['IfcDoor']);

/** How far to look for an owned cell around a point inside a wall. A wall is 0.2 m and a cell 0.25 m, so three reaches through the thickest of them. */
export const SEARCH_CELLS = 3;

/** How many cells around a sensor are seeded, since a sensor sits on a wall and its own cell is usually inside it. */
const SEED_CELLS = 2;

export interface Field {
  /** The index of the owning source per cell, or -1 where none reaches. */
  owner: Int16Array;
  nx: number;
  nz: number;
  cell: number;
  minX: number;
  minZ: number;
  /** The height the plan was cut at, which a caller draws the sheet just above. */
  floorY: number;
}

/**
 * Build the grid.
 *
 * `sources` are the world positions to flood from, in the order a caller wants
 * them indexed. Returns null when there is nothing to flood from or nothing to
 * flood through, which a caller shows as no field at all.
 */
export function buildField(
  meshes: Iterable<Mesh>,
  sources: Vector3[],
  floorY: number,
): Field | null {
  const all = [...meshes];
  if (sources.length === 0 || all.length === 0) return null;

  const bounds = new Box3();
  for (const mesh of all) bounds.expandByObject(mesh);
  if (!Number.isFinite(bounds.min.x)) return null;

  const cell = CELL_M;
  const minX = bounds.min.x;
  const minZ = bounds.min.z;
  const nx = Math.max(1, Math.ceil((bounds.max.x - minX) / cell));
  const nz = Math.max(1, Math.ceil((bounds.max.z - minZ) / cell));
  const at = (x: number, z: number) =>
    [Math.floor((x - minX) / cell), Math.floor((z - minZ) / cell)] as const;

  const box = new Box3();
  const blocked = new Uint8Array(nx * nz);
  const paint = (value: number) => {
    const [ax, az] = at(box.min.x, box.min.z);
    const [bx, bz] = at(box.max.x, box.max.z);
    for (let ix = ax; ix <= bx; ix += 1) {
      for (let iz = az; iz <= bz; iz += 1) {
        if (ix >= 0 && iz >= 0 && ix < nx && iz < nz) blocked[iz * nx + ix] = value;
      }
    }
  };

  const cut = floorY + CUT_M;
  // Walls first and doors after, so a doorway is a hole in the wall it is cut
  // into and not the other way round.
  for (const mesh of all) {
    if (!BLOCKS.has(mesh.userData.ifcClass as string)) continue;
    box.setFromObject(mesh);
    if (box.min.y < cut && box.max.y > cut) paint(1);
  }
  for (const mesh of all) {
    if (!OPENS.has(mesh.userData.ifcClass as string)) continue;
    box.setFromObject(mesh);
    paint(0);
  }

  // One queue with every source seeded, so each cell ends up owned by the one
  // whose walk reaches it first. That is the nearest source measured the way a
  // person walks and not the way a laser points.
  const owner = new Int16Array(nx * nz).fill(-1);
  const queue: number[] = [];
  sources.forEach((source, index) => {
    const [cx, cz] = at(source.x, source.z);
    for (let dx = -SEED_CELLS; dx <= SEED_CELLS; dx += 1) {
      for (let dz = -SEED_CELLS; dz <= SEED_CELLS; dz += 1) {
        const ix = cx + dx;
        const iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
        const i = iz * nx + ix;
        if (blocked[i] || owner[i] !== -1) continue;
        owner[i] = index;
        queue.push(i);
      }
    }
  });
  if (queue.length === 0) return null;

  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head];
    const ix = i % nx;
    const iz = Math.floor(i / nx);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const jx = ix + dx;
      const jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
      const j = jz * nx + jx;
      if (blocked[j] || owner[j] !== -1) continue;
      owner[j] = owner[i];
      queue.push(j);
    }
  }

  return { owner, nx, nz, cell, minX, minZ, floorY };
}

/**
 * Which source covers a point of the plan, as an index, or -1.
 *
 * Rings outward when the point itself is unowned, because plenty of things sit
 * inside a wall: a sensor is mounted on one and a door fills a hole in one,
 * and a wall's own cells are blocked. Without this a sensor would not be in
 * its own region and would colour nothing.
 */
export function sourceAt(field: Field, x: number, z: number): number {
  const cx = Math.floor((x - field.minX) / field.cell);
  const cz = Math.floor((z - field.minZ) / field.cell);

  for (let ring = 0; ring <= SEARCH_CELLS; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dz = -ring; dz <= ring; dz += 1) {
        // Only the edge of each ring, so the nearest owned cell wins.
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue;
        const ix = cx + dx;
        const iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= field.nx || iz >= field.nz) continue;
        const index = field.owner[iz * field.nx + ix];
        if (index >= 0) return index;
      }
    }
  }
  return -1;
}
