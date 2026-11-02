# ifc-converter

Convert an IFC model into files a viewer can read: GLB geometry, a property tree keyed by GlobalId, and the binding manifest that ties a sensor to an object in the model.

Reading and reporting on a model is [`ifc-explorer`](../ifc-explorer), which this depends on and installs with it.

## Install

The package is not published on PyPI, so it is installed from this repository, from its root, together with `ifc-explorer`, which it depends on and which is not on PyPI either. Do not `pip install ifc-converter` from PyPI: the name is not registered there, and whatever is registered under it later is not this package.

```bash
pip install -e python/ifc-explorer -e python/ifc-converter
```

## Use

```bash
ifc-to-glb model.ifc model.glb            # geometry
ifc-to-metadata model.ifc model.json      # the property tree
ifc-to-manifest model.ifc model.yaml      # the binding manifest
```

`ifc-to-manifest` also takes `--bucket NAME` for the history half of each binding, `--topic-prefix PREFIX` for the first segment of a generated topic and `--proxy-reference-pattern REGEX`, described below.

## Sensors Held as Proxies

`ifc-to-manifest` binds every `IfcSensor` in the model. A model exported from Revit often holds its sensors as `IfcBuildingElementProxy` instead. Such a model also holds many proxies that are not sensors, so a proxy is only bound when the caller says how to recognise one:

```bash
ifc-to-manifest room.ifc room.yaml --proxy-reference-pattern '\w[\w-]*-TRH-\d{4}'
```

The pattern is a Python regular expression. It is tried against the `Reference` in the element's `Pset_*Common` property set, then against its `Name`, on every element that is not an `IfcSensor`. The matched text becomes the binding's `id` and the last segment of its generated topic, so the pattern should match the whole device ID. Revit writes the `Name` as family, type and element id joined by colons, which is why the `Reference` is tried first.

A binding found this way carries `foundBy: proxy reference pattern`, and the model section records the pattern as `proxy_reference_pattern`, so a reader can tell a sensor the model declares from one the caller picked out and can rerun the same selection.

## What Comes Out

**The GlobalId survives.** Each object becomes its own glTF node and mesh carrying `globalId` in `extras`, because that is the key the viewer binds a sensor by, and it is the one identifier that survives a re-export. Merging objects would produce a smaller file and destroy the binding.

**Provenance is recorded.** Every derived file carries the source file name, its SHA-256 and the converter version. Without those there is no way to tell whether a stale artifact still describes the model beside it: a re-export keeps the file name and changes every GlobalId inside.

## The Browser Does This Too

[`@into-cps-association/bim-kit/converter`](../../packages/bim-kit) converts in a browser, using web-ifc compiled to WebAssembly. The two are deliberately independent implementations of one job, and they run against the same files in [`fixtures/`](../../fixtures) so they can be compared.

Measured on the same models: they agree on object count exactly, the browser is about nine times faster, and it produces about two per cent fewer triangles because some solids defeat its kernel. Use the browser one to look at a model now, and this one as the reference and for batches.
