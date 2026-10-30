/**
 * Spreading sources over a grid by walking distance.
 *
 * A walk that only steps along the rows and columns measures distance block by
 * block, as in a city grid. Two sensors in one open room then split it along
 * 45-degree lines and along rows, nowhere near halfway between them. Steps
 * along the diagonals as well, at their true length, keep the split within a
 * few percent of the straight line in open space and still go round walls.
 */

/** Where a source starts: a cell and the distance already walked to reach it. */
export interface Seed {
  cell: number;
  source: number;
  distance: number;
}

const DIAGONAL = Math.SQRT2;
const STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, DIAGONAL], [1, -1, DIAGONAL], [-1, 1, DIAGONAL], [-1, -1, DIAGONAL],
];

/** A binary heap of cells ordered by distance, smallest first. */
class Queue {
  private cells: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.cells.length;
  }

  push(cell: number, key: number): void {
    this.cells.push(cell);
    this.keys.push(key);
    let i = this.cells.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.cells[0], this.keys[0]];
    const lastCell = this.cells.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.cells.length > 0) {
      this.cells[0] = lastCell;
      this.keys[0] = lastKey;
      this.sink(0);
    }
    return top;
  }

  private sink(start: number): void {
    let i = start;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < this.keys.length && this.keys[left] < this.keys[smallest]) smallest = left;
      if (right < this.keys.length && this.keys[right] < this.keys[smallest]) smallest = right;
      if (smallest === i) return;
      this.swap(i, smallest);
      i = smallest;
    }
  }

  private swap(a: number, b: number): void {
    [this.cells[a], this.cells[b]] = [this.cells[b], this.cells[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

/**
 * Which source each cell is nearest to, walking round blocked cells.
 *
 * A diagonal step is taken only when both cells beside it are open, so the
 * walk cannot slip between two walls that touch at a corner.
 */
export function walkOwners(blocked: Uint8Array, nx: number, nz: number, seeds: Seed[]): Int16Array {
  const owner = new Int16Array(nx * nz).fill(-1);
  const distance = new Float64Array(nx * nz).fill(Infinity);
  const queue = new Queue();
  for (const seed of seeds) {
    if (blocked[seed.cell] || seed.distance >= distance[seed.cell]) continue;
    distance[seed.cell] = seed.distance;
    owner[seed.cell] = seed.source;
    queue.push(seed.cell, seed.distance);
  }
  while (queue.size > 0) {
    const [i, d] = queue.pop();
    if (d > distance[i]) continue;
    const ix = i % nx;
    const iz = Math.floor(i / nx);
    for (const [dx, dz, length] of STEPS) {
      const jx = ix + dx;
      const jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
      const j = jz * nx + jx;
      if (blocked[j] || d + length >= distance[j]) continue;
      if (dx !== 0 && dz !== 0 && (blocked[iz * nx + jx] || blocked[jz * nx + ix])) continue;
      distance[j] = d + length;
      owner[j] = owner[i];
      queue.push(j, d + length);
    }
  }
  return owner;
}
