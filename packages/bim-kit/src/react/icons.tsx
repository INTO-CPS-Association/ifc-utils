/**
 * The icon each shortcut is drawn with.
 *
 * The shortcut table names an icon and draws nothing, because it has to run where there is no React. This is the only place that turns a name into a picture, and it uses the host's own icon set so the toolbar looks like the rest of the application instead of like a second design language pasted into it.
 *
 * A name with no icon here falls back to a neutral one instead of rendering nothing, so a shortcut added to the table is usable before anyone chooses a picture for it.
 */

import type { ReactElement } from 'react';
import BlurOnIcon from '@mui/icons-material/BlurOn';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
// `HelpOutline` was removed in @mui/icons-material 9. `HelpOutlined` is the
// same question mark in the same outlined weight, under the name that
// survived. Importing the old one leaves the host's bundler emitting a
// module it cannot resolve, which fails at runtime and not at build time.
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined';
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
import FilterCenterFocusIcon from '@mui/icons-material/FilterCenterFocus';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import GridOnIcon from '@mui/icons-material/GridOn';
import StraightenIcon from '@mui/icons-material/Straighten';
import CenterFocusWeakIcon from '@mui/icons-material/CenterFocusWeak';
import ViewQuiltIcon from '@mui/icons-material/ViewQuilt';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import VerticalSplitIcon from '@mui/icons-material/VerticalSplit';
import RemoveIcon from '@mui/icons-material/Remove';
import AddIcon from '@mui/icons-material/Add';
import PaletteIcon from '@mui/icons-material/Palette';
import WallpaperIcon from '@mui/icons-material/Wallpaper';

const ICONS: Record<string, ReactElement> = {
  heatmap: <ThermostatIcon fontSize="small" />,
  transparency: <OpacityIcon fontSize="small" />,
  slabs: <LayersClearIcon fontSize="small" />,
  section: <ContentCutIcon fontSize="small" />,
  grid: <GridOnIcon fontSize="small" />,
  isolate: <CenterFocusWeakIcon fontSize="small" />,
  measure: <StraightenIcon fontSize="small" />,
  parallel: <ViewQuiltIcon fontSize="small" />,
  shadows: <WbSunnyIcon fontSize="small" />,
  vertical: <VerticalSplitIcon fontSize="small" />,
  cutBack: <RemoveIcon fontSize="small" />,
  cutForward: <AddIcon fontSize="small" />,
  style: <PaletteIcon fontSize="small" />,
  backdrop: <WallpaperIcon fontSize="small" />,
  hover: <HighlightAltIcon fontSize="small" />,
  hide: <VisibilityOffIcon fontSize="small" />,
  restore: <UndoIcon fontSize="small" />,
  top: <VerticalAlignTopIcon fontSize="small" />,
  front: <CropSquareIcon fontSize="small" />,
  side: <BlurOnIcon fontSize="small" />,
  fit: <CenterFocusStrongIcon fontSize="small" />,
  focus: <FilterCenterFocusIcon fontSize="small" />,
  reset: <RestartAltIcon fontSize="small" />,
  fullscreen: <FullscreenIcon fontSize="small" />,
  help: <HelpOutlineIcon fontSize="small" />,
};

export function iconFor(name: string): ReactElement {
  return ICONS[name] ?? <ViewInArIcon fontSize="small" />;
}
