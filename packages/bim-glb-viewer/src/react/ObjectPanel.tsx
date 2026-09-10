/**
 * What the selected object is.
 *
 * The point of binding a sensor to a model element is that clicking the element says what it is. Without this a viewer is a picture: a person can see a wall is coloured and cannot find out which wall.
 *
 * Everything drawn here comes from the model or from a manifest, and both are untrusted input as far as this is concerned. React escapes text by default and nothing here uses `dangerouslySetInnerHTML`.
 */

import { Box, Chip, Paper, Stack, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import { displayOf, idOf, topicOf, type Binding } from '../binding.js';
import type { ObjectFacts } from '../viewer/index.js';

export interface ObjectPanelProps {
  globalId: string | null;
  facts: ObjectFacts | undefined;
  /** The binding attached to this object, when one is. */
  binding: Binding | undefined;
  /** The property sets the model carries for it, when the tree has them. */
  properties?: Record<string, Record<string, unknown>>;
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
  globalId, facts, binding, properties,
}: Readonly<ObjectPanelProps>) {
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
            <Row name="IFC Class" value={facts?.ifcClass} />
            <Row name="Global ID" value={globalId} />
            <Row name="Storey" value={facts?.storey} />
            <Row name="Room" value={facts?.room} />
            {binding && <Row name="Sensor" value={idOf(binding)} />}
            {binding && <Row name="Unit" value={displayOf(binding).unit} />}
            {binding && <Row name="MQTT Topic" value={topicOf(binding)} />}
          </TableBody>
        </Table>
      </Paper>

      {properties && Object.entries(properties).map(([setName, values]) => (
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
  );
}

export default ObjectPanel;
