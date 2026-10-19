/**
 * Choosing which folder of the library holds the models.
 *
 * The folder is never assumed: it is whatever the host passes in as `value`,
 * and this is how a person changes it without editing a URL by hand.
 * Browsing stays inside the library: `list` is the only way out to the host,
 * so this component never guesses a path of its own.
 */

import { useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
} from '@mui/material';
import type { LibraryEntry } from './assets.js';
import { useFolderListing } from './useFolderListing.js';

export interface DirectoryPickerProps {
  /** Lists one folder of the library. Only entries with `type: 'directory'` are offered. */
  list(path: string): Promise<LibraryEntry[]>;
  /** The folder in use. */
  value: string;
  onChange(path: string): void;
}

/** The parent of a path, or the library root for a path already at the top. */
function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

interface FolderListProps {
  browsing: string;
  folders: LibraryEntry[];
  onEnter: (path: string) => void;
}

function FolderList({ browsing, folders, onEnter }: Readonly<FolderListProps>) {
  return (
    <List>
      {browsing !== '' && (
        <ListItemButton onClick={() => onEnter(parentOf(browsing))}>
          <ListItemText primary="Up" />
        </ListItemButton>
      )}
      {folders.map((folder) => (
        <ListItemButton key={folder.path} onClick={() => onEnter(folder.path)}>
          <ListItemText primary={folder.name} />
        </ListItemButton>
      ))}
    </List>
  );
}

interface BrowseDialogProps {
  open: boolean;
  browsing: string;
  folders: LibraryEntry[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onEnter: (path: string) => void;
  onUse: () => void;
}

function BrowseDialog(props: Readonly<BrowseDialogProps>) {
  const { open, browsing, folders, loading, error, onClose, onEnter, onUse } = props;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Choose a Folder</DialogTitle>
      <DialogContent>
        <FolderList browsing={browsing} folders={folders} onEnter={onEnter} />
        {loading && <CircularProgress size={24} />}
        {error && <Alert severity="error">{`Could not list ${browsing}: ${error}`}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button disabled={browsing === '' || loading} onClick={onUse}>
          Use This Folder
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Which folder is open for browsing, starting again at `value` every time the dialog opens. */
function useBrowsing(value: string) {
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState(value);
  const openDialog = () => {
    setBrowsing(value);
    setOpen(true);
  };
  const closeDialog = () => setOpen(false);
  return { open, browsing, setBrowsing, openDialog, closeDialog };
}

/** Everything the picker needs: what is on screen, and what each action does. */
function useDirectoryPicker({ list, value, onChange }: Readonly<DirectoryPickerProps>) {
  const browse = useBrowsing(value);
  const { entries, loading, error } = useFolderListing(list, browse.open ? browse.browsing : null);
  const folders = entries.filter((entry) => entry.type === 'directory');
  const use = () => {
    onChange(browse.browsing);
    browse.closeDialog();
  };
  return { ...browse, folders, loading, error, use };
}

export function DirectoryPicker(props: Readonly<DirectoryPickerProps>) {
  const picker = useDirectoryPicker(props);
  return (
    <>
      <Button variant="outlined" onClick={picker.openDialog}>
        {`Folder: ${props.value}`}
      </Button>
      <BrowseDialog
        open={picker.open}
        browsing={picker.browsing}
        folders={picker.folders}
        loading={picker.loading}
        error={picker.error}
        onClose={picker.closeDialog}
        onEnter={picker.setBrowsing}
        onUse={picker.use}
      />
    </>
  );
}

export default DirectoryPicker;
