# ifc-utils

IFC and BIM software utilities for the [DTaaS][dtaas] platform.

A building model says where things are. A sensor stream says what they measure. Nothing in either says which reading belongs to which wall. These packages are the pieces that close that gap: they convert a building model into something a browser can draw, and they read the manifest that binds a sensor to an object in it.

They exist to serve [DTaaS issue 1762][issue], which asks for 3D and BIM model visualisation in the client with live sensor overlays.

[dtaas]: https://github.com/INTO-CPS-Association/DTaaS
[issue]: https://github.com/INTO-CPS-Association/DTaaS/issues/1762

## What Is Here

The directory says which ecosystem a package belongs to. The name says what it does.

| Package | Runs | What it does |
| --- | --- | --- |
| [`packages/bim-glb-viewer`](packages/bim-glb-viewer) | browser | Reads a binding manifest, resolves it against a model, and draws the model with live values on it. Ships a React page for the DTaaS client. |
| [`packages/bim-ifc-converter`](packages/bim-ifc-converter) | browser | Turns an IFC file into drawable geometry, wrapping [web-ifc][webifc] compiled to WebAssembly. |
| [`python/ifc-explorer`](python/ifc-explorer) | a machine with Python | Reads an IFC model and answers questions about it. Writes nothing. |
| [`python/ifc-converter`](python/ifc-converter) | a machine with Python | Turns an IFC model into GLB, a property tree and a manifest, using IfcOpenShell. |

[webifc]: https://github.com/ThatOpen/engine_web-ifc

## Two Converters, On Purpose

`bim-ifc-converter` and `ifc-converter` do the same job in different places, and that is deliberate instead of accidental duplication.

The browser one exists so a platform needs no conversion service: a person opens a model and it is converted on the machine that is looking at it. The Python one is the reference and the batch tool, and it is what says whether the other is right.

They run against the same files in [`fixtures/`](fixtures), because two implementations of one job are only comparable if they are asked the same questions. Measured on the same models: they agree on object count exactly, the browser one is about nine times faster, and it produces about two per cent fewer triangles because some solids defeat its kernel.

The converter is a separate package instead of part of the viewer, because versioning and testing a geometry conversion is a different problem from versioning and testing a drawing, and because a caller may want only the conversion, in a Node script for instance, without React or three.js coming with it. It reaches a consumer as a dependency of the viewer, loaded through a dynamic import, so the WebAssembly parser is fetched only when a model actually needs converting.

## The Manifest

The manifest is the load-bearing piece, in the words of issue 1762: if its schema is right, the conversion, the viewer and the transport can each be replaced without touching the others. It is documented in the viewer package and validated there.

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

The binding key is the IFC GlobalId, because it survives a re-export and a mesh name does not.

## How A Package Is Built And Published

### The npm packages

They are one npm workspace, so one can depend on another by version while both are still being written. From the top of the repository:

```bash
npm install
npm run build --workspaces
npm test --workspaces
```

Or in one package:

```bash
cd packages/<name>
npm install
npm run build     # ES modules and type declarations into dist/
npm test          # typecheck, then the suite against dist/
```

The tests import from `dist/`, not from `src/`. A test that passes on the source and fails on the artifact is a test that did not do its job.

### The Python packages

```bash
pip install -e python/ifc-explorer -e python/ifc-converter
python -m pytest python/ifc-explorer python/ifc-converter
```

`ifc-converter` depends on `ifc-explorer`: every converter asks it which units a model is in, what its storeys are and what its hash is. It is a layer instead of a peer, and installing the converter installs both.

### Publishing

Publishing is done by [the workflow](.github/workflows/npm.yml), on a release and on nothing else, to the organisation's GitHub Packages registry. Every package is ES modules only: a CommonJS build turns a dynamic `import()` into `Promise.resolve().then(require(...))`, which a bundler cannot split, and keeping heavy dependencies out of a host's main chunk is a requirement of issue 1762 instead of a preference.

## How A Consumer Installs One

```bash
npm install @into-cps-association/bim-glb-viewer
```

Heavy dependencies are peers, not dependencies: React, MUI and three.js are declared as optional peers so a host that already has them never receives a second copy, and a consumer that wants only the manifest logic never receives them at all. The core entry point imports nothing.

## Licence

INTO-CPS Association Public License, version 1.0, with GPL version 3. See [LICENSE.md](LICENSE.md).
