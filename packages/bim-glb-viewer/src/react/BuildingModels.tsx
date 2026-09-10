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

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { displayOf, type Binding } from '../binding.js';
import { zonesOf, type FeedState, type Reading } from '../readings.js';
import { handleKey, type PropertyTree, type SceneView } from '../viewer/index.js';
import FloorPicker from './FloorPicker.js';
import HelpPanel from './HelpPanel.js';
import ObjectPanel from './ObjectPanel.js';
import SensorCards from './SensorCards.js';
import { ClassLegend, HeatLegend } from './Legend.js';
import Toolbar from './Toolbar.js';
import type { ViewerHandle } from './BimCanvas.js';
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
  /**
   * The last value received for each object, keyed by GlobalId.
   *
   * Pushed in rather than fetched, because this knows nothing about where a
   * reading came from: a broker, a database or a test all look the same here.
   */
  readings?: Map<string, Reading>;
  /** Whether the transport is connected, which no age can tell on its own. */
  feed?: FeedState;
}

/**
 * Read a response as JSON, or say what actually came back.
 *
 * The library URL a host supplies is built from parts, and one of those parts
 * is usually the signed-in user. Whenever that part is wrong, missing, or not
 * known yet, the request still succeeds: it stops matching the workspace and
 * lands on the host application, which answers with its own HTML page and
 * HTTP 200. `response.json()` then reports "Unexpected token '<'", which
 * blames JSON for an address that was never the library.
 *
 * Both failures seen so far were this: first a name that had not arrived yet,
 * then a deployment serving a workspace under a different name than the one
 * signed in. So the message names the address and states that cause, because
 * the alternative is reading a parser error and looking in the wrong place.
 */
async function readJson<T>(response: Response, url: string): Promise<T> {
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);

  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    throw new Error(
      `${url} returned a web page rather than data. That address is built from `
      + 'the signed-in user name, so the workspace is probably served under a '
      + 'different name than the one signed in.',
    );
  }
  return response.json() as Promise<T>;
}

export function BuildingModels({
  libraryUrl,
  directory = MODELS_DIRECTORY,
  readings = new Map(),
  feed = 'down',
}: Readonly<BuildingModelsProps>) {
  const [models, setModels] = useState<BimModel[] | null>(null);
  const [chosen, setChosen] = useState<BimModel | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [bindings, setBindings] = useState<Binding[]>([]);
  // A manifest a placement tool wrote marks itself proposed, so the page can
  // say so rather than presenting a guessed position as a survey.
  const [proposed, setProposed] = useState(false);
  const [tree, setTree] = useState<PropertyTree | null>(null);
  const [handle, setHandle] = useState<ViewerHandle | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  // Bumped after anything changes the scene, so the toolbar and the floor
  // picker redraw. The scene itself is not React state: it is a three.js graph
  // that would be ruinous to copy on every frame.
  const [revision, bump] = useState(0);
  const hovered = useRef<string | null>(null);
  // Notes a person has closed, held by their text rather than by a position.
  // Choosing another model produces a different sentence, which then shows
  // again, and choosing the same one back does not repeat what was dismissed.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const dismiss = (text: string) => setDismissed((seen) => new Set(seen).add(text));

  useEffect(() => {
    if (!libraryUrl) return undefined;
    let current = true;

    const url = contentsUrl(libraryUrl, directory);
    fetch(url, { credentials: 'include' })
      .then((response) => readJson<{ content?: LibraryEntry[] }>(response, url))
      .then((listing) => {
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

  /**
   * The property tree beside the model, when there is one.
   *
   * It is what says which storey and which room each object is in, so without
   * it the floor filter and the heatmap have nothing to group by. A model with
   * no tree still draws.
   */
  useEffect(() => {
    setTree(null);
    if (!chosen?.treePath || !libraryUrl) return undefined;
    let current = true;

    const url = fileUrl(libraryUrl, chosen.treePath);
    fetch(url, { credentials: 'include' })
      .then((response) => readJson<PropertyTree>(response, url))
      .then((loaded) => {
        if (current) setTree(loaded);
      })
      .catch(() => {
        // Not an error worth stopping for: the model draws without it, and the
        // page says less rather than nothing.
        if (current) setTree(null);
      });

    return () => {
      current = false;
    };
  }, [chosen, libraryUrl]);

  // The manifest beside the model, when there is one. Most models declare no
  // sensors at all, and an empty list is the honest answer for those rather
  // than a failed request.
  useEffect(() => {
    // Cleared first, so switching to a model with no manifest does not keep
    // showing the previous model's sensors.
    setBindings([]);
    setProposed(false);
    setNote(null);
    if (!chosen?.manifestPath || !libraryUrl) return undefined;
    let current = true;

    const url = fileUrl(libraryUrl, chosen.manifestPath);
    fetch(url, { credentials: 'include' })
      .then((response) => readJson<{ bindings?: Binding[]; model?: { proposed?: boolean } }>(response, url))
      .then((manifest) => {
        if (!current) return;
        setBindings(manifest.bindings ?? []);
        setProposed(manifest.model?.proposed === true);
      })
      .catch((error: Error) => {
        if (current) setProblem(`The manifest could not be read: ${error.message}`);
      });

    return () => {
      current = false;
    };
  }, [chosen, libraryUrl]);

  // The readings reach the scene here rather than inside it, so a burst of
  // messages is one repaint instead of one per message.
  useEffect(() => {
    if (!handle) return;
    handle.view.applyReadings(bindings, readings, feed);
    handle.view.refreshMaterials();
    bump((n) => n + 1);
  }, [handle, bindings, readings, feed]);

  const onReport = useCallback((message: string) => setNote(message), []);
  const onHover = useCallback((globalId: string | null) => { hovered.current = globalId; }, []);
  const onSelect = useCallback((globalId: string | null) => setSelected(globalId), []);
  const onReady = useCallback((ready: ViewerHandle) => {
    setHandle(ready);
    setSelected(null);
    bump((n) => n + 1);
  }, []);

  /** Everything a shortcut needs, gathered in one place so the keyboard and the toolbar drive the viewer through exactly the same path. */
  const shortcutContext = useCallback((view: SceneView) => ({
    view,
    refresh: () => { view.refresh(); bump((n) => n + 1); },
    frame: () => handle?.frame(),
    look: (from: 'top' | 'front' | 'side' | 'corner') => handle?.look(from),
    hovered: () => hovered.current,
    toggleHelp: () => setHelpOpen((open) => !open),
    toggleFullscreen: () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    },
  }), [handle]);

  // The keyboard reaches the viewer only while a model is open, so a page with
  // nothing loaded does not swallow keys that belong to the application.
  useEffect(() => {
    if (!handle) return undefined;
    const context = shortcutContext(handle.view);
    const onKey = (event: KeyboardEvent) => {
      if (handleKey(event, context)) event.preventDefault();
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [handle, shortcutContext]);

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

      {chosen && !chosen.geometryPath && !dismissed.has(CONVERTS_HERE) && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => dismiss(CONVERTS_HERE)}>
          {CONVERTS_HERE}
        </Alert>
      )}

      {note && !dismissed.has(note) && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => dismiss(note)}>
          {note}
        </Alert>
      )}

      {chosen && (
        <Paper sx={{ p: 1 }}>
          {handle && (
            <>
              <Toolbar
                view={handle.view}
                context={shortcutContext(handle.view)}
                revision={revision}
              />
              <FloorPicker
                storeys={handle.view.storeys}
                current={handle.view.state.storey}
                onChange={(storey) => {
                  handle.view.state.storey = storey;
                  handle.view.refresh();
                  bump((n) => n + 1);
                }}
              />
            </>
          )}
          <Suspense fallback={<CircularProgress sx={{ m: 4 }} />}>
            <BimCanvas
              key={chosen.geometryPath ?? chosen.ifcPath}
              url={fileUrl(libraryUrl, chosen.geometryPath ?? chosen.ifcPath)}
              convert={!chosen.geometryPath}
              bindings={bindings}
              proposed={proposed}
              tree={tree ?? undefined}
              onReport={onReport}
              onReady={onReady}
              onHover={onHover}
              onSelect={onSelect}
            />
          </Suspense>
          {handle && (
            <Box sx={{
              display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap', alignItems: 'flex-start',
            }}
            >
              <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
                <ObjectPanel
                  globalId={selected}
                  facts={selected ? handle.view.factsOf(selected) : undefined}
                  binding={bindings.find((b) => b.selector?.globalId === selected)}
                  // The property sets the model carries. The panel could always
                  // draw them and was never given them, so every model looked
                  // like it held four facts about an object when the tree holds
                  // dozens.
                  properties={selected ? handle.view.factsOf(selected)?.properties : undefined}
                  size={selected ? handle.view.sizeOf(selected) : undefined}
                />
              </Box>
              <Stack sx={{ flex: '1 1 260px', minWidth: 0, gap: 1 }}>
                <SensorCards
                  bindings={bindings}
                  readings={readings}
                  feed={feed}
                  selected={selected}
                  onSelect={setSelected}
                />
                {handle.view.state.heat !== 'off' && (
                  <HeatLegend
                    zones={zonesOf(bindings, readings, handle.view.state.heat,
                      (id) => handle.view.factsOf(id), feed)}
                    unit={displayOf(bindings[0] ?? { display: {} } as Binding).unit}
                    coloured={handle.view.liveCount(bindings, readings, feed)}
                  />
                )}
                <ClassLegend view={handle.view} onChange={() => bump((n) => n + 1)} />
              </Stack>
            </Box>
          )}
        </Paper>
      )}

      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
    </Box>
  );
}

export default BuildingModels;
