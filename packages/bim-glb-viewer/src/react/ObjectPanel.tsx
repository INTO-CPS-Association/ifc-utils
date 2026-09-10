/**
 * What the selected object is.
 *
 * The point of binding a sensor to a model element is that clicking the element says what it is. Without this a viewer is a picture: a person can see a wall is coloured and cannot find out which wall.
 *
 * Everything drawn here comes from the model or from a manifest, and both are untrusted input as far as this is concerned. React escapes text by default and nothing here uses `dangerouslySetInnerHTML`.
 */

import { useState } from 'react';
import {
  Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton, Paper, Stack,
  Table, TableBody, TableCell, TableRow, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { displayOf, idOf, topicOf, type Binding } from '../binding.js';
import type { ObjectFacts } from '../viewer/index.js';

export interface ObjectPanelProps {
  globalId: string | null;
  facts: ObjectFacts | undefined;
  /** The binding attached to this object, when one is. */
  binding: Binding | undefined;
  /**
   * The property sets the model carries for it, when the tree has them.
   *
   * These are everything the authoring tool exported, and there is a lot of
   * it. One interior wall of the NTU model carries around sixty fields across
   * twelve sets: its family and type, its construction and wrapping, its
   * fire and acoustic marks, its thermal transmittance, absorptance, thermal
   * mass and resistance, its area, length and volume, the level it starts at
   * and the one it runs up to, its phase, its structural usage, and the
   * standard IFC sets such as Pset_WallCommon.
   *
   * All of it is kept and none of it is thrown away, because a person asking
   * about a wall's U-value has nowhere else to look. It is behind a button
   * rather than on the panel because sixty rows under a click is not an
   * answer, it is a haystack.
   */
  properties?: Record<string, Record<string, unknown>>;
  /** Its extent in metres along each world axis, measured from the geometry. */
  size?: { x: number; y: number; z: number };
}

/**
 * A size in metres, or in millimetres when metres would read as zero.
 *
 * A door handle 40 mm across is "0.0 m" at one decimal, which says nothing.
 * Switching unit under a threshold keeps every object legible without giving
 * a wall a precision the model does not have.
 */
function metres(size: { x: number; y: number; z: number }): string {
  const parts = [size.x, size.y, size.z];
  if (Math.max(...parts) < 0.5) {
    return `${parts.map((n) => Math.round(n * 1000)).join(' × ')} mm`;
  }
  return `${parts.map((n) => n.toFixed(2)).join(' × ')} m`;
}

/** A row of the table, skipped when there is nothing to say. */
function Row({ name, value }: Readonly<{ name: string; value: unknown }>) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <TableRow>
      <TableCell sx={{ width: 160, color: 'text.secondary', border: 0, py: 0.3 }}>
        {name}
      </TableCell>
      <TableCell sx={{ border: 0, py: 0.3, wordBreak: 'break-word' }}>
        {String(value)}
      </TableCell>
    </TableRow>
  );
}

export function ObjectPanel({
  globalId, facts, binding, properties, size,
}: Readonly<ObjectPanelProps>) {
  const [open, setOpen] = useState(false);
  const sets = Object.entries(properties ?? {});

  if (!globalId) {
    return (
      <Typography variant="body2" color="text.secondary">
        Click an object to see what it is.
      </Typography>
    );
  }

  return (
    <Stack spacing={1}>
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Table size="small">
          <TableBody>
            <Row name="Name" value={facts?.name} />
            <Row name="IFC Class" value={facts?.ifcClass} />
            {/* IFC writes NOTDEFINED when the exporter said nothing, which is
                not a type and is worth no row. */}
            <Row
              name="Predefined Type"
              value={facts?.predefinedType === 'NOTDEFINED' ? undefined : facts?.predefinedType}
            />
            <Row name="Storey" value={facts?.storey} />
            <Row name="Room" value={facts?.room} />
            <Row name="Hosted In" value={facts?.host} />
            {/* Width by height by depth of the axis aligned box around it, so a
                person can check a wall against the one in front of them. */}
            <Row name="Size" value={size ? metres(size) : undefined} />
            <Row name="Global ID" value={globalId} />
            {binding && <Row name="Sensor" value={idOf(binding)} />}
            {binding && <Row name="Unit" value={displayOf(binding).unit} />}
            {binding && <Row name="MQTT Topic" value={topicOf(binding)} />}
          </TableBody>
        </Table>
      </Paper>

      {sets.length > 0 && (
        <Box>
          <Button size="small" variant="outlined" onClick={() => setOpen(true)}>
            Properties
          </Button>
        </Box>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md" scroll="paper">
        <DialogTitle sx={{ pr: 6 }}>
          {facts?.name ?? facts?.ifcClass ?? 'Properties'}
          <IconButton
            aria-label="Close"
            onClick={() => setOpen(false)}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1}>
            {sets.map(([setName, values]) => (
              <Paper key={setName} variant="outlined" sx={{ p: 1.5 }}>
                <Box sx={{ mb: 0.5 }}>
                  <Chip size="small" label={setName} />
                </Box>
                <Table size="small">
                  <TableBody>
                    {Object.entries(values).map(([key, value]) => (
                      <Row key={key} name={key} value={value} />
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            ))}
          </Stack>
        </DialogContent>
      </Dialog>
    </Stack>
  );
}

export default ObjectPanel;
