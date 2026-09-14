/**
 * Working out where the floors of a building actually are.
 *
 * A model declares its storeys with an elevation each, and that elevation is
 * often not where the geometry sits. Two of the models this was built against
 * declare millimetres and carry metres, one names its storeys in an order that
 * does not match their height, and one declares twenty six storeys of which
 * four sit within twenty centimetres of each other.
 *
 * So the floors are measured from the objects instead of read from the
 * header. The measurement and the filter then cannot disagree, because they
 * are the same measurement.
 *
 * Nothing here imports a renderer. A caller supplies the base height of each
 * object and which storey the model assigns it, which is a few numbers, and
 * gets back the bands. That is what lets this be tested without a canvas.
 */

/** The vertical slice of the world one floor occupies, in metres. */
export interface Band {
  from: number;
  to: number;
  /** Every name the model uses for this floor. A merged band has several. */
  names: string[];
}

/** One object, reduced to what deciding a floor needs. */
export interface ObjectBase {
  /** The name of the storey the model puts this object in. */
  storey: string;
  /** The lowest point of the object, in world metres. */
  base: number;
}

/**
 * Storeys closer together than this are one floor the model names twice.
 *
 * `2116_FEAS_kedelhuset` declares twenty six storeys and four of them sit
 * within twenty centimetres. As separate bands they are slivers that show
 * almost nothing; merged, the picker offers sixteen floors that are actually
 * different.
 */
export const MERGE_WITHIN_M = 0.5;

/**
 * A little below the measured floor, so the slab a person stands on is inside
 * the band instead of cut away with the floor below.
 */
export const FLOOR_MARGIN_M = 0.2;

/** The height of the topmost floor when nothing above it says how tall it is. */
const FALLBACK_STOREY_HEIGHT_M = 3;

/** Gaps smaller than this are noise instead of a storey height. */
const NOT_A_STOREY_M = 0.1;

function medianOf(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Turn measured object positions into one band per distinct floor.
 *
 * `order` is the storey names as the model lists them, which is only used to
 * decide which storeys exist: the bands themselves are ordered by measured
 * height, because a model can name its storeys in an order that does not match
 * where they are.
 *
 * Returns the bands lowest first. A model with no storeys, or whose storeys
 * hold no objects, gets an empty list instead of an invented floor.
 */
export function bandsFrom(order: string[], objects: ObjectBase[]): Band[] {
  const bases = new Map<string, number[]>();
  for (const { storey, base } of objects) {
    if (!storey || !Number.isFinite(base)) continue;
    const found = bases.get(storey);
    if (found) found.push(base);
    else bases.set(storey, [base]);
  }

  const levels: Array<{ name: string; height: number }> = [];
  for (const name of order) {
    const found = bases.get(name);
    if (!found || found.length === 0) continue;
    const sorted = [...found].sort((a, b) => a - b);
    // The lower quartile instead of the minimum: one object hanging below the
    // slab would otherwise set the floor for the whole storey.
    levels.push({ name, height: sorted[Math.floor(sorted.length * 0.25)] });
  }
  if (levels.length === 0) return [];

  levels.sort((a, b) => a.height - b.height);

  const merged: Array<{ names: string[]; height: number }> = [];
  for (const level of levels) {
    const last = merged[merged.length - 1];
    if (last && level.height - last.height < MERGE_WITHIN_M) last.names.push(level.name);
    else merged.push({ names: [level.name], height: level.height });
  }

  // A height for the topmost floor, taken from the others instead of assumed,
  // so a plant room and an office block both get a sensible one.
  const gaps = merged
    .slice(1)
    .map((level, index) => level.height - merged[index].height)
    .filter((gap) => gap > NOT_A_STOREY_M);
  const typical = medianOf(gaps) ?? FALLBACK_STOREY_HEIGHT_M;

  return merged.map((level, index) => ({
    from: level.height - FLOOR_MARGIN_M,
    to: merged[index + 1]?.height ?? level.height + typical,
    names: level.names,
  }));
}

/** The band a storey name belongs to, or undefined when the model has none. */
export function bandOf(bands: Band[], storey: string): Band | undefined {
  return bands.find((band) => band.names.includes(storey));
}
