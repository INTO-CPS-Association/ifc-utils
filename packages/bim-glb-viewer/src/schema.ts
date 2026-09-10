/**
 * The binding manifest, as a schema.
 *
 * This is step 1 of the sequence DTaaS issue 1762 proposes, and it comes
 * first for the reason the issue gives: the manifest is the load-bearing
 * piece, and if its schema is right the conversion, the viewer and the
 * transport can each be replaced without touching the others.
 *
 * Nothing here renders anything or imports three.js. That is deliberate. The
 * client's unit tests run in jsdom, where WebGL, workers and WASM do not
 * exist, so anything that can be tested without a canvas is kept where it can
 * be.
 *
 * A manifest is written by a person and will frequently be wrong. The errors
 * this produces name the binding and the field, because "invalid manifest" on
 * a file with forty bindings is not a message anyone can act on.
 */

import { z } from 'zod';

/** An IFC GlobalId: 22 characters of the base64 variant IFC uses. */
const GlobalId = z
  .string()
  .regex(
    /^[0-9A-Za-z_$]{22}$/,
    'a GlobalId is 22 characters of digits, letters, underscore and dollar',
  );

/**
 * How a binding names the thing it applies to.
 *
 * A union rather than a bare string, as the issue asks, so a non-IFC asset
 * can reuse this manifest instead of needing a second schema. Exactly one
 * form must be given: two would leave the resolver choosing, and a manifest
 * should not depend on which it chose.
 */
export const SelectorSchema = z
  .object({
    globalId: GlobalId.optional(),
    nodeName: z.string().min(1).optional(),
    expressId: z.number().int().positive().optional(),
  })
  .refine(
    (selector) =>
      [selector.globalId, selector.nodeName, selector.expressId].filter(
        (value) => value !== undefined,
      ).length === 1,
    { message: 'give exactly one of globalId, nodeName or expressId' },
  );

/**
 * Where a value comes from.
 *
 * `live` and `history` are separate on purpose, which is the issue's design
 * and worth keeping: MQTT supplies the current value on the marker, and the
 * time-series database supplies the panel behind a click. Charting is not
 * reimplemented inside the 3D view.
 */
export const SourceSchema = z.object({
  live: z
    .object({
      transport: z.literal('mqtt'),
      // No leading slash, no wildcard. A binding names one sensor, and a
      // wildcard here would silently bind a marker to whatever else matched.
      topic: z
        .string()
        .min(1)
        .refine((topic) => !topic.startsWith('/'), 'an MQTT topic does not start with /')
        .refine((topic) => !/[+#]/.test(topic), 'a binding names one topic, not a wildcard'),
    })
    .optional(),
  history: z
    .object({
      bucket: z.string().min(1),
      measurement: z.string().min(1),
      tags: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

/** How a value is drawn. */
export const DisplaySchema = z.object({
  unit: z.string().min(1),
  // Two numbers, low then high. Equal bounds would divide by zero in a colour
  // ramp, and reversed bounds would invert the meaning of every colour
  // without saying so.
  ramp: z
    .tuple([z.number(), z.number()])
    .refine(([low, high]) => low < high, 'ramp is [low, high] and low must be lower'),
});

export const BindingSchema = z.object({
  selector: SelectorSchema,
  label: z.string().min(1),
  source: SourceSchema,
  display: DisplaySchema,
});

/**
 * What a derived file records about where it came from.
 *
 * The issue asks for this and gives the reason: without provenance there is
 * no way to tell whether a stale artifact matches the current source. A
 * re-export keeps the file name and changes every GlobalId inside.
 */
export const ProvenanceSchema = z.object({
  source: z.string().min(1),
  source_sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$|^unknown$/, 'a SHA-256 is 64 hexadecimal characters'),
  converter: z.string().min(1),
  geometry: z.string().min(1).optional(),
  metadata: z.string().min(1).optional(),
  schema: z.string().optional(),
  metre_scale: z.number().positive().optional(),
  // Present and true when the placement is proposed rather than read from the
  // model. The viewer must say so: a reader who confuses the two believes the
  // building is instrumented when it is not.
  proposed: z.boolean().optional(),
  basis: z.string().optional(),
});

export const ManifestSchema = z.object({
  model: ProvenanceSchema,
  bindings: z.array(BindingSchema),
});

// The hand written types in `binding.ts` are the ones consumers use, so the
// inferred ones are not re-exported here: two names for one shape is how a
// schema and its consumers drift.
export type Manifest = z.infer<typeof ManifestSchema>;

export interface ManifestProblem {
  /** Where in the file, as a person would point at it. */
  where: string;
  message: string;
}

export type ManifestResult =
  | { ok: true; manifest: Manifest }
  | { ok: false; problems: ManifestProblem[] };

/**
 * Validate a manifest, reporting every problem rather than the first.
 *
 * `safeParse` rather than `parse`, matching how the client validates its own
 * settings, because a malformed manifest is a thing to report and not an
 * exception to escape from.
 *
 * Every problem names its location as `bindings[3].display.ramp` rather than
 * as a path array, because that is how a person reads a YAML file.
 */
export function readManifest(value: unknown): ManifestResult {
  const result = ManifestSchema.safeParse(value);
  if (result.success) return { ok: true, manifest: result.data };

  return {
    ok: false,
    problems: result.error.issues.map((issue) => ({
      where: issue.path.length === 0 ? 'the manifest' : formatPath(issue.path),
      message: issue.message,
    })),
  };
}

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((out, part) => {
    if (typeof part === 'number') return `${out}[${part}]`;
    return out === '' ? String(part) : `${out}.${String(part)}`;
  }, '');
}
