import { z } from 'zod';

/**
 * The extension's `REACT_APP_EXT_BIM_*` keys. `MODELS_DIRECTORY` overrides
 * the host's models folder, and an empty value is refused instead of read as
 * the library root. `STALE_AFTER_S` is how old a reading may be, in seconds,
 * before the page stops counting it as current. It arrives as text from
 * `env.js`, so it is read as a number. Zero or a negative number is
 * refused, since either would mark every reading stale.
 */
const configSchema = z.object({
  modelsDirectory: z.string().min(1).optional(),
  staleAfterS: z.coerce.number().positive().finite().optional(),
});

export type BimConfig = z.infer<typeof configSchema>;
export default configSchema;
