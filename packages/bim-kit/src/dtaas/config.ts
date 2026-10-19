import { z } from 'zod';

/**
 * The extension's `REACT_APP_EXT_BIM_*` keys. `MODELS_DIRECTORY` overrides
 * the host's models folder, and an empty value is refused instead of read as
 * the library root.
 */
const configSchema = z.object({
  modelsDirectory: z.string().min(1).optional(),
});

export type BimConfig = z.infer<typeof configSchema>;
export default configSchema;
