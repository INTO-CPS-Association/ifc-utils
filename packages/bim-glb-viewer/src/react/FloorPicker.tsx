/**
 * Choosing a floor.
 *
 * One entry per distinct band, not per storey name. A model can name one floor several times, and listing every name offers twenty six choices that show eight different things.
 *
 * The arrows exist because stepping through floors is how a person reads a building, and a dropdown makes that three clicks per floor.
 */

import { Box, IconButton, MenuItem, TextField, Tooltip } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';

export interface FloorPickerProps {
  /** The floors, lowest first. Empty when the model declares none. */
  storeys: string[];
  /** The floor in force, or null for all of them. */
  current: string | null;
  onChange: (storey: string | null) => void;
}

/** The value the select uses for "no floor chosen", since a select cannot hold null. */
const ALL = '';

export function FloorPicker({ storeys, current, onChange }: Readonly<FloorPickerProps>) {
  if (storeys.length === 0) return null;

  const at = current === null ? -1 : storeys.indexOf(current);
  const step = (by: number) => {
    // From All Floors, up goes to the lowest and down to the highest, which is
    // what a person means by "start stepping".
    const next = at === -1 ? (by > 0 ? 0 : storeys.length - 1) : at + by;
    if (next >= 0 && next < storeys.length) onChange(storeys[next]);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
      <TextField
        select
        size="small"
        label="Floor"
        value={current ?? ALL}
        onChange={(event) => onChange(event.target.value === ALL ? null : event.target.value)}
        // Two settings that go together. `displayEmpty` is what makes the
        // control show All Floors instead of nothing, since that choice is the
        // empty string. It also stops the label floating on its own, so the
        // label has to be told to stay shrunk, otherwise "Floor" is drawn on
        // top of "All Floors" and the two words overlap.
        slotProps={{
          select: {
            displayEmpty: true,
            renderValue: (value: unknown) => (value === ALL ? 'All Floors' : String(value)),
          },
          inputLabel: { shrink: true },
        }}
        sx={{ minWidth: 180 }}
      >
        <MenuItem value={ALL}>All Floors</MenuItem>
        {storeys.map((storey) => (
          <MenuItem key={storey} value={storey}>{storey}</MenuItem>
        ))}
      </TextField>
      <Tooltip title="The floor above">
        <span>
          <IconButton
            size="small"
            aria-label="The floor above"
            disabled={at === storeys.length - 1}
            onClick={() => step(1)}
          >
            <KeyboardArrowUpIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="The floor below">
        <span>
          <IconButton
            size="small"
            aria-label="The floor below"
            disabled={at === 0}
            onClick={() => step(-1)}
          >
            <KeyboardArrowDownIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}

export default FloorPicker;
