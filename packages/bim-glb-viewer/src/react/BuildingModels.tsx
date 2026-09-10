/**
 * The building models page.
 *
 * A person uploads an IFC file to the shared library and it lands in the
 * workspace at `common/models`. This lists what is there and draws it.
 *
 * An IFC file cannot be drawn as it stands. It is a text exchange format
 * holding parametric solids, and turning those into triangles needs a geometry
 * kernel. Conversion leaves a GLB beside the source, so a model here is in one
 * of two states, and the page says which rather than showing an empty canvas.
 *
 * What the host supplies
 * ----------------------
 * Nothing in this file imports anything from the application that mounts it.
 * That is deliberate and it is the whole reason this lives in a package rather
 * than in the DTaaS repository: the host passes in the one thing only it
 * knows, the URL of the user's library, and everything else, including every
 * later improvement to this page, arrives as a version of this package.
 *
 * The host keeps its own layout, its own route guard and its own auth. Those
 * are its concerns and a plugin has no business owning them.
 */

import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Typography,
} from '@mui/material';
import type { Binding } from '../binding.js';
import {
  MODELS_DIRECTORY,
  contentsUrl,
  fileUrl,
  formatSize,
  pairModels,
  type BimModel,
  type LibraryEntry,
} from './assets.js';

// Loaded only when a model is opened, so three.js stays out of the host's main
// chunk. The host already gates bundle size, and a non-lazy three.js import
// shows up there immediately.
const BimCanvas = lazy(() => import('./BimCanvas.js'));

const CONVERTS_HERE =
  'No converted geometry sits beside this model, so it is read from the IFC '
  + 'file in your browser. That takes a moment the first time.';

function ModelList({
  models,
  chosen,
  onChoose,
}: Readonly<{
  models: BimModel[];
  chosen: BimModel | null;
  onChoose: (model: BimModel) => void;
}>) {
  return (
    <List dense>
      {models.map((model) => (
        <ListItemButton
          key={model.ifcPath}
          selected={chosen?.ifcPath === model.ifcPath}
          onClick={() => onChoose(model)}
        >
          <ListItemText primary={model.name} secondary={formatSize(model.sizeBytes)} />
          <Chip
            size="small"
            label={model.geometryPath ? 'Converted' : 'From IFC'}
            color={model.geometryPath ? 'success' : 'default'}
            variant={model.geometryPath ? 'filled' : 'outlined'}
          />
        </ListItemButton>
      ))}
    </List>
  );
}

export interface BuildingModelsProps {
  /**
   * Where the user's library is served from, ending in the user name, as in
   * `https://host/jane/`. The host knows this and the package cannot.
   */
  libraryUrl: string;
  /** Which directory under the library holds the models. */
  directory?: string;
}

export function BuildingModels({
  libraryUrl,
  directory = MODELS_DIRECTORY,
}: Readonly<BuildingModelsProps>) {
  const [models, setModels] = useState<BimModel[] | null>(null);
  const [chosen, setChosen] = useState<BimModel | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [bindings, setBindings] = useState<Binding[]>([]);

  useEffect(() => {
    if (!libraryUrl) return undefined;
    let current = true;

    fetch(contentsUrl(libraryUrl, directory), { credentials: 'include' })
      .then((response) => {
        if (!response.ok) throw new Error(`the library returned HTTP ${response.status}`);
        return response.json();
      })
      .then((listing: { content?: LibraryEntry[] }) => {
        if (current) setModels(pairModels(listing.content ?? []));
      })
      .catch((error: Error) => {
        if (!current) return;
        setProblem(`The list of models could not be read: ${error.message}`);
        setModels([]);
      });

    return () => {
      current = false;
    };
  }, [libraryUrl, directory]);

  // The manifest beside the model, when there is one. Most models declare no
  // sensors at all, and an empty list is the honest answer for those rather
  // than a failed request.
  useEffect(() => {
    setBindings([]);
    setNote(null);
    if (!chosen?.manifestPath || !libraryUrl) return undefined;
    let current = true;

    fetch(fileUrl(libraryUrl, chosen.manifestPath), { credentials: 'include' })
      .then((response) => {
        if (!response.ok) throw new Error(`the library returned HTTP ${response.status}`);
        return response.json();
      })
      .then((manifest: { bindings?: Binding[] }) => {
        if (current) setBindings(manifest.bindings ?? []);
      })
      .catch((error: Error) => {
        if (current) setProblem(`The manifest could not be read: ${error.message}`);
      });

    return () => {
      current = false;
    };
  }, [chosen, libraryUrl]);

  const onReport = useCallback((message: string) => setNote(message), []);

  return (
    <Box sx={{
      // `minWidth: 0` is what stops a flex child growing to fit its contents.
      // Without it a wide canvas pushes the whole page sideways.
      width: '100%', minWidth: 0, flexGrow: 1, p: 3, overflowX: 'hidden',
    }}
    >
      <Typography variant="h5" sx={{ mb: 1 }}>
        Building Models
      </Typography>
      <Typography variant="body1" sx={{ mb: 2 }}>
        Models uploaded to the shared library under <code>{directory}</code>.
        Upload one on the Library page.
      </Typography>

      {problem && <Alert severity="error" sx={{ mb: 2 }}>{problem}</Alert>}

      <Paper sx={{ p: 2, mb: 2 }}>
        {models === null && <CircularProgress size={24} />}
        {models?.length === 0 && (
          <Typography variant="body2">
            No IFC file is in the shared library yet.
          </Typography>
        )}
        {models !== null && models.length > 0 && (
          <ModelList models={models} chosen={chosen} onChoose={setChosen} />
        )}
      </Paper>

      {chosen && !chosen.geometryPath && (
        <Alert severity="info" sx={{ mb: 2 }}>{CONVERTS_HERE}</Alert>
      )}

      {note && <Alert severity="info" sx={{ mb: 2 }}>{note}</Alert>}

      {chosen && (
        <Paper sx={{ p: 1 }}>
          <Suspense fallback={<CircularProgress sx={{ m: 4 }} />}>
            <BimCanvas
              key={chosen.geometryPath ?? chosen.ifcPath}
              url={fileUrl(libraryUrl, chosen.geometryPath ?? chosen.ifcPath)}
              convert={!chosen.geometryPath}
              bindings={bindings}
              onReport={onReport}
            />
          </Suspense>
        </Paper>
      )}
    </Box>
  );
}

export default BuildingModels;
