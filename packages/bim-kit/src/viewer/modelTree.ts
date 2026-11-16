/**
 * The objects of a model as a list a person can browse and search.
 *
 * Grouped by floor or by class, the two ways people look for something in a
 * building ("what is on the first floor", "where are the doors"), and filtered
 * by any word of its name, class, GlobalId or property values, so a search for
 * "EI60" finds every object with that fire rating.
 *
 * Plain data in and out, so it runs and is tested without a scene.
 */

/** One object as the list shows it. */
export interface TreeEntry {
  globalId: string;
  name: string;
  ifcClass: string;
  storey: string | null;
  /** Every property value, as text, for the search. */
  values: string[];
}

export type GroupBy = 'storey' | 'class';

/** One group of the list: its title and its objects, sorted by name. */
export interface TreeGroup {
  title: string;
  entries: TreeEntry[];
}

/** The title of the group an object falls in when it has no floor. */
export const NO_FLOOR = 'No Floor';

/** The class name a person reads: IfcWallStandardCase becomes Wall Standard Case. */
export function readableClass(ifcClass: string): string {
  return ifcClass.replace(/^Ifc/, '').replace(/([a-z])([A-Z])/g, '$1 $2') || ifcClass;
}

/** The text a search looks through for each entry, built once per entry and not once per keystroke. */
const haystacks = new WeakMap<TreeEntry, string>();

/** Whether an object matches every word of a query, in any of its texts. */
export function matches(entry: TreeEntry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  let haystack = haystacks.get(entry);
  if (haystack === undefined) {
    haystack = [entry.name, entry.ifcClass, readableClass(entry.ifcClass), entry.globalId,
      entry.storey ?? '', ...entry.values].join('\n').toLowerCase();
    haystacks.set(entry, haystack);
  }
  return words.every((word) => haystack.includes(word));
}

/**
 * The objects that match, grouped. Floors keep the order they are given in,
 * lowest first, with the objects that have none last. Classes are in
 * alphabetical order.
 */
export function groupEntries(
  entries: readonly TreeEntry[],
  by: GroupBy,
  query = '',
  floors: readonly string[] = [],
): TreeGroup[] {
  const groups = new Map<string, TreeEntry[]>();
  for (const entry of entries) {
    if (!matches(entry, query)) continue;
    const title = by === 'class' ? readableClass(entry.ifcClass) : (entry.storey ?? NO_FLOOR);
    const group = groups.get(title);
    if (group) group.push(entry);
    else groups.set(title, [entry]);
  }
  const rank = (title: string) => {
    if (by === 'class') return 0;
    const at = floors.indexOf(title);
    return at === -1 ? (title === NO_FLOOR ? Number.MAX_SAFE_INTEGER : floors.length) : at;
  };
  return [...groups]
    .map(([title, list]) => ({ title, entries: list.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => rank(a.title) - rank(b.title) || a.title.localeCompare(b.title));
}
