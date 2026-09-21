/**
 * Finding the building models a user has, and the geometry derived from them.
 *
 * A person uploads an IFC file through the Library page, which lands it in the
 * workspace at `common/models/`. The browser cannot read IFC: it is a text
 * exchange format holding parametric solids, and turning it into triangles is
 * the job of a geometry kernel that does not run here. Conversion happens
 * outside the browser and leaves its result beside the source, so this module
 * only has to notice whether that has happened.
 *
 * The Library page already embeds the workspace file server, so the same
 * server answers here: `api/contents` lists a directory and `files` serves the
 * bytes. Reading a 20 MB GLB through the GitLab API instead would arrive as
 * base64 inside JSON, and the client's existing helper for that returns a
 * string, which is not a safe container for binary.
 *
 * Nothing here fetches. The functions take a listing and return what it means,
 * so they can be tested without a server.
 */

/** One entry as the workspace file server reports it. */
export interface LibraryEntry {
  name: string;
  path: string;
  type?: string;
  size?: number;
}

/** A building model, with whatever has been derived from it so far. */
export interface BimModel {
  /** The file name without its suffix, which is what a person recognises. */
  name: string;
  /**
   * What to call the model on screen.
   *
   * A file name says what the file is called and not what the building is, so
   * `catalogue.json` beside the models can give each one a title. Without that
   * file, or without an entry in it, this is the file name and the page reads
   * exactly as it did before.
   */
  title: string;
  ifcPath: string;
  sizeBytes?: number;
  /** Present once the conversion has run. Absent means it has not. */
  geometryPath?: string;
  /** The property tree keyed by GlobalId, written beside the geometry. */
  treePath?: string;
  /** Which sensor is bound to which object. Absent when the model declares none. */
  manifestPath?: string;
}

const IFC = '.ifc';
const GEOMETRY = '.glb';
const TREE = '.json';
// Checked before TREE, because it also ends in `.json` and would otherwise be
// taken for the property tree.
const MANIFEST = '.manifest.json';

/** Where the models a person uploads are kept, under the shared library. */
export const MODELS_DIRECTORY = 'common/models';

/**
 * The optional file that names the buildings, read from the models directory.
 *
 * It maps an IFC file name to the title to show, and nothing more:
 *
 * ```json
 * {
 *   "Building_1911_AK_v2.ifc": "Pædagogisk Center",
 *   "2116_FEAS_kedelhuset.ifc": "FEAS - Kommunehospital"
 * }
 * ```
 *
 * Absent, unreadable or malformed, every model keeps its file name. Nothing is
 * named in this package, so a deployment decides what its buildings are called
 * by editing one file in its own library.
 */
export const CATALOGUE_FILE = 'catalogue.json';

function stemOf(name: string, suffix: string): string {
  return name.slice(0, name.length - suffix.length);
}

function endsWith(name: string, suffix: string): boolean {
  return name.toLowerCase().endsWith(suffix);
}

/**
 * Pair every IFC file in a listing with the geometry derived from it.
 *
 * The pairing is by file name, because that is the only thing the conversion
 * can be relied on to preserve. A model with no geometry beside it is still
 * returned, so the page can say that conversion has not run instead of
 * leaving the model out and looking like it was never uploaded.
 */
/**
 * A file name as a person reads it, for a model the catalogue does not name.
 *
 * Only the separators change: `Building_1912_AK_v4` reads "Building 1912 AK v4".
 * The case is left alone, because in these names it carries meaning, as in AK
 * and v4, and a guess at a building name would be worse than the file's own.
 */
export function readableName(stem: string): string {
  return stem.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function pairModels(
  entries: LibraryEntry[],
  titles: ReadonlyMap<string, string> = new Map(),
): BimModel[] {
  const derived = new Map<string, LibraryEntry>();
  for (const entry of entries) {
    if (endsWith(entry.name, GEOMETRY)) {
      derived.set(stemOf(entry.name, GEOMETRY) + GEOMETRY, entry);
    } else if (endsWith(entry.name, MANIFEST)) {
      derived.set(stemOf(entry.name, MANIFEST) + MANIFEST, entry);
    } else if (endsWith(entry.name, TREE)) {
      derived.set(stemOf(entry.name, TREE) + TREE, entry);
    }
  }

  return entries
    .filter((entry) => endsWith(entry.name, IFC))
    .map((entry) => {
      const stem = stemOf(entry.name, IFC);
      return {
        name: stem,
        title: titles.get(entry.name) ?? readableName(stem),
        ifcPath: entry.path,
        sizeBytes: entry.size,
        geometryPath: derived.get(stem + GEOMETRY)?.path,
        treePath: derived.get(stem + TREE)?.path,
        manifestPath: derived.get(stem + MANIFEST)?.path,
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}

/**
 * Join a base URL and a workspace path, encoding each segment.
 *
 * The file this was built against is called
 * `[3D IFC SG] Project CleanTech One 02-24 IFC SG.ifc`. Brackets and spaces in
 * a name are ordinary, and pasting one into a URL unencoded produces a request
 * for a different file or for none.
 */
function join(base: string, prefix: string, path: string): string {
  const root = base.endsWith('/') ? base : `${base}/`;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${root}${prefix}/${encoded}`;
}

/** The listing of one directory, as JSON. */
export function contentsUrl(libraryUrl: string, path: string): string {
  return join(libraryUrl, 'api/contents', path);
}

/** The bytes of one file. */
export function fileUrl(libraryUrl: string, path: string): string {
  return join(libraryUrl, 'files', path);
}

/**
 * The titles in the catalogue, or an empty map when there are none.
 *
 * Never rejects. The catalogue is an optional convenience, so a missing file, a
 * server that answers with a page instead of data, or a file somebody has
 * broken while editing all mean the same thing here: no titles, and every model
 * keeps its file name. Failing the whole models list over a naming file would
 * be the wrong trade.
 */
export async function readCatalogue(
  libraryUrl: string,
  directory: string = MODELS_DIRECTORY,
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  try {
    const response = await fetch(
      fileUrl(libraryUrl, `${directory}/${CATALOGUE_FILE}`),
      { credentials: 'include' },
    );
    if (!response.ok) return titles;

    const parsed: unknown = await response.json();
    if (typeof parsed !== 'object' || parsed === null) return titles;

    // Only string values are taken, so a number or an object left in the file
    // by mistake is skipped instead of reaching the page as "[object Object]".
    Object.entries(parsed as Record<string, unknown>).forEach(([file, title]) => {
      if (typeof title === 'string' && title.trim() !== '') {
        titles.set(file, title.trim());
      }
    });
  } catch {
    return titles;
  }
  return titles;
}

/** How large a model is, for a page that has to admit a 24 MB download. */
export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
