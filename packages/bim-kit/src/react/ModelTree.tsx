/**
 * The objects of the model, by floor or by class, with a search.
 *
 * Clicking an object picks it and flies to it, the way a sensor card does.
 * A long list is cut at a few hundred rows and says so, because a model of
 * ten thousand objects would otherwise fill the page.
 */

import { useDeferredValue, useMemo, useState } from 'react';
import {
  Box, List, ListItemButton, ListItemText, ListSubheader, TextField, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material';
import { groupEntries, readableClass, type GroupBy, type TreeEntry } from '../viewer/modelTree.js';

export interface ModelTreeProps {
  entries: TreeEntry[];
  /** The floors, lowest first, so the floor groups follow the building. */
  floors: string[];
  selected: string | null;
  onPick: (globalId: string) => void;
}

/** The most rows drawn at once. */
export const MAX_ROWS = 300;

export function ModelTree({ entries, floors, selected, onPick }: Readonly<ModelTreeProps>) {
  const [by, setBy] = useState<GroupBy>('storey');
  const [query, setQuery] = useState('');
  // The search runs on the deferred query, so typing stays quick on a model
  // of tens of thousands of objects while the list catches up.
  const search = useDeferredValue(query);
  const groups = useMemo(() => groupEntries(entries, by, search, floors), [entries, by, search, floors]);
  const found = groups.reduce((total, group) => total + group.entries.length, 0);
  let budget = MAX_ROWS;

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: '1 1 auto' }}>Model</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={by}
          onChange={(_event, value: GroupBy | null) => { if (value) setBy(value); }}
          aria-label="Group The Objects"
        >
          {/* Title Case as written: the theme's default turns button text into capitals. */}
          <ToggleButton value="storey" sx={{ textTransform: 'none' }}>By Floor</ToggleButton>
          <ToggleButton value="class" sx={{ textTransform: 'none' }}>By Class</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <TextField
        size="small"
        fullWidth
        label="Find Objects"
        placeholder="Name, class, GlobalId or property value"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        sx={{ mb: 1 }}
      />
      <Typography variant="caption" color="text.secondary">
        {found === entries.length ? `${found} objects` : `${found} of ${entries.length} objects`}
        {found > MAX_ROWS ? `, the first ${MAX_ROWS} shown` : ''}
      </Typography>
      <List dense sx={{ maxHeight: 360, overflow: 'auto' }} subheader={<li />}>
        {groups.map((group) => {
          const rows = group.entries.slice(0, Math.max(0, budget));
          budget -= rows.length;
          if (rows.length === 0) return null;
          return (
            <li key={group.title}>
              <ul style={{ padding: 0 }}>
                <ListSubheader sx={{ lineHeight: '32px' }}>
                  {group.title} ({group.entries.length})
                </ListSubheader>
                {rows.map((entry) => (
                  <ListItemButton
                    key={entry.globalId}
                    selected={entry.globalId === selected}
                    onClick={() => onPick(entry.globalId)}
                  >
                    <ListItemText
                      primary={entry.name}
                      secondary={by === 'storey' ? readableClass(entry.ifcClass) : entry.storey ?? undefined}
                    />
                  </ListItemButton>
                ))}
              </ul>
            </li>
          );
        })}
      </List>
    </Box>
  );
}

export default ModelTree;
