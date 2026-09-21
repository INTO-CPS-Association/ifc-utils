# @into-cps-association/bim-kit

Bind live sensor readings to the objects of a BIM model, by IFC GlobalId.

A building model says where things are. A sensor stream says what they measure. Nothing in either says which reading belongs to which wall. A manifest does, and this package is the code that reads it, the code that converts the model, and the code that draws the result.

It answers what [DTaaS issue 1762][issue] proposes, and the manifest is the piece that issue calls load-bearing: if its schema is right, the conversion, the viewer and the transport can each be replaced without touching the others.

[issue]: https://github.com/INTO-CPS-Association/DTaaS/issues/1762

## What Is In It

Four entry points, so a consumer takes what it needs and nothing else.

| Entry point | What it holds | What it pulls in |
| --- | --- | --- |
| `.` | The manifest, the binding, the resolver, the readings, the alerts, the colour ramp | nothing |
| `./schema` | Validating a manifest a person wrote | `zod` |
| `./converter` | IFC to geometry, in the browser | the inlined `web-ifc` WebAssembly |
| `./viewer` | The three.js scene, the floor filter, the heatmap, the selection | `three` |
| `./react` | The whole page as components | `react` and `@mui/material` |

The core entry point imports nothing at all, which is what lets manifest logic be tested in jsdom where WebGL, workers and WebAssembly do not exist. Everything heavier sits behind its own entry point and behind a dynamic import, so a host that never opens the page never downloads a renderer or a parser.

## What It Does Not Do

**It subscribes to nothing.** Readings are handed in. The package knows neither the broker nor the topic scheme, which is what lets the same component serve a local demonstration and a platform deployment.

**It writes no manifest.** Producing one is the job of the Python tools in this repository, which read the IFC and record the provenance.

## Install

```bash
npm install @into-cps-association/bim-kit
```

The core has no dependencies. The schema validator is a separate entry point because it needs `zod`, and `zod` is an optional peer: a manifest written by the converter has already been validated once, so most consumers never load it.

## Use

```js
import { resolveBindings, topicOf, displayOf, rampColour }
  from '@into-cps-association/bim-kit';

// Whatever loaded the geometry produces these. A GLB written by
// ifc_explorer.to_glb carries globalId in glTF `extras` on every node.
const objects = [{ globalId: '0_sgz7bzz4Jh2ckU1ehFe$', nodeName: 'HX-1' }];

const { resolved, unresolved } = resolveBindings(manifest.bindings, objects);

// Bindings that fail are returned instead of dropped. A manifest pointing at
// an object the geometry does not have is the ordinary consequence of a model
// being re-exported, and a viewer that silently draws four markers where the
// manifest asked for six is worse than one that says which two are missing.
for (const { binding, reason } of unresolved) {
  console.warn(`${binding.label}: ${reason}`);
}

for (const { binding, object } of resolved) {
  subscribe(topicOf(binding), (value) => {
    const [low, high] = displayOf(binding).ramp;
    paint(object, rampColour(value, low, high));
  });
}
```

Validating a manifest a person wrote:

```js
import { readManifest } from '@into-cps-association/bim-kit/schema';

const result = readManifest(parsedYaml);
if (!result.ok) {
  // Every problem names its place as `bindings[3].display.ramp`, because that
  // is how a person reads a YAML file.
  for (const { where, message } of result.problems) {
    console.error(`${where}: ${message}`);
  }
}
```

## Naming The Buildings

A file name says what a file is called, not what the building is. `BuildingModels` shows each model by the name its IFC file gives the building, read from the file itself. Nothing is named in this package, and there is no separate file of names: the name lives in the model.

An IFC file names its project and its building near the top. In every model this was written against, both sit within the first 6 KB, including one of 64 MB, so the page requests only the first 64 KB of each file with an HTTP range. Twelve models are named in about 150 ms, and a server that ignores the range is read only as far as that too, so no model is ever downloaded to name it.

The name is taken from the project's `LongName`, then its `Name`, then the building's. In the real models the name was on the project, and the building's own name was empty, template text, or once misspelt. Template text nobody replaced, "Project Name" and "Building Name", and a job number such as 34372 are not names and are skipped. A model whose file gives no name is shown by its file name, with its separators read as spaces. A name two files share identifies neither, so both keep their file names.

To name a building whose file does not, write the name into the file with `ifc-set-name`, in the `ifc-converter` package of this repository:

```sh
ifc-set-name Building_1912_AK_v4.ifc "Name of the building" --dry-run
ifc-set-name Building_1912_AK_v4.ifc "Name of the building"
```

It sets the project's `LongName` and changes nothing else: every byte outside that one argument is left as it was, and no `GlobalId` moves, so a manifest keeps its sensors.

## The Manifest

The shape is the one issue 1762 proposes.

```yaml
model:
  source: model.ifc
  source_sha256: 60b1b94e...
  converter: ifc_explorer.to_manifest 0.1.0
bindings:
  - selector: { globalId: 1yETHMphv6LwABqR4Pbs5g }
    label: Room 204 temperature
    source:
      live: { transport: mqtt, topic: building/204/temp }
      history: { bucket: swim, measurement: temperature }
    display: { unit: "°C", ramp: [18, 26] }
```

`selector` is a small union of `globalId`, `nodeName` and `expressId`, so a non-IFC asset reuses this manifest instead of needing a second schema. Exactly one form must be given: two would leave the resolver choosing, and a manifest should not depend on which it chose.

`live` and `history` are separate on purpose. MQTT supplies the current value on the marker, and the time series database supplies the panel behind a click. Charting is not reimplemented inside the 3D view.

Three optional fields are additions of this project instead of parts of the proposal, so a manifest written elsewhere still loads: `id`, the short tag a person says out loud; `mountedOn`, the equipment a sensor sits on; and `role`, which measurement point on that equipment, written as `TODO` when IFC cannot say.

## Develop

```bash
npm install
npm run build     # ESM, CommonJS and type declarations into dist/
npm test          # typecheck, then the suite against dist/
```

The tests import from `dist/`, not from `src/`. A test that passes on the source and fails on the artifact is a test that did not do its job.
