# ifc-utils

IFC and BIM software utilities for the [DTaaS][dtaas] platform.

A building model says where things are. A sensor stream says what they measure. Nothing in either says which reading belongs to which wall. These packages read a building model, convert it into something a browser can draw and write the manifest that binds a sensor to an object in it.

They exist to serve [DTaaS issue 1762][issue], which asks for 3D and BIM model visualisation in the client with live sensor overlays.

[dtaas]: https://github.com/INTO-CPS-Association/DTaaS
[issue]: https://github.com/INTO-CPS-Association/DTaaS/issues/1762

## What Is Here

| Package | Runs | What it does |
| --- | --- | --- |
| [`python/ifc-explorer`](python/ifc-explorer) | a machine with Python | Reads an IFC model and answers questions about it. Writes nothing. |
| [`python/ifc-converter`](python/ifc-converter) | a machine with Python | Turns an IFC model into GLB, a property tree and a manifest, using IfcOpenShell. |

## Where the Browser Package Went

The browser package `@into-cps-association/bim-kit` lived in `packages/bim-kit` up to version 0.2.0. It now lives in [`kits/bim-kit`][bimkit] of the [dtaas-extensions][ext] repository, next to the other DTaaS extensions and tested against the extension contract of the same commit. New work on the viewer, the browser converter and the manifest schema goes there.

[bimkit]: https://github.com/INTO-CPS-Association/dtaas-extensions/tree/main/kits/bim-kit
[ext]: https://github.com/INTO-CPS-Association/dtaas-extensions

## Two Converters, On Purpose

The `./converter` entry point of bim-kit and `ifc-converter` do the same job in different places, and that is deliberate instead of accidental duplication.

The browser one exists so a platform needs no conversion service: a person opens a model and it is converted on the machine that is looking at it. The Python one is the reference and the batch tool, and it is what says whether the other is right.

Both run against the files in [`fixtures/`](fixtures), because two implementations of one job are only comparable if they are asked the same questions. bim-kit keeps a copy of them in its own tests. Measured on the same models: they agree on object count exactly, the browser one is about nine times faster, and it produces about two per cent fewer triangles because some solids defeat its kernel.

## The Manifest

The manifest is the load-bearing piece, in the words of issue 1762: if its schema is right, the conversion, the viewer and the transport can each be replaced without touching the others. `ifc-converter` writes it and bim-kit documents and validates it.

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

## How a Package Is Built and Tested

```bash
pip install -e python/ifc-explorer -e python/ifc-converter
python -m pytest python/ifc-explorer python/ifc-converter
```

`ifc-converter` depends on `ifc-explorer`: every converter asks it which units a model is in, what its storeys are and what its hash is. It is a layer instead of a peer, and installing the converter installs both. Neither package is published to PyPI, so both are installed from their folders.

## Citing

GitHub shows a "Cite this repository" entry built from [CITATION.cff](CITATION.cff). Once releases are archived on Zenodo, each one has its own DOI, and a paper should cite the DOI of the version it used, which the release page links to.

## Licence

INTO-CPS Association Public License, version 1.0, with GPL version 3. See [LICENSE.md](LICENSE.md).
