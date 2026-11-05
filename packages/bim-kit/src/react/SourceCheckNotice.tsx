/**
 * What the page says about the model file and its manifest.
 *
 * A mismatch is an alert, because the bindings were read from another file
 * and may point at the wrong objects or at none. A manifest that records no
 * hash gets a quiet line, since there is nothing to compare and nothing is
 * known to be wrong. A match says nothing and neither does a check still running.
 */

import { Alert, AlertTitle, Typography } from '@mui/material';
import type { SourceCheck } from '../sourceHash.js';

/** The first characters of a hash, enough for a person to compare two by eye. */
function short(hex: string): string {
  return hex.slice(0, 12);
}

export function SourceCheckNotice({ check }: Readonly<{ check: SourceCheck | null }>) {
  if (check === null) return null;
  if (check.state === 'mismatch') {
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        <AlertTitle>The model file is not the one the sensor manifest was written for.</AlertTitle>
        {`The manifest records a SHA-256 beginning ${short(check.expected)} and the IFC file `
          + `loaded has one beginning ${short(check.actual)}. A re-export changes the GlobalIds, `
          + 'so sensors may sit on the wrong objects or on none.'}
      </Alert>
    );
  }
  const quiet = check.state === 'unknown'
    ? 'The sensor manifest records no hash of its model, so the file was not compared with it.'
    : check.state === 'unchecked'
      ? `The model file was not compared with the sensor manifest: ${check.reason}.`
      : null;
  if (quiet === null) return null;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
      {quiet}
    </Typography>
  );
}

export default SourceCheckNotice;
