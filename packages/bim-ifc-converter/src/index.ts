/**
 * Turning an IFC file into geometry a browser can draw.
 *
 * Why this runs in the browser
 * ----------------------------
 * IFC is a text exchange format holding parametric solids: a wall is a profile
 * swept along a path with holes subtracted, not a list of triangles. Producing
 * the triangles needs a geometry kernel. The one used here is
 * [web-ifc](https://github.com/ThatOpen/engine_web-ifc), compiled to
 * WebAssembly, so the conversion happens on the machine that is looking at the
 * model and the platform needs no converter service.
 *
 * What comes out
 * --------------
 * Plain typed arrays, in metres, Y up. Nothing here imports three.js or any
 * other renderer: the caller decides what to build from the numbers. That is
 * what lets this be tested in Node, where there is no canvas.
 *
 * Y up rather than IFC's Z up, because that is what glTF uses and what the
 * geometry produced by the Python converter in this repository already
 * carries. A viewer must not have to ask which of the two it is looking at.
 *
 * What it does not do
 * -------------------
 * It does not write a GLB. Storing the result is the caller's decision and a
 * different problem: the caller knows where its files live.
 */

import { IfcAPI, type PlacedGeometry } from 'web-ifc';

import { WEB_IFC_WASM_BASE64 } from './generated/wasm.js';

/** The identity and the triangles of one object. */
export interface ConvertedObject {
  /** The IFC GlobalId, which survives a re-export and a mesh name does not. */
  globalId: string;
  /** The entity type, for example `IfcWall`. */
  ifcClass: string;
  name?: string;
  /** World space vertices, metres, Y up, three numbers per vertex. */
  positions: Float32Array;
  /** World space normals, three per vertex, matching `positions`. */
  normals: Float32Array;
  indices: Uint32Array;
  /** The colour the model itself declares, linear RGBA. */
  colour: [number, number, number, number];
}

export interface Converted {
  /** The schema the file declares, for example `IFC4`. */
  schema: string;
  objects: ConvertedObject[];
  /**
   * Objects the kernel could not triangulate.
   *
   * Reported rather than hidden. Some shapes defeat any kernel, and a viewer
   * that silently draws less than the file holds gives no way to tell.
   */
  failed: number;
}

export interface ConvertOptions {
  /**
   * Where the WebAssembly module is fetched from, as a directory ending in a
   * slash.
   *
   * Left unset, the copy carried inside this package is used, which is what
   * makes a consumer need nothing but `npm install`. Set it only to serve the
   * file from somewhere else on purpose.
   */
  wasmPath?: string;
  /** Called with how many objects are done, so a caller can show progress. */
  onProgress?: (done: number) => void;
}

/**
 * Apply the sRGB transfer function to one channel.
 *
 * A colour picked by an architect, and the one web-ifc reads out of
 * `IfcSurfaceStyleRendering`, is an sRGB value. A renderer adds light in
 * linear values, and glTF requires a base colour to be linear for that reason,
 * so the Python converter in this repository converts before writing its GLB.
 * Handing raw sRGB numbers to a renderer instead makes every surface too
 * light: the greys of a real model came out at #c0c0c0 where the GLB of the
 * same file gives #868686.
 *
 * The exact curve rather than the `value ** 2.2` approximation, because the
 * approximation is wrong in the dark end and because the two converters have
 * to agree to the byte.
 */
function toLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * Multiply a vertex by web-ifc's flat 4x4 placement, column major.
 *
 * The kernel returns each object's triangles in its own local space plus the
 * placement that puts it in the building. Applying it here rather than passing
 * both out keeps the shape of the result simple: one array of world space
 * vertices per object, which is what a renderer wants.
 */
function place(m: ArrayLike<number>, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** Rotate a direction. A normal is a direction, so it takes no translation. */
function turn(m: ArrayLike<number>, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ];
}

/**
 * Whether the parser carried in this package should be used.
 *
 * In a browser it must be: nothing else serves the file, and fetching it from
 * another origin is what an air-gapped install cannot do.
 *
 * Under Node it must not be. The loader web-ifc uses there opens what it is
 * given as a path on disk, so a blob URL fails, and the file is already beside
 * the module anyway. That is the case the tests run in.
 */
function browserCarriesTheParser(): boolean {
  return typeof Blob === 'function'
    && typeof URL !== 'undefined'
    && typeof URL.createObjectURL === 'function'
    // `process` is how a Node runtime announces itself, and it is read
    // through globalThis so this file needs no Node type definitions.
    && (globalThis as { process?: unknown }).process === undefined;
}

/**
 * The parser carried in this package, as a URL a loader can fetch.
 *
 * Made once and kept, because a blob URL is a resource the page holds until it
 * is revoked and converting three models should not make three of them.
 */
let carried: string | undefined;

function carriedWasmUrl(): string {
  if (carried) return carried;
  const binary = atob(WEB_IFC_WASM_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  carried = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
  return carried;
}

interface Piece {
  positions: number[];
  normals: number[];
  indices: number[];
  colour: [number, number, number, number];
}

/** Read one placed geometry into flat arrays, already in world space and Y up. */
function readPiece(api: IfcAPI, model: number, placed: PlacedGeometry): Piece | null {
  const geometry = api.GetGeometry(model, placed.geometryExpressID);
  try {
    // web-ifc interleaves position and normal, six numbers per vertex.
    const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
    const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
    if (vertices.length === 0 || indices.length === 0) return null;

    // web-ifc's flat transformation already places the object in a Y-up world,
    // the same one the Python converter writes into its GLB. Rotating it again
    // for the Z-up to Y-up change, which this file used to do, laid the whole
    // building on its side. Measuring the two converters against one file is
    // what showed it: the bounding boxes now agree to the centimetre.
    const matrix = placed.flatTransformation;
    const positions: number[] = [];
    const normals: number[] = [];
    for (let i = 0; i < vertices.length; i += 6) {
      const p = place(matrix, vertices[i], vertices[i + 1], vertices[i + 2]);
      const n = turn(matrix, vertices[i + 3], vertices[i + 4], vertices[i + 5]);
      positions.push(p[0], p[1], p[2]);
      normals.push(n[0], n[1], n[2]);
    }

    // Alpha is a coverage fraction and not a colour, so it stays as it is.
    const { x, y, z, w } = placed.color;
    const colour: [number, number, number, number] = [
      toLinear(x), toLinear(y), toLinear(z), w,
    ];
    return { positions, normals, indices: Array.from(indices), colour };
  } finally {
    geometry.delete();
  }
}

/**
 * Convert an IFC file.
 *
 * The bytes are read once and never held twice: the model is closed before
 * returning, so a browser tab that converts a sixty megabyte file does not keep
 * the parser's copy of it afterwards.
 */
export async function convertIfc(
  bytes: Uint8Array,
  options: ConvertOptions = {},
): Promise<Converted> {
  const api = new IfcAPI();
  if (options.wasmPath) api.SetWasmPath(options.wasmPath, true);
  // Otherwise the parser comes from inside this package where that is
  // possible, so nothing is fetched from another origin and an air-gapped
  // install works unchanged.
  const carry = !options.wasmPath && browserCarriesTheParser();
  await (carry ? api.Init(() => carriedWasmUrl()) : api.Init());

  const model = api.OpenModel(bytes);
  const objects: ConvertedObject[] = [];
  let failed = 0;

  try {
    api.StreamAllMeshes(model, (mesh) => {
      const line = api.GetLine(model, mesh.expressID, false) as {
        GlobalId?: { value?: string };
        Name?: { value?: string };
        constructor: { name: string };
      } | null;
      const globalId = line?.GlobalId?.value;
      if (!globalId) {
        // Without a GlobalId nothing can be bound to it, and binding is the
        // whole purpose. Counted rather than drawn.
        failed += 1;
        return;
      }

      const pieces: Piece[] = [];
      for (let i = 0; i < mesh.geometries.size(); i += 1) {
        const piece = readPiece(api, model, mesh.geometries.get(i));
        if (piece) pieces.push(piece);
      }
      if (pieces.length === 0) {
        failed += 1;
        return;
      }

      // One object may be several placed geometries, a wall and its cladding
      // for instance. They are joined so an object is one thing a person can
      // click, which is what the binding assumes.
      const positions: number[] = [];
      const normals: number[] = [];
      const indices: number[] = [];
      for (const piece of pieces) {
        const offset = positions.length / 3;
        positions.push(...piece.positions);
        normals.push(...piece.normals);
        for (const index of piece.indices) indices.push(index + offset);
      }

      objects.push({
        globalId,
        // The mesh carries the express id, not the entity type, so the type
        // is asked for separately and turned into the name a person reads.
        ifcClass: api.GetNameFromTypeCode(api.GetLineType(model, mesh.expressID))
          || 'IfcProduct',
        name: line?.Name?.value,
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        indices: new Uint32Array(indices),
        colour: pieces[0].colour,
      });
      options.onProgress?.(objects.length);
    });

    return { schema: api.GetModelSchema(model), objects, failed };
  } finally {
    api.CloseModel(model);
  }
}
