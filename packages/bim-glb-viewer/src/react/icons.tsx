/**
 * The icon each shortcut is drawn with.
 *
 * The shortcut table names an icon and draws nothing, because it has to run where there is no React. This is the only place that turns a name into a picture, and it uses the host's own icon set so the toolbar looks like the rest of the application rather than like a second design language pasted into it.
 *
 * A name with no icon here falls back to a neutral one instead of rendering nothing, so a shortcut added to the table is usable before anyone chooses a picture for it.
 */

import type { ReactElement } from 'react';
import BlurOnIcon from '@mui/icons-material/BlurOn';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';
import LayersClearIcon from '@mui/icons-material/LayersClear';
import OpacityIcon from '@mui/icons-material/Opacity';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import UndoIcon from '@mui/icons-material/Undo';
import ViewInArIcon from '@mui/icons-material/ViewInAr';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VerticalAlignTopIcon from '@mui/icons-material/VerticalAlignTop';
import CropSquareIcon from '@mui/icons-material/CropSquare';

const ICONS: Record<string, ReactElement> = {
  heatmap: <ThermostatIcon fontSize="small" />,
  transparency: <OpacityIcon fontSize="small" />,
  slabs: <LayersClearIcon fontSize="small" />,
  hover: <HighlightAltIcon fontSize="small" />,
  hide: <VisibilityOffIcon fontSize="small" />,
  restore: <UndoIcon fontSize="small" />,
  top: <VerticalAlignTopIcon fontSize="small" />,
  front: <CropSquareIcon fontSize="small" />,
  side: <BlurOnIcon fontSize="small" />,
  fit: <CenterFocusStrongIcon fontSize="small" />,
  reset: <RestartAltIcon fontSize="small" />,
  fullscreen: <FullscreenIcon fontSize="small" />,
  help: <HelpOutlineIcon fontSize="small" />,
};

export function iconFor(name: string): ReactElement {
  return ICONS[name] ?? <ViewInArIcon fontSize="small" />;
}
