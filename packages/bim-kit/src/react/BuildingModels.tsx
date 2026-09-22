/**
 * The building models page.
 *
 * A person uploads an IFC file to the directory of their library that the host
 * names. This lists what is there and draws it.
 *
 * An IFC file cannot be drawn as it stands. It is a text exchange format
 * holding parametric solids, and turning those into triangles needs a geometry
 * kernel. Conversion leaves a GLB beside the source, so a model here is in one
 * of two states, and the page says which instead of showing an empty canvas.
 *
 * What the host supplies
 * ----------------------
 * Nothing in this file imports anything from the application that mounts it.
 * That is deliberate and it is the whole reason this lives in a package instead
 * of in the DTaaS repository: the host passes in the one thing only it
 * knows, the URL of the user's library, and everything else, including every
 * later improvement to this page, arrives as a version of this package.
 *
 * The host keeps its own layout, its own route guard and its own auth. Those
 * are its concerns and a plugin has no business owning them.
 */

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Chip,
  CircularProgress,
  FormControl,
  ListItemText,
  MenuItem,
  Paper,
  Select,
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
  readIfcName,
  uniqueNames,
  type BimModel,
  type LibraryEntry,
} from './assets.js';

// Loaded only when a model is opened, so three.js stays out of the host's main
// chunk. The host already gates bundle size, and a non-lazy three.js import
// shows up there immediately.
const BimCanvas = lazy(() => import('./BimCanvas.js'));

const SAVING =
  'Saving the conversion to the library, so the next visit loads it instead '
  + 'of converting again. A large model takes a moment.';

const STORED =
  'Stored in the library. The next visit loads this model without converting it.';

const NOT_STORED =
  'The conversion could not be stored, so this model will convert again next time.';

const CONVERTS_HERE =
  'No converted geometry sits beside this model, so it is read from the IFC '
  + 'file in your browser. That takes a moment the first time.';

/** Says whether a model already has geometry beside it, in one word. */
function StateChip({ model }: Readonly<{ model: BimModel }>) {
  return (
    <Chip
      size="small"
      label={model.geometryPath ? 'Converted' : 'From IFC'}
      color={model.geometryPath ? 'success' : 'default'}
      variant={model.geometryPath ? 'filled' : 'outlined'}
    />
  );
}

/**
 * Choose a model from a menu instead of from a list down the page.
 *
 * A library with a dozen IFC files pushed the viewer below the fold, so a
 * person scrolling a list of names had no way to tell there was a model drawn
 * underneath it. A menu keeps every file one click away and leaves the drawing
 * where the eye lands.
 */
function ModelPicker({
  models,
  chosen,
  onChoose,
}: Readonly<{
  models: BimModel[];
  chosen: BimModel | null;
  onChoose: (model: BimModel) => void;
}>) {
  return (
    // As wide as the messages below it, so the picker, the notices and the
    // drawing share one column and a long model name shows in full.
    <FormControl fullWidth size="small">
      {/* A heading and not a floating label, so the section is named before
          the control instead of inside it, the same way the chosen model is
          named above its drawing. */}
      <Typography variant="subtitle2" component="h2" id="bim-model-label" sx={{ mb: 1 }}>
        IFC Model
      </Typography>
      <Select
        // labelId and not aria-labelledby. Passed straight to Select, the
        // attribute lands on the outer box, and the element with the combobox
        // role, the one a screen reader announces, was left with no name.
        // labelId is the prop MUI puts on that element.
        labelId="bim-model-label"
        value={chosen?.ifcPath ?? ''}
        onChange={(event) => {
          const picked = models.find((model) => model.ifcPath === event.target.value);
          if (picked) onChoose(picked);
        }}
        // Only the name in the closed control. The size and the state belong in
        // the menu, where there is room for them.
        renderValue={(value) =>
          models.find((model) => model.ifcPath === value)?.title ?? ''}
      >
        {models.map((model) => (
          <MenuItem key={model.ifcPath} value={model.ifcPath}>
            <ListItemText
              primary={model.title}
              secondary={formatSize(model.sizeBytes)}
              sx={{ mr: 2 }}
            />
            <StateChip model={model} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

export interface BuildingModelsProps {
  /**
   * Where the user's library is served from, ending in the user name, as in
   * `https://host/jane/`. The host knows this and the package cannot.
   */
  libraryUrl: string;
  /**
   * Which directory under the library holds the models.
   *
   * The host's convention, so the host passes it. Left out, it falls back to
   * the directory DTaaS uses, which is deprecated and goes in 0.2.0.
   */
  directory?: string;
  /**
   * The last value received for each object, keyed by GlobalId.
   *
   * Pushed in instead of fetched, because this knows nothing about where a
   * reading came from: a broker, a database or a test all look the same here.
   */
  readings?: Map<string, Reading>;
  /** Whether the transport is connected, which no age can tell on its own. */
  feed?: FeedState;
  /**
   * Store the geometry converted in the browser, so the model is not
   * reconverted on the next visit.
   *
   * Called with the model and its GLB when a model with no geometry beside it
   * has just been converted here. Where the bytes go is the host's decision,
   * because this knows nothing about how the library is written to. Returning
   * without throwing means the geometry was stored, and the list refreshes so
   * the model reads as converted. A rejection is swallowed: the drawing already
   * on screen is unaffected, and the model reconverts next time instead.
   *
   * Absent means conversions are not stored, which is the behaviour of every
   * version before this one.
   */
  onPersistGeometry?: (model: BimModel, glb: Uint8Array) => Promise<void>;
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
/** What failed, and the address and cause behind it. */
interface Problem {
  summary: string;
  detail: string;
}

async function readJson<T>(response: Response, url: string): Promise<T> {
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);

  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    throw new Error(
      `The workspace returned a web page instead of data at ${url}. That `
      + 'address carries the name of the signed-in user, and a workspace '
      + 'served under a different name is what this looks like.',
    );
  }
  return response.json() as Promise<T>;
}

/**
 * The readings a host that passes none gets, shared by every render.
 *
 * A default of `new Map()` in the parameter list made a new map on every
 * render. The effect that applies readings depends on it and repaints, which
 * renders again, which made another map: once the viewer was ready the page
 * applied readings and repainted the model without end. One map, made once,
 * has the same identity every time.
 */
const NO_READINGS = new Map<string, Reading>();

export function BuildingModels({
  libraryUrl,
  directory = MODELS_DIRECTORY,
  readings = NO_READINGS,
  feed = 'down',
  onPersistGeometry,
}: Readonly<BuildingModelsProps>) {
  const [models, setModels] = useState<BimModel[] | null>(null);
  const [chosen, setChosen] = useState<BimModel | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [bindings, setBindings] = useState<Binding[]>([]);
  // A manifest a placement tool wrote marks itself proposed, so the page can
  // say so instead of presenting a guessed position as a survey.
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
  // Notes a person has closed, held by their text instead of by a position.
  // Choosing another model produces a different sentence, which then shows
  // again, and choosing the same one back does not repeat what was dismissed.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const dismiss = (text: string) => setDismissed((seen) => new Set(seen).add(text));
  // Bumped after a conversion is stored, so the listing is read again and the
  // just-written GLB is paired with its model. The model then reads as
  // converted, and choosing it again loads the file instead of reconverting.
  const [reload, setReload] = useState(0);
  // Where the last conversion is on its way to the library. A large model goes
  // up in dozens of pieces, and without this the page said nothing while it
  // happened, so a person who looked at the menu in the meantime saw the model
  // still marked as unconverted and concluded the save had failed.
  const [save, setSave] = useState<'idle' | 'saving' | 'stored' | 'failed'>('idle');

  useEffect(() => {
    if (!libraryUrl) return undefined;
    let current = true;

    const url = contentsUrl(libraryUrl, directory);
    // The listing decides whether the page works, so its failure is reported.
    // It is never taken from the browser cache: Jupyter sends it with
    // Last-Modified and no Cache-Control, so a cached copy could be reused, and
    // the listing read again after a save would miss the file just written.
    fetch(url, { credentials: 'include', cache: 'no-store' })
      .then((response) => readJson<{ content?: LibraryEntry[] }>(response, url))
      .then((listing) => {
        if (!current) return;
        const entries = listing.content ?? [];
        // Shown straight away under their file names, so the menu is usable
        // while the names are read.
        setModels(pairModels(entries));

        // Then named from the files themselves, the start of each read in
        // parallel. A name that cannot be read leaves the file name in place,
        // so this never fails the page.
        const ifcs = entries.filter((entry) => entry.name.toLowerCase().endsWith('.ifc'));
        Promise.all(ifcs.map((entry) => readIfcName(libraryUrl, entry.path)))
          .then((found) => {
            if (!current) return;
            const names = new Map(ifcs.map((entry, i) => [entry.name, found[i]]));
            setModels(pairModels(entries, uniqueNames(names)));
          });
      })
      .catch((error: Error) => {
        if (!current) return;
        setProblem({
          summary: 'The shared library could not be listed.',
          detail: error.message,
        });
        setModels([]);
      });

    return () => {
      current = false;
    };
  }, [libraryUrl, directory, reload]);

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
        // page says less instead of nothing.
        if (current) setTree(null);
      });

    return () => {
      current = false;
    };
  }, [chosen, libraryUrl]);

  // The manifest beside the model, when there is one. Most models declare no
  // sensors at all, and an empty list is the honest answer for those instead
  // of a failed request.
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
        if (current) {
          setProblem({
            summary: 'The sensor manifest could not be read.',
            detail: error.message,
          });
        }
      });

    return () => {
      current = false;
    };
  }, [chosen, libraryUrl]);

  // The readings reach the scene here instead of inside it, so a burst of
  // messages is one repaint instead of one per message.
  useEffect(() => {
    if (!handle) return;
    handle.view.applyReadings(bindings, readings, feed);
    handle.drawField();
    handle.view.refreshMaterials();
    bump((n) => n + 1);
  }, [handle, bindings, readings, feed]);

  const onReport = useCallback((message: string) => setNote(message), []);
  const onHover = useCallback((globalId: string | null) => { hovered.current = globalId; }, []);
  const onSelect = useCallback((globalId: string | null) => setSelected(globalId), []);

  // A conversion just finished in the canvas. Hand it to the host to store, and
  // when that returns, read the directory again so the new GLB is paired with
  // its model. A host that supplies no way to store gets no callback, so the
  // canvas never exports and nothing here runs.
  // The chosen model as the latest listing describes it. The canvas stays bound
  // to `chosen`, because swapping that object after a save would change the
  // canvas key and redraw the model already on screen. Everything the page says
  // about the model reads from here instead, so it follows the save.
  const current = chosen
    ? models?.find((model) => model.ifcPath === chosen.ifcPath) ?? chosen
    : null;

  // A save belongs to the model it was made for. Choosing another one clears
  // the message, so a model is never described by the save of the last one.
  const choose = useCallback((model: BimModel) => {
    setSave('idle');
    setChosen(model);
  }, []);

  const onConverted = useCallback((glb: Uint8Array) => {
    if (!chosen || !onPersistGeometry) return;
    setSave('saving');
    onPersistGeometry(chosen, glb)
      .then(() => {
        setSave('stored');
        setReload((n) => n + 1);
      })
      .catch(() => {
        // The drawing is already on screen, so nothing is lost now. The page
        // says so, because the cost lands on the next visit, which reconverts.
        setSave('failed');
      });
  }, [chosen, onPersistGeometry]);
  const onReady = useCallback((ready: ViewerHandle) => {
    setHandle(ready);
    setSelected(null);
    bump((n) => n + 1);
  }, []);

  /** Everything a shortcut needs, gathered in one place so the keyboard and the toolbar drive the viewer through exactly the same path. */
  const shortcutContext = useCallback((view: SceneView) => ({
    view,
    bindings,
    refresh: () => { view.refresh(); handle?.drawField(); bump((n) => n + 1); },
    frame: () => handle?.frame(),
    look: (from: 'top' | 'front' | 'side' | 'corner') => handle?.look(from),
    hovered: () => hovered.current,
    toggleHelp: () => setHelpOpen((open) => !open),
    toggleFullscreen: () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    },
  }), [handle, bindings]);

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
      {/* The headline says what failed, which is the part a person acts on.
          The address and the likely cause follow it, so a long diagnostic line
          does not have to be read before the failure is understood. */}
      {problem && (
        <Alert severity="error" sx={{ mb: 2 }}>
          <AlertTitle>{problem.summary}</AlertTitle>
          {problem.detail}
        </Alert>
      )}

      {/* On the page, the way the search field on the other pages is, and
          not in a box of its own: in a padded, bordered panel it read as a
          different kind of control from every other one in the application. */}
      <Box sx={{ mb: 3 }}>
        {models === null && <CircularProgress size={24} />}
        {models?.length === 0 && (
          <Typography variant="body2">
            No IFC file is in the shared library yet.
          </Typography>
        )}
        {models !== null && models.length > 0 && (
          <>
            <ModelPicker models={models} chosen={chosen} onChoose={choose} />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 1 }}
            >
              {models.length} IFC {models.length === 1 ? 'model' : 'models'} in
              the shared library.
            </Typography>
          </>
        )}
      </Box>

      {current && !current.geometryPath && !dismissed.has(CONVERTS_HERE) && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => dismiss(CONVERTS_HERE)}>
          {CONVERTS_HERE}
        </Alert>
      )}

      {save === 'saving' && (
        <Alert
          severity="info"
          icon={<CircularProgress size={18} />}
          sx={{ mb: 2 }}
        >
          {SAVING}
        </Alert>
      )}
      {save === 'stored' && !dismissed.has(STORED) && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => dismiss(STORED)}>
          {STORED}
        </Alert>
      )}
      {save === 'failed' && !dismissed.has(NOT_STORED) && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => dismiss(NOT_STORED)}>
          {NOT_STORED}
        </Alert>
      )}

      {note && !dismissed.has(note) && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => dismiss(note)}>
          {note}
        </Alert>
      )}

      {chosen && (
        <Paper sx={{ p: 1 }}>
          {/* The model being drawn, named above its own drawing, so the page
              says what is on screen without a scroll back to the menu. */}
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', px: 1, pt: 1, pb: 0.5 }}
          >
            {/* From the listing, like the chip beside it: a model can be chosen
                before its name has been read from its file, and the object picked
                from the menu keeps the file name it had then. */}
            <Typography variant="h6" component="h2">
              {(current ?? chosen).title}
            </Typography>
            <StateChip model={current ?? chosen} />
          </Stack>
          {handle && (
            // The floor picker sits on the toolbar's row, after its last
            // button, so the controls above the drawing take one line. It
            // wraps to the next line when the page is too narrow for both.
            <Box sx={{
              display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1,
            }}
            >
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
            </Box>
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
              onConverted={onPersistGeometry ? onConverted : undefined}
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
                      (id) => handle.view.zoneFor(id), feed)}
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
