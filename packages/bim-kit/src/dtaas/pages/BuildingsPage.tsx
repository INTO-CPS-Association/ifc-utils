/**
 * The Buildings page as DTaaS mounts it.
 *
 * This is the wiring and nothing more: the folder comes from the URL or the
 * configuration, the files from `host.contents`, the readings from
 * `host.signals`, and the drawing from `BuildingModels`, the same component
 * a host outside DTaaS uses on its own.
 */

import { useCallback, useMemo, useState } from 'react';
import { Alert, Stack } from '@mui/material';
import { useHost } from '@into-cps-association/dtaas-sdk';
import type { Binding } from '../../binding.js';
import { normaliseLibraryPath } from '../../libraryPath.js';
import type { LibraryEntry } from '../../react/assets.js';
import { BuildingModels } from '../../react/BuildingModels.js';
import { DirectoryPicker } from '../../react/DirectoryPicker.js';
import configSchema from '../config.js';
import persistGeometry from '../persistGeometry.js';
import useModelRoute, { type ModelRoute } from '../useModelRoute.js';
import useReadings from '../useReadings.js';

/** The folder shown when the URL names none: this extension's setting, then the host's convention. */
function useFallbackDirectory(): string {
  const host = useHost();
  return useMemo(
    () => host.config(configSchema).modelsDirectory ?? host.library.conventions.modelsDirectory,
    [host],
  );
}

/** `host.contents.list`, called as a method so a class-based host keeps `this`. */
function useList() {
  const host = useHost();
  return useCallback((path: string) => host.contents.list(path), [host]);
}

interface PanelProps {
  readonly route: ModelRoute;
  readonly directory: string;
  readonly list: (path: string) => Promise<LibraryEntry[]>;
}

/** The models panel: readings, bindings and geometry storage, wired to the host. */
function ModelsPanel({ route, directory, list }: Readonly<PanelProps>) {
  const host = useHost();
  const libraryUrl = host.library.useBaseUrl();
  const [bindings, setBindings] = useState<Binding[]>([]);
  const { readings, feed } = useReadings(host.signals, bindings);
  const onPersistGeometry = useMemo(() => persistGeometry(host), [host]);
  if (!libraryUrl) return null;
  return (
    <BuildingModels
      libraryUrl={libraryUrl}
      directory={directory}
      list={list}
      selected={route.model}
      onSelect={route.selectModel}
      onBindingsChange={setBindings}
      readings={readings}
      feed={feed}
      onPersistGeometry={onPersistGeometry}
    />
  );
}

/** The folder picker and the models panel, once a valid folder is known. */
function BuildingsView(props: Readonly<PanelProps>) {
  const { route, directory, list } = props;
  return (
    <Stack spacing={2}>
      <DirectoryPicker list={list} value={directory} onChange={route.selectDirectory} />
      <ModelsPanel {...props} />
    </Stack>
  );
}

/**
 * A `?dir=` that could leave the library, said plainly, with the fallback
 * folder in the picker so a person can move on to a valid one. The library
 * root is offered when the fallback is rejected too. Nothing is listed for a
 * rejected path.
 */
function RejectedFolder({ route, directory, list }: Readonly<PanelProps>) {
  return (
    <Stack spacing={2}>
      <Alert severity="error">
        &quot;{route.rejected}&quot; is not a folder in your library.
      </Alert>
      <DirectoryPicker list={list} value={directory} onChange={route.selectDirectory} />
    </Stack>
  );
}

/**
 * The heading DTaaS showed before this page became an extension: the menu
 * names it Buildings, and the page names itself and says what it is for.
 */
const DESCRIPTION =
  'IFC models in your library, drawn in the browser and coloured by the ' +
  'readings their sensors report.';

function BuildingsPage() {
  const host = useHost();
  const fallback = useFallbackDirectory();
  const route = useModelRoute(fallback);
  const list = useList();
  const { Page } = host.ui;
  const { directory } = route;
  return (
    <Page title="Building Models" description={DESCRIPTION}>
      {directory === null ? (
        <RejectedFolder route={route} directory={normaliseLibraryPath(fallback) ?? ''} list={list} />
      ) : (
        <BuildingsView route={route} directory={directory} list={list} />
      )}
    </Page>
  );
}

export default BuildingsPage;
