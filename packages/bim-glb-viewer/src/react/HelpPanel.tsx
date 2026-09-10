/**
 * The list of shortcuts, written from the same table that binds them.
 *
 * A help page maintained by hand is a help page that lies, because it is the last thing anyone updates.
 */

import { Dialog, DialogContent, DialogTitle, Table, TableBody, TableCell, TableRow } from '@mui/material';
import { SHORTCUTS } from '../viewer/index.js';

export interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
}

export function HelpPanel({ open, onClose }: Readonly<HelpPanelProps>) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Shortcuts</DialogTitle>
      <DialogContent>
        <Table size="small">
          <TableBody>
            {SHORTCUTS.map((shortcut) => (
              <TableRow key={shortcut.key}>
                <TableCell sx={{ width: 48 }}>
                  <code>{shortcut.key}</code>
                </TableCell>
                <TableCell>{shortcut.label}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}

export default HelpPanel;
