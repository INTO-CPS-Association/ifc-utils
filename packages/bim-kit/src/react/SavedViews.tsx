/**
 * Saving a view and going back to it.
 *
 * A list of the views saved for this model, a button that saves the view on
 * screen and one that deletes the view chosen. Choosing a view in the list
 * flies there.
 */

import { useState } from 'react';
import { Box, IconButton, MenuItem, TextField, Tooltip } from '@mui/material';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import type { SavedView } from '../viewer/savedViews.js';

export interface SavedViewsProps {
  views: SavedView[];
  onSave: () => void;
  onShow: (view: SavedView) => void;
  onRemove: (name: string) => void;
}

/** The value the select uses before a view is chosen, since a select cannot hold null. */
const NONE = '';

export function SavedViews({ views, onSave, onShow, onRemove }: Readonly<SavedViewsProps>) {
  const [chosen, setChosen] = useState(NONE);
  const exists = views.some((view) => view.name === chosen);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
      <TextField
        select
        size="small"
        label="Saved Views"
        value={exists ? chosen : NONE}
        disabled={views.length === 0}
        onChange={(event) => {
          setChosen(event.target.value);
          const view = views.find((saved) => saved.name === event.target.value);
          if (view) onShow(view);
        }}
        slotProps={{
          select: {
            displayEmpty: true,
            renderValue: (value: unknown) => (value === NONE
              ? (views.length === 0 ? 'None Yet' : 'Choose A View')
              : String(value)),
          },
          inputLabel: { shrink: true },
        }}
        sx={{ minWidth: 170 }}
      >
        {views.map((view) => (
          <MenuItem key={view.name} value={view.name}>{view.name}</MenuItem>
        ))}
      </TextField>
      <Tooltip title="Save This View">
        <IconButton size="small" aria-label="Save This View" onClick={onSave}>
          <BookmarkAddIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Delete The Chosen View">
        <span>
          <IconButton
            size="small"
            aria-label="Delete The Chosen View"
            disabled={!exists}
            onClick={() => { onRemove(chosen); setChosen(NONE); }}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}

export default SavedViews;
