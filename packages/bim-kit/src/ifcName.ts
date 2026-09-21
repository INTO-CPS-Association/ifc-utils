/**
 * The name of the building an IFC file holds, read from the file itself.
 *
 * An IFC file is text, ISO 10303-21, and names its project and its building
 * near the top: in every model this was written against, both sit within the
 * first 6 KB, including a 64 MB one. So the name is read from the start of the
 * file and the rest of it is never fetched.
 *
 * Where the name is
 * -----------------
 * On the project's LongName, first. Across the real models that is where the
 * name was, and the building's own name was empty, template text, or once
 * misspelt: `Building_1911_AK_v2` is "Pædagogisk Center" on its project and
 * "Pædagosik Center" on its building. So the order is the project's LongName,
 * the project's Name, the building's LongName, the building's Name.
 *
 * Most files carry no name. A Revit export that nobody filled in keeps the
 * template text, and the project's Name is often a job number such as 34372.
 * Neither is a building name, so both are skipped.
 *
 * Nothing here knows any building. The name is whatever the file says.
 */

/** How much of the file is read, which is ten times the furthest name found. */
export const IFC_HEAD_BYTES = 64 * 1024;

// Text an authoring tool writes into a new file and nobody replaced.
const PLACEHOLDERS = new Set([
  'project name',
  'project number',
  'project status',
  'building name',
  'default',
  'site',
]);

// Only digits and separators: a job or project number, not a name.
const IDENTIFIER = /^[\d\s./_-]+$/;

// Positions of the attributes read, counted from zero, the same in IFC2X3 and
// IFC4 for these two entities.
const PROJECT = { name: 2, longName: 5 };
const BUILDING = { name: 2, longName: 7 };

/** The value as a name, or null when it is empty, a placeholder or a number. */
export function usableName(value: string | null): string | null {
  if (value === null) return null;
  const text = value.trim();
  if (!text || PLACEHOLDERS.has(text.toLowerCase()) || IDENTIFIER.test(text)) {
    return null;
  }
  return text;
}

/**
 * A STEP string as the text it stands for.
 *
 * ISO 10303-21 keeps a file in seven bit ASCII and spells everything else as an
 * escape. Two appear in the real models: `\X\E6` is one ISO 8859-1 byte, æ, and
 * `\X2\00D8\X0\` is UTF-16, Ø. A quote is doubled and a backslash is doubled.
 */
export function decodeStepString(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const char = raw[i];

    if (char === "'" && raw[i + 1] === "'") {
      out += "'";
      i += 2;
      continue;
    }
    if (char !== '\\') {
      out += char;
      i += 1;
      continue;
    }

    if (raw.startsWith('\\\\', i)) {
      out += '\\';
      i += 2;
    } else if (raw.startsWith('\\X2\\', i) || raw.startsWith('\\X4\\', i)) {
      // A run of UTF-16 code units, or of UTF-32 code points, closed by \X0\.
      const width = raw[i + 2] === '2' ? 4 : 8;
      const end = raw.indexOf('\\X0\\', i + 4);
      if (end === -1) break;
      const hex = raw.slice(i + 4, end);
      const units: number[] = [];
      for (let k = 0; k + width <= hex.length; k += width) {
        units.push(parseInt(hex.slice(k, k + width), 16));
      }
      out += width === 4
        ? String.fromCharCode(...units)
        : String.fromCodePoint(...units);
      i = end + 4;
    } else if (raw.startsWith('\\X\\', i)) {
      out += String.fromCharCode(parseInt(raw.slice(i + 3, i + 5), 16));
      i += 5;
    } else if (raw.startsWith('\\S\\', i)) {
      // The upper half of the current code page, which is ISO 8859-1 unless a
      // \P?\ switch says otherwise.
      out += String.fromCharCode(raw.charCodeAt(i + 3) + 128);
      i += 4;
    } else if (/^\\P[A-I]\\/.test(raw.slice(i, i + 4))) {
      // A code page switch. The pages are all ISO 8859 and the files read here
      // use the default one, so the switch itself carries no character.
      i += 4;
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

/**
 * The arguments of the first entity of a type, as written, or null.
 *
 * Split on the commas at the top level, so a list such as `(#22)` and a string
 * holding a comma each stay one argument.
 */
export function entityArguments(text: string, entity: string): string[] | null {
  const start = new RegExp(`=\\s*${entity}\\s*\\(`, 'i').exec(text);
  if (!start) return null;

  const args: string[] = [];
  let depth = 0;
  let inString = false;
  let current = '';
  for (let i = start.index + start[0].length; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      current += char;
      if (char === "'") {
        // A doubled quote is a quote inside the string, not its end.
        if (text[i + 1] === "'") {
          current += "'";
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (char === "'") {
      inString = true;
      current += char;
    } else if (char === '(') {
      depth += 1;
      current += char;
    } else if (char === ')') {
      if (depth === 0) {
        args.push(current.trim());
        return args;
      }
      depth -= 1;
      current += char;
    } else if (char === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  // The statement ran past what was read, so nothing in it can be trusted.
  return null;
}

/** An argument as text when it is a string, or null for $, * and references. */
function stringArgument(arg: string | undefined): string | null {
  if (!arg || arg.length < 2 || !arg.startsWith("'") || !arg.endsWith("'")) {
    return null;
  }
  return decodeStepString(arg.slice(1, -1));
}

/** The name the file gives its building, or null when it gives none. */
export function ifcBuildingName(text: string): string | null {
  const project = entityArguments(text, 'IFCPROJECT') ?? [];
  const building = entityArguments(text, 'IFCBUILDING') ?? [];
  const candidates = [
    project[PROJECT.longName],
    project[PROJECT.name],
    building[BUILDING.longName],
    building[BUILDING.name],
  ];
  for (const candidate of candidates) {
    const name = usableName(stringArgument(candidate));
    if (name) return name;
  }
  return null;
}
